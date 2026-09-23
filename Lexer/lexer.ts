export type TokenType =
    | 'Number'
    | 'Id'
    | 'String'
    | 'Plus'
    | 'Minus'
    | 'Multiply'
    | 'Divide'
    | 'Equal'
    | 'Member'
    | 'LeftParen'
    | 'RightParen'
    | 'EOF'


export type Token =
    | {
        type: 'Number'
        value: number
    }
    | {
        type: 'String'
        value: string
    }
    | {
        type: 'Id'
        name: string
    }
    | Exclude<TokenType, 'Number' | 'String' | 'Id'>


export type Lexer = {
    pos: number
    source: string

    tokenize(): Token[]

    get current(): string
    get isAtEnd(): boolean

    skipWhitespace(): void
    readNumber(): number
    readString(): string
    readIdentifier(): string

    isIdentifierStart(char: string): boolean
    isIdentifierPart(char: string): boolean
}


export function Lexer(source: string): Lexer {
    return {
        pos: 0,
        source,

        tokenize(): Token[] {
            const tokens: Token[] = []

            while (!this.isAtEnd) {
                this.skipWhitespace()

                if (this.isAtEnd) {
                    break
                }

                const char = this.current

                switch (char) {
                    case '+':
                        tokens.push('Plus')
                        this.pos++
                        break

                    case '-':
                        tokens.push('Minus')
                        this.pos++
                        break

                    case '*':
                        tokens.push('Multiply')
                        this.pos++
                        break

                    case '/':
                        tokens.push('Divide')
                        this.pos++
                        break

                    case '=':
                        tokens.push('Equal')
                        this.pos++
                        break

                    case '.':
                        tokens.push('Member')
                        this.pos++
                        break

                    case '(':
                        tokens.push('LeftParen')
                        this.pos++
                        break

                    case ')':
                        tokens.push('RightParen')
                        this.pos++
                        break

                    case '\'':
                    case '"':
                    case '`': {
                        const value = this.readString()

                        tokens.push({
                            type: 'String',
                            value
                        })

                        break
                    }

                    default:
                        if (/[0-9]/.test(char)) {
                            const value = this.readNumber()

                            tokens.push({
                                type: 'Number',
                                value
                            })
                        }
                        else if (this.isIdentifierStart(char)) {
                            const name = this.readIdentifier()

                            tokens.push({
                                type: 'Id',
                                name
                            })
                        }
                        else {
                            throw new Error(
                                `Unexpected character '${char}' at position ${this.pos}`
                            )
                        }
                }
            }

            tokens.push('EOF')

            return tokens
        },

        get current(): string {
            return this.source[this.pos]
        },

        get isAtEnd(): boolean {
            return this.pos >= this.source.length
        },

        skipWhitespace(): void {
            while (
                !this.isAtEnd &&
                /\s/.test(this.current)
            ) {
                this.pos++
            }
        },

        readNumber(): number {
            const start = this.pos
        
            while (
                !this.isAtEnd &&
                /[0-9]/.test(this.current)
            ) {
                this.pos++
            }
        
            
            if (
                !this.isAtEnd &&
                this.current === '.' &&
                this.pos + 1 < this.source.length &&
                /[0-9]/.test(this.source[this.pos + 1])
            ) {
                this.pos++
        
                while (
                    !this.isAtEnd &&
                    /[0-9]/.test(this.current)
                ) {
                    this.pos++
                }
            }
        
            return Number(
                this.source.slice(start, this.pos)
            )
        },

        readString(): string {
            const quote = this.current

            // Пропускаем открывающую кавычку
            this.pos++

            let result = ''

            while (!this.isAtEnd) {
                const char = this.current

                // Закрывающая кавычка
                if (char === quote) {
                    this.pos++
                    return result
                }

                // Escape-последовательность
                if (char === '\\') {
                    this.pos++

                    if (this.isAtEnd) {
                        throw new Error(
                            `Unterminated escape sequence at position ${this.pos}`
                        )
                    }

                    const escaped = this.current

                    switch (escaped) {
                        case 'n':
                            result += '\n'
                            break

                        case 'r':
                            result += '\r'
                            break

                        case 't':
                            result += '\t'
                            break

                        case 'b':
                            result += '\b'
                            break

                        case 'f':
                            result += '\f'
                            break

                        case 'v':
                            result += '\v'
                            break

                        case '0':
                            result += '\0'
                            break

                        case '\\':
                            result += '\\'
                            break

                        case '\'':
                            result += '\''
                            break

                        case '"':
                            result += '"'
                            break

                        case '`':
                            result += '`'
                            break

                        default:
                            // Пока сохраняем неизвестный escape
                            // как сам символ.
                            //
                            // Позже сюда можно добавить:
                            // \xNN
                            // \uNNNN
                            // \u{NNNN}
                            result += escaped
                            break
                    }

                    this.pos++
                    continue
                }

                result += char
                this.pos++
            }

            throw new Error(
                `Unterminated string at position ${this.pos}`
            )
        },

        readIdentifier(): string {
            const start = this.pos

            // Первый символ
            this.pos++

            // Остальные символы
            while (
                !this.isAtEnd &&
                this.isIdentifierPart(this.current)
            ) {
                this.pos++
            }

            return this.source.slice(start, this.pos)
        },

        isIdentifierStart(char: string): boolean {
            return /[A-Za-z_$]/.test(char)
        },

        isIdentifierPart(char: string): boolean {
            return /[A-Za-z0-9_$]/.test(char)
        }
    }
}