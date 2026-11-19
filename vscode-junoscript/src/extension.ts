import * as vscode from 'vscode'
import { analyze, hoverAt, inlayHintsFor } from './language'

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
                const fieldPattern = /^\s*(?:readonly\s+)?(?:"([^"]+)"|(-?\d+(?:\.\d+)?)|([A-Za-z_$][\w$]*))\??\s*(?::|\()/gm
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
        }, '[', "'", '"'),
        vscode.languages.registerCodeActionsProvider(selector, {
            provideCodeActions(document, _range, context) {
                const result = analyze(document.getText(), document.uri.fsPath)
                if (!result) return []
                const actions: vscode.CodeAction[] = []
                for (const diagnostic of context.diagnostics) {
                    const info = result.diagnostics.find(item => item.fix && item.line === diagnostic.range.start.line + 1 && item.message === diagnostic.message)
                    if (!info?.fix) continue
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
