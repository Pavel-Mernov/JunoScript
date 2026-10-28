export type TokenType =
    | 'Number' | 'String' | 'Identifier' | 'Keyword' | 'Newline' | 'Indent' | 'Dedent' | 'EOF'
    | 'Plus' | 'Minus' | 'Multiply' | 'Divide' | 'Percent' | 'Equal' | 'EqualEqual'
    | 'NotEqual' | 'Less' | 'LessEqual' | 'Greater' | 'GreaterEqual' | 'Arrow' | 'FatArrow'
    | 'Colon' | 'Comma' | 'Dot' | 'Question' | 'Pipe' | 'Ampersand' | 'Bang'
    | 'LeftParen' | 'RightParen' | 'LeftBracket' | 'RightBracket' | 'LeftBrace' | 'RightBrace'

export type Token = { type: 'Number'; value: number; line: number; column: number }
    | { type: 'String'; value: string; line: number; column: number }
    | { type: 'Identifier' | 'Keyword'; value: string; line: number; column: number }
    | { type: 'Newline' | 'Indent' | 'Dedent' | 'EOF' | 'Plus' | 'Minus' | 'Multiply' | 'Divide' | 'Percent' | 'Equal' | 'EqualEqual' | 'NotEqual' | 'Less' | 'LessEqual' | 'Greater' | 'GreaterEqual' | 'Arrow' | 'FatArrow' | 'Colon' | 'Comma' | 'Dot' | 'Question' | 'Pipe' | 'Ampersand' | 'Bang' | 'LeftParen' | 'RightParen' | 'LeftBracket' | 'RightBracket' | 'LeftBrace' | 'RightBrace'; line: number; column: number }

const keywords = new Set(['let', 'const', 'fun', 'type', 'return', 'if', 'else', 'for', 'of', 'while', 'true', 'false', 'null', 'readonly', 'static', 'as', 'in', 'import', 'from'])

export type Lexer = { pos: number; source: string; tokenize(): Token[]; readonly current: string; readonly isAtEnd: boolean }

export function Lexer(source: string): Lexer {
    return {
        pos: 0, source,
        get current() { return source[this.pos] ?? '' },
        get isAtEnd() { return this.pos >= source.length },
        tokenize(): Token[] {
            const tokens: Token[] = [], indents = [0]
            let line = 1, column = 1, lineStart = true
            const push = (type: TokenType, value?: string | number, l = line, c = column) => {
                if (type === 'Number' || type === 'String') tokens.push({ type, value: value as number & string, line: l, column: c } as Token)
                else if (type === 'Identifier' || type === 'Keyword') tokens.push({ type, value: String(value), line: l, column: c })
                else tokens.push({ type, line: l, column: c } as Token)
            }
            const advance = () => { const c = this.current; this.pos++; if (c === '\n') { line++; column = 1 } else column++; return c }
            while (!this.isAtEnd) {
                if (lineStart) {
                    let width = 0
                    while (this.current === ' ' || this.current === '\t') width += advance() === '\t' ? 4 : 1
                    if (this.current === '\r') advance()
                    if (this.current === '\n') { advance(); push('Newline', undefined, line - 1, 1); continue }
                    if (this.current === '#') { while (!this.isAtEnd && source[this.pos] !== '\n') advance(); continue }
                    const top = indents[indents.length - 1]
                    if (width > top) { indents.push(width); push('Indent') }
                    else if (width < top) {
                        while (indents.length > 1 && width < indents[indents.length - 1]) { indents.pop(); push('Dedent') }
                        if (width !== indents[indents.length - 1]) throw new SyntaxError(`Inconsistent indentation at ${line}:${column}`)
                    }
                    lineStart = false
                }
                const c = this.current, l = line, col = column
                if (c === ' ' || c === '\t' || c === '\r') { advance(); continue }
                if (c === '\n') { advance(); push('Newline', undefined, l, col); lineStart = true; continue }
                if (c === '#') { while (!this.isAtEnd && this.current !== '\n') advance(); continue }
                if (/[0-9]/.test(c)) {
                    let raw = ''; while (/[0-9]/.test(this.current)) raw += advance()
                    if (this.current === '.' && /[0-9]/.test(source[this.pos + 1] ?? '')) { raw += advance(); while (/[0-9]/.test(this.current)) raw += advance() }
                    push('Number', Number(raw), l, col); continue
                }
                if (/[A-Za-z_$]/.test(c)) {
                    let value = ''; while (/[A-Za-z0-9_$]/.test(this.current)) value += advance()
                    push(keywords.has(value) ? 'Keyword' : 'Identifier', value, l, col); continue
                }
                if (c === '"' || c === "'" || c === '`') {
                    const quote = advance(); let value = '', closed = false
                    while (!this.isAtEnd) { const ch = advance(); if (ch === quote) { closed = true; break } if (ch === '\\') { if (this.isAtEnd) break; const e = advance(); value += ({ n: '\n', r: '\r', t: '\t', '0': '\0' } as Record<string, string>)[e] ?? e } else value += ch }
                    if (!closed) throw new SyntaxError(`Unterminated string at ${l}:${col}`)
                    push('String', value, l, col); continue
                }
                const pairs: Record<string, TokenType> = { '==': 'EqualEqual', '!=': 'NotEqual', '<=': 'LessEqual', '>=': 'GreaterEqual', '=>': 'FatArrow', '->': 'Arrow' }
                const pair = c + (source[this.pos + 1] ?? '')
                if (pairs[pair]) { advance(); advance(); push(pairs[pair], undefined, l, col); continue }
                const singles: Record<string, TokenType> = { '+': 'Plus', '-': 'Minus', '*': 'Multiply', '/': 'Divide', '%': 'Percent', '=': 'Equal', '<': 'Less', '>': 'Greater', ':': 'Colon', ',': 'Comma', '.': 'Dot', '?': 'Question', '|': 'Pipe', '&': 'Ampersand', '!': 'Bang', '(': 'LeftParen', ')': 'RightParen', '[': 'LeftBracket', ']': 'RightBracket', '{': 'LeftBrace', '}': 'RightBrace' }
                if (!singles[c]) throw new SyntaxError(`Unexpected character '${c}' at ${l}:${col}`)
                advance(); push(singles[c], undefined, l, col)
            }
            if (source.length && !lineStart && tokens[tokens.length - 1]?.type !== 'Newline') push('Newline', undefined, line, column)
            while (indents.length > 1) { indents.pop(); push('Dedent') }
            push('EOF'); return tokens
        }
    }
}
