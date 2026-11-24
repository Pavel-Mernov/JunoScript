import * as vscode from 'vscode'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { analyze, exportsForFile, hoverAt, inlayHintsFor } from './language'

type ImportCandidate = { module: string }

function moduleSpecifier(documentFile: string, exportedFile: string): string {
    let relative = path.relative(path.dirname(documentFile), exportedFile).replace(/\\/g, '/')
    relative = relative.replace(/\.(?:jn|[cm]?[jt]s)$/i, '').replace(/\/index$/i, '')
    return relative.startsWith('.') ? relative : `./${relative}`
}

async function importCandidates(document: vscode.TextDocument, name: string): Promise<ImportCandidate[]> {
    const candidates: ImportCandidate[] = []
    const seen = new Set<string>()
    const seenFiles = new Set<string>()
    const addFile = (module: string, file: string): void => {
        const resolvedFile = path.resolve(file)
        if (seen.has(module) || seenFiles.has(resolvedFile) || resolvedFile === path.resolve(document.uri.fsPath)) return
        const exported = exportsForFile(file).find(symbol => symbol.name === name)
        if (!exported) return
        seen.add(module)
        seenFiles.add(resolvedFile)
        candidates.push({ module })
    }

    const standardModules: Record<string, string[]> = {
        juno: ['console', 'Math', 'types', 'Error', 'Range', 'Iterable', 'Boolean', 'Number', 'String'],
        'juno:node': ['console'],
        'juno:types': ['Iterable', 'Range', 'Array', 'Set', 'ValueSet', 'Map', 'ValueMap', 'Queue', 'Object', 'Boolean', 'Tuple', 'Random', 'Error', 'Result', 'ok', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'KeyOf', 'Exclude', 'Items']
    }
    for (const [module, exports] of Object.entries(standardModules)) if (exports.includes(name)) {
        seen.add(module)
        candidates.push({ module })
    }

    const projectRoot = path.resolve(__dirname, '../..')
    seenFiles.add(path.join(projectRoot, 'Modules', 'juno.ts'))
    seenFiles.add(path.join(projectRoot, 'Modules', 'juno-node.ts'))
    seenFiles.add(path.join(projectRoot, 'types', 'index.jn'))

    const files = await vscode.workspace.findFiles(
        '**/*.{jn,ts,js,mts,cts,mjs,cjs}',
        '**/{node_modules,dist,out,.git,.build-tools}/**',
        1000
    )
    for (const uri of files) addFile(moduleSpecifier(document.uri.fsPath, uri.fsPath), uri.fsPath)
    return candidates
}

function addImportEdit(document: vscode.TextDocument, name: string, module: string): vscode.WorkspaceEdit {
    const edit = new vscode.WorkspaceEdit()
    const source = document.getText()
    const escapedModule = module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const existing = new RegExp(`(?:export\\s+)?import\\s*\\{([\\s\\S]*?)\\}\\s*from\\s*(['"])${escapedModule}\\2`).exec(source)
    if (existing) {
        const brace = source.indexOf('}', existing.index)
        const names = existing[1].split(',').map(item => item.trim()).filter(Boolean)
        const prefix = names.length ? `${existing[1].trimEnd().endsWith(',') ? '' : ','} ` : ''
        edit.insert(document.uri, document.positionAt(brace), `${prefix}${name}`)
        return edit
    }
    edit.insert(document.uri, new vscode.Position(0, 0), `import { ${name} } from '${module}'\n`)
    return edit
}

function resolveImportedFile(documentFile: string, specifier: string): string | undefined {
    if (!specifier.startsWith('.')) return undefined
    const base = path.resolve(path.dirname(documentFile), specifier)
    const candidates = /\.(?:jn|[cm]?[jt]s)$/i.test(base) ? [base] : [
        `${base}.jn`, `${base}.ts`, `${base}.js`, path.join(base, 'index.jn'), path.join(base, 'index.ts'), path.join(base, 'index.js')
    ]
    return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
}

function importCompletions(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] | undefined {
    const line = document.lineAt(position.line).text
    const before = line.slice(0, position.character)
    const named = /^\s*(?:export\s+)?import\s*\{([^}]*)$/.exec(before)
    if (named) {
        const tail = line.slice(position.character)
        const module = /^\s*\}\s*from\s*['"]([^'"]+)['"]/.exec(tail)?.[1]
        if (!module) return []
        const file = resolveImportedFile(document.uri.fsPath, module)
        if (!file) return []
        const typed = named[1].split(',').pop()?.trim() ?? ''
        const imported = new Set(named[1].split(',').slice(0, -1).map(name => name.trim()))
        const start = new vscode.Position(position.line, position.character - typed.length)
        return exportsForFile(file).filter(symbol => !imported.has(symbol.name) && symbol.name.startsWith(typed)).map(symbol => {
            const item = new vscode.CompletionItem(symbol.name, vscode.CompletionItemKind.Reference)
            item.detail = symbol.detail
            item.documentation = `Export from ${module}`
            item.range = new vscode.Range(start, position)
            return item
        })
    }

    const moduleMatch = /\bfrom\s+(['"])([^'"]*)$/.exec(before)
    if (!moduleMatch) return undefined
    const typed = moduleMatch[2]
    const start = new vscode.Position(position.line, position.character - typed.length)
    const modules = new Set(['juno', 'juno:node', 'juno:types', 'types'])
    if (typed.startsWith('.')) {
        const slash = Math.max(typed.lastIndexOf('/'), typed.lastIndexOf('\\'))
        const directoryPart = slash < 0 ? '.' : typed.slice(0, slash + 1)
        const namePart = slash < 0 ? typed.slice(2) : typed.slice(slash + 1)
        const directory = path.resolve(path.dirname(document.uri.fsPath), directoryPart)
        try {
            for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
                if (!entry.name.startsWith(namePart) || entry.name.startsWith('.')) continue
                const normalizedDirectory = directoryPart.replace(/\\/g, '/')
                const baseName = entry.isDirectory() ? `${entry.name}/` : entry.name.replace(/\.(?:jn|[cm]?[jt]s)$/i, '')
                modules.add(`${normalizedDirectory}${baseName}`)
            }
        } catch { /* incomplete path */ }
    }
    return [...modules].filter(name => name.startsWith(typed)).map(name => {
        const item = new vscode.CompletionItem(name, name.endsWith('/') ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.Module)
        item.range = new vscode.Range(start, position)
        return item
    })
}

export function activate(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = { language: 'junoscript', scheme: 'file' }
    const diagnostics = vscode.languages.createDiagnosticCollection('junoscript')
    const semanticLegend = new vscode.SemanticTokensLegend(['method'])

    const updateDiagnostics = (document: vscode.TextDocument): void => {
        if (document.languageId !== 'junoscript') return
        const result = analyze(document.getText(), document.uri.fsPath)
        diagnostics.set(document.uri, (result?.diagnostics ?? []).map(info => {
            const start = new vscode.Position(info.line - 1, info.column - 1)
            const end = new vscode.Position(info.line - 1, info.column - 1 + info.length)
            return new vscode.Diagnostic(new vscode.Range(start, end), info.message, vscode.DiagnosticSeverity.Error)
        }))
    }

    const keywordHover = vscode.languages.registerHoverProvider(selector, {
        provideHover(document, position) {
            const range = document.getWordRangeAtPosition(position, /\b(?:export|import)\b/)
            if (!range) return
            const word = document.getText(range)
            const markdown = new vscode.MarkdownString()
            markdown.appendCodeblock(word === 'export' ? 'export const | fun | type' : "import { name } from 'module'", 'junoscript')
            markdown.appendMarkdown(word === 'export' ? 'Exports this declaration from the current Juno module.' : 'Imports exported bindings from a Juno module.')
            return new vscode.Hover(markdown, range)
        }
    })

    vscode.workspace.textDocuments.forEach(updateDiagnostics)

    context.subscriptions.push(
        diagnostics,
        keywordHover,
        vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
        vscode.workspace.onDidChangeTextDocument(event => updateDiagnostics(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => diagnostics.delete(document.uri)),
        vscode.languages.registerHoverProvider(selector, {
            provideHover(document, position) {
                const info = hoverAt(document.getText(), position.line + 1, position.character + 1, document.uri.fsPath)
                if (!info) return
                const markdown = new vscode.MarkdownString()
                markdown.appendCodeblock(info.code, 'junoscript')
                if (info.docs) markdown.appendMarkdown(`\n${info.docs}`)
                if (info.typeDescription) {
                    markdown.appendMarkdown('\n\nType description:')
                    markdown.appendCodeblock(info.typeDescription, 'typescript')
                }
                const range = new vscode.Range(info.line - 1, info.column - 1, info.line - 1, info.column - 1 + info.length)
                return new vscode.Hover(markdown, range)
            }
        }),
        vscode.languages.registerDocumentSemanticTokensProvider(selector, {
            provideDocumentSemanticTokens(document) {
                const builder = new vscode.SemanticTokensBuilder(semanticLegend)
                const result = analyze(document.getText(), document.uri.fsPath)
                for (const token of result?.semanticTokens ?? []) {
                    builder.push(token.line - 1, token.column - 1, token.length, 0, 0)
                }
                return builder.build()
            }
        }, semanticLegend),
        vscode.languages.registerInlayHintsProvider(selector, {
            provideInlayHints(document) {
                const config = vscode.workspace.getConfiguration('junoscript.inlayHints')
                const variableTypes = config.get<boolean>('variableTypes.enabled', true)
                const parameterNames = config.get<boolean>('parameterNames.enabled', true)
                return inlayHintsFor(document.getText(), document.uri.fsPath).flatMap(hint => {
                    if (hint.kind === 'type' && !variableTypes) return []
                    if (hint.kind === 'parameter' && !parameterNames) return []
                    const position = new vscode.Position(hint.line - 1, hint.column - 1)
                    const item = new vscode.InlayHint(
                        position,
                        hint.label,
                        hint.kind === 'parameter' ? vscode.InlayHintKind.Parameter : vscode.InlayHintKind.Type
                    )
                    item.tooltip = new vscode.MarkdownString()
                    item.tooltip.appendCodeblock(hint.tooltip, 'junoscript')
                    item.paddingLeft = hint.kind !== 'parameter'
                    item.paddingRight = hint.kind === 'parameter'
                    return [item]
                })
            }
        }),
        vscode.languages.registerCompletionItemProvider(selector, {
            provideCompletionItems(document, position) {
                const imports = importCompletions(document, position)
                if (imports) return imports
                const linePrefix = document.lineAt(position.line).text.slice(0, position.character)
                const match = /([A-Za-z_$][\w$]*)\s*\[\s*(?:(['"])([^'"]*)?)?$/.exec(linePrefix)
                if (!match) return []
                const objectName = match[1]
                const quote = match[2]
                const typed = match[3] ?? ''
                const objectColumn = (match.index ?? 0) + match[0].indexOf(objectName)
                let info = hoverAt(document.getText(), position.line + 1, objectColumn + 1, document.uri.fsPath)
                if (!info?.typeDescription) {
                    const line = document.lineAt(position.line).text
                    const before = line.slice(0, match.index) + objectName
                    const after = line.slice(position.character).replace(/^['"]?\s*\]/, '')
                    const lines = document.getText().split(/\r?\n/)
                    lines[position.line] = before + after
                    info = hoverAt(lines.join('\n'), position.line + 1, objectColumn + 1, document.uri.fsPath)
                }
                if (!info?.typeDescription) return []
                const fields = new Map<string, string>()
                const fieldPattern = /^\s*(?:(?:readonly|sealed)\s+)*(?:"([^"]+)"|(-?\d+(?:\.\d+)?)|([A-Za-z_$][\w$]*))\??\s*(?::|\()/gm
                for (let field = fieldPattern.exec(info.typeDescription); field; field = fieldPattern.exec(info.typeDescription)) {
                    const name = field[1] ?? field[2] ?? field[3]
                    if (name.startsWith('__') || fields.has(name)) continue
                    fields.set(name, field[0].trim())
                }
                const replaceStart = new vscode.Position(position.line, position.character - typed.length)
                const range = new vscode.Range(replaceStart, position)
                return [...fields].filter(([name]) => name.startsWith(typed)).map(([name, detail]) => {
                    const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Field)
                    item.detail = detail
                    item.insertText = quote ? name : `'${name}'`
                    item.range = range
                    return item
                })
            }
        }, '[', '{', ',', "'", '"', '/'),
        vscode.languages.registerCodeActionsProvider(selector, {
            async provideCodeActions(document, _range, context) {
                const result = analyze(document.getText(), document.uri.fsPath)
                if (!result) return []
                const actions: vscode.CodeAction[] = []
                for (const diagnostic of context.diagnostics) {
                    const info = result.diagnostics.find(item => item.fix && item.line === diagnostic.range.start.line + 1 && item.message === diagnostic.message)
                    if (info?.fix) {
                        const action = new vscode.CodeAction(info.fix.title, vscode.CodeActionKind.QuickFix)
                        action.diagnostics = [diagnostic]
                        const insertLine = Math.min(info.fix.line, document.lineCount - 1)
                        const lineText = document.lineAt(insertLine).text
                        let indent = lineText.match(/^\s*/)?.[0] ?? ''
                        if (lineText.trimStart().startsWith('}')) {
                            const braceIndent = document.lineAt(Math.max(0, insertLine - 1)).text.match(/^\s*/)?.[0] ?? ''
                            indent = `${braceIndent}    `
                        }
                        const rows = info.fix.fields.map(field => `${indent}${field.name}: ${placeholderFor(field.type)},\n`).join('')
                        action.edit = new vscode.WorkspaceEdit()
                        action.edit.insert(document.uri, new vscode.Position(insertLine, 0), rows)
                        actions.push(action)
                    }

                    const missingName = /^Cannot find name '([^']+)'\.$/.exec(diagnostic.message)?.[1]
                    if (!missingName) continue
                    const candidates = await importCandidates(document, missingName)
                    for (const [index, candidate] of candidates.entries()) {
                        const action = new vscode.CodeAction(`Import '${missingName}' from '${candidate.module}'`, vscode.CodeActionKind.QuickFix)
                        action.diagnostics = [diagnostic]
                        action.isPreferred = index === 0
                        action.edit = addImportEdit(document, missingName, candidate.module)
                        actions.push(action)
                    }
                }
                return actions
            }
        }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] })
    )
}

export function deactivate(): void {}

function placeholderFor(type: string): string {
    if (type === 'string') return "''"
    if (type === 'number' || type === 'BigInt') return type === 'BigInt' ? '0n' : '0'
    if (type === 'boolean') return 'false'
    if (type.endsWith('[]')) return '[]'
    if (type.startsWith('{')) return '{}'
    return 'null'
}
