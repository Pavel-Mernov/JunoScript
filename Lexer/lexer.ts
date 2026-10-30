export type TokenType =
    | 'Number' | 'BigInt' | 'String' | 'Identifier' | 'Keyword'
    | 'Newline' | 'Indent' | 'Dedent' | 'EOF'
    | 'Plus' | 'Minus' | 'Multiply' | 'Divide' | 'Percent'
    | 'Equal' | 'EqualEqual' | 'NotEqual'
    | 'Less' | 'LessEqual' | 'Greater' | 'GreaterEqual'
    | 'Arrow' | 'FatArrow' | 'Colon' | 'Comma' | 'Dot' | 'Question'
    | 'Pipe' | 'Ampersand' | 'Bang'
    | 'LeftParen' | 'RightParen' | 'LeftBracket' | 'RightBracket'
    | 'LeftBrace' | 'RightBrace'

export type Token =
    | { type: 'Number'; value: number; line: number; column: number }
    | { type: 'BigInt'; value: bigint; line: number; column: number }
    | { type: 'String'; value: string; line: number; column: number }
    | { type: 'Identifier' | 'Keyword'; value: string; line: number; column: number }
    | {
        type: Exclude<TokenType, 'Number' | 'BigInt' | 'String' | 'Identifier' | 'Keyword'>
        line: number
        column: number
    }

const keywords = new Set([
    'let', 'const', 'fun', 'type', 'return', 'if', 'else', 'for', 'of',
    'while', 'true', 'false', 'null', 'readonly', 'static', 'as', 'in',
    'import', 'from'
])

export type Lexer = {
    pos: number
    source: string
    tokenize(): Token[]
    readonly current: string
    readonly isAtEnd: boolean
}

export function Lexer(source: string): Lexer {
    return {
        pos: 0,
        source,

        get current() {
            return source[this.pos] ?? ''
        },

        get isAtEnd() {
            return this.pos >= source.length
        },

        tokenize(): Token[] {
            const tokens: Token[] = []
            const indents = [0]
            let line = 1
            let column = 1
            let lineStart = true

            const push = (type: TokenType, value?: string | number | bigint, l = line, c = column) => {
                if (type === 'Number') {
                    tokens.push({ type, value: value as number, line: l, column: c })
                } else if (type === 'BigInt') {
                    tokens.push({ type, value: value as bigint, line: l, column: c })
                } else if (type === 'String') {
                    tokens.push({ type, value: value as string, line: l, column: c })
                } else if (type === 'Identifier' || type === 'Keyword') {
                    tokens.push({ type, value: String(value), line: l, column: c })
                } else {
                    tokens.push({ type, line: l, column: c } as Token)
                }
            }

            const advance = () => {
                const character = this.current
                this.pos++
                if (character === '\n') {
                    line++
                    column = 1
                } else {
                    column++
                }
                return character
            }

            while (!this.isAtEnd) {
                if (lineStart) {
                    let width = 0

                    while (this.current === ' ' || this.current === '\t') {
                        width += advance() === '\t' ? 4 : 1
                    }

                    if (this.current === '\r') advance()

                    if (this.current === '\n') {
                        advance()
                        push('Newline', undefined, line - 1, 1)
                        continue
                    }

                    if (this.current === '#') {
                        while (!this.isAtEnd && source[this.pos] !== '\n') advance()
                        continue
                    }

                    const currentIndent = indents[indents.length - 1]

                    if (width > currentIndent) {
                        indents.push(width)
                        push('Indent')
                    } else if (width < currentIndent) {
                        while (indents.length > 1 && width < indents[indents.length - 1]) {
                            indents.pop()
                            push('Dedent')
                        }

                        if (width !== indents[indents.length - 1]) {
                            throw new SyntaxError(`Inconsistent indentation at ${line}:${column}`)
                        }
                    }

                    lineStart = false
                }

                const character = this.current
                const tokenLine = line
                const tokenColumn = column

                if (character === ' ' || character === '\t' || character === '\r') {
                    advance()
                    continue
                }

                if (character === '\n') {
                    advance()
                    push('Newline', undefined, tokenLine, tokenColumn)
                    lineStart = true
                    continue
                }

                if (character === '#') {
                    while (!this.isAtEnd && this.current !== '\n') advance()
                    continue
                }

                if (/[0-9]/.test(character)) {
                    let raw = ''

                    while (/[0-9]/.test(this.current)) raw += advance()

                    const isDecimal =
                        this.current === '.' &&
                        /[0-9]/.test(source[this.pos + 1] ?? '')

                    if (isDecimal) {
                        raw += advance()
                        while (/[0-9]/.test(this.current)) raw += advance()
                    }

                    if (!isDecimal && this.current === 'n') {
                        advance()
                        push('BigInt', BigInt(raw), tokenLine, tokenColumn)
                    } else {
                        push('Number', Number(raw), tokenLine, tokenColumn)
                    }

                    continue
                }

                if (/[A-Za-z_$]/.test(character)) {
                    let value = ''
                    while (/[A-Za-z0-9_$]/.test(this.current)) value += advance()
                    push(keywords.has(value) ? 'Keyword' : 'Identifier', value, tokenLine, tokenColumn)
                    continue
                }

                if (character === '"' || character === "'" || character === '`') {
                    const quote = advance()
                    let value = ''
                    let closed = false

                    while (!this.isAtEnd) {
                        const current = advance()

                        if (current === quote) {
                            closed = true
                            break
                        }

                        if (current === '\\') {
                            if (this.isAtEnd) break
                            const escaped = advance()
                            value += ({ n: '\n', r: '\r', t: '\t', '0': '\0' } as Record<string, string>)[escaped] ?? escaped
                        } else {
                            value += current
                        }
                    }

                    if (!closed) {
                        throw new SyntaxError(`Unterminated string at ${tokenLine}:${tokenColumn}`)
                    }

                    push('String', value, tokenLine, tokenColumn)
                    continue
                }

                const pairs: Record<string, TokenType> = {
                    '==': 'EqualEqual',
                    '!=': 'NotEqual',
                    '<=': 'LessEqual',
                    '>=': 'GreaterEqual',
                    '=>': 'FatArrow',
                    '->': 'Arrow'
                }

                const pair = character + (source[this.pos + 1] ?? '')

                if (pairs[pair]) {
                    advance()
                    advance()
                    push(pairs[pair], undefined, tokenLine, tokenColumn)
                    continue
                }

                const singles: Record<string, TokenType> = {
                    '+': 'Plus',
                    '-': 'Minus',
                    '*': 'Multiply',
                    '/': 'Divide',
                    '%': 'Percent',
                    '=': 'Equal',
                    '<': 'Less',
                    '>': 'Greater',
                    ':': 'Colon',
                    ',': 'Comma',
                    '.': 'Dot',
                    '?': 'Question',
                    '|': 'Pipe',
                    '&': 'Ampersand',
                    '!': 'Bang',
                    '(': 'LeftParen',
                    ')': 'RightParen',
                    '[': 'LeftBracket',
                    ']': 'RightBracket',
                    '{': 'LeftBrace',
                    '}': 'RightBrace'
                }

                if (!singles[character]) {
                    throw new SyntaxError(`Unexpected character '${character}' at ${tokenLine}:${tokenColumn}`)
                }

                advance()
                push(singles[character], undefined, tokenLine, tokenColumn)
            }

            if (source.length && !lineStart && tokens[tokens.length - 1]?.type !== 'Newline') {
                push('Newline', undefined, line, column)
            }

            while (indents.length > 1) {
                indents.pop()
                push('Dedent')
            }

            push('EOF')
            return tokens
        }
    }
}