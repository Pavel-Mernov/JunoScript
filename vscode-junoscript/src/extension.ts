import * as vscode from 'vscode'
import { analyze, hoverAt, inlayHintsFor } from './language'

export function activate(context: vscode.ExtensionContext): void {
    const selector: vscode.DocumentSelector = { language: 'junoscript', scheme: 'file' }
    const diagnostics = vscode.languages.createDiagnosticCollection('junoscript')

    const updateDiagnostics = (document: vscode.TextDocument): void => {
        if (document.languageId !== 'junoscript') return
        const result = analyze(document.getText())
        diagnostics.set(document.uri, (result?.diagnostics ?? []).map(info => {
            const start = new vscode.Position(info.line - 1, info.column - 1)
            const end = new vscode.Position(info.line - 1, info.column - 1 + info.length)
            return new vscode.Diagnostic(new vscode.Range(start, end), info.message, vscode.DiagnosticSeverity.Error)
        }))
    }

    vscode.workspace.textDocuments.forEach(updateDiagnostics)

    context.subscriptions.push(
        diagnostics,
        vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
        vscode.workspace.onDidChangeTextDocument(event => updateDiagnostics(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => diagnostics.delete(document.uri)),
        vscode.languages.registerHoverProvider(selector, {
            provideHover(document, position) {
                const info = hoverAt(document.getText(), position.line + 1, position.character + 1)
                if (!info) return
                const markdown = new vscode.MarkdownString()
                markdown.appendCodeblock(info.code, 'junoscript')
                if (info.docs) markdown.appendMarkdown(`\n${info.docs}`)
                const range = new vscode.Range(info.line - 1, info.column - 1, info.line - 1, info.column - 1 + info.length)
                return new vscode.Hover(markdown, range)
            }
        }),
        vscode.languages.registerInlayHintsProvider(selector, {
            provideInlayHints(document) {
                const config = vscode.workspace.getConfiguration('junoscript.inlayHints')
                const variableTypes = config.get<boolean>('variableTypes.enabled', true)
                const parameterNames = config.get<boolean>('parameterNames.enabled', true)
                return inlayHintsFor(document.getText()).flatMap(hint => {
                    if (hint.kind === 'type' && !variableTypes) return []
                    if (hint.kind === 'parameter' && !parameterNames) return []
                    const position = new vscode.Position(hint.line - 1, hint.column - 1)
                    const item = new vscode.InlayHint(
                        position,
                        hint.label,
                        hint.kind === 'type' ? vscode.InlayHintKind.Type : vscode.InlayHintKind.Parameter
                    )
                    item.tooltip = new vscode.MarkdownString()
                    item.tooltip.appendCodeblock(hint.tooltip, 'junoscript')
                    item.paddingLeft = hint.kind === 'type'
                    item.paddingRight = hint.kind === 'parameter'
                    return [item]
                })
            }
        })
    )
}

export function deactivate(): void {}
