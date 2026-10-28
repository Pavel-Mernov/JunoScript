import { Lexer, Token, TokenType } from './lexer'

export type TypeNode = { kind: 'NamedType'; name: string } | { kind: 'GenericType'; name: string; args: TypeNode[] } | { kind: 'UnionType' | 'IntersectionType'; types: TypeNode[] } | { kind: 'ArrayType'; element: TypeNode } | { kind: 'ObjectType'; members: TypeMember[] } | { kind: 'FunctionType'; params: TypeNode[]; result: TypeNode }
export type TypeMember = { name: string; type: TypeNode; optional: boolean; readonly: boolean; constant: boolean; defaultValue?: Expression; method?: boolean; params?: Parameter[] }
export type Parameter = { name: string; type?: TypeNode; defaultValue?: Expression }
export type Expression =
    | { kind: 'Literal'; value: string | number | boolean | null }
    | { kind: 'Identifier'; name: string } | { kind: 'Array'; elements: Expression[] }
    | { kind: 'Object'; properties: { key: string; value: Expression }[] }
    | { kind: 'Unary'; operator: string; operand: Expression }
    | { kind: 'Binary'; operator: string; left: Expression; right: Expression }
    | { kind: 'Member'; object: Expression; property: string; optional: boolean }
    | { kind: 'Call'; callee: Expression; args: Expression[]; typeArguments?: TypeNode[] }
    | { kind: 'Function'; params: Parameter[]; returnType?: TypeNode; body: Statement[] }
export type Statement =
    | { kind: 'Variable'; name: string; mutable: boolean; type?: TypeNode; initializer?: Expression }
    | { kind: 'Import'; module: 'juno' | 'juno:node'; defaultImport?: string; namedImports: string[] }
    | { kind: 'FunctionDeclaration'; name: string; params: Parameter[]; returnType?: TypeNode; body: Statement[] }
    | { kind: 'TypeDeclaration'; name: string; generics: string[]; value: TypeNode }
    | { kind: 'Return'; value?: Expression } | { kind: 'ExpressionStatement'; expression: Expression }
    | { kind: 'If'; condition: Expression; consequent: Statement[]; alternate?: Statement[] }
    | { kind: 'ForOf'; binding: string; mutable: boolean; iterable: Expression; body: Statement[] }
    | { kind: 'While'; condition: Expression; body: Statement[] }

const precedence: Record<string, number> = { '==': 1, '!=': 1, '<': 2, '<=': 2, '>': 2, '>=': 2, '|': 3, '&': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 }
const opTypes: Partial<Record<TokenType, string>> = { EqualEqual: '==', NotEqual: '!=', Less: '<', LessEqual: '<=', Greater: '>', GreaterEqual: '>=', Pipe: '|', Ampersand: '&', Plus: '+', Minus: '-', Multiply: '*', Divide: '/', Percent: '%' }

export class Parser {
    private pos = 0
    constructor(private readonly tokens: Token[]) {}
    get current(): Token { return this.tokens[this.pos] }
    private is(type: TokenType, value?: string) { const t: any = this.current; return t.type === type && (value === undefined || t.value === value) }
    private take(type: TokenType, message = `Expected ${type}`): Token { if (!this.is(type)) this.fail(message); return this.tokens[this.pos++] }
    private value(token: Token): any { return (token as any).value }
    private match(type: TokenType, value?: string) { if (!this.is(type, value)) return false; this.pos++; return true }
    private fail(message: string): never { throw new SyntaxError(`${message} at ${this.current.line}:${this.current.column}`) }
    private identifier() { return String(this.value(this.take('Identifier', 'Expected identifier'))) }
    private propertyName() { return this.is('Identifier') || this.is('Keyword') ? String(this.value(this.tokens[this.pos++])) : this.identifier() }
    private separators() { while (this.match('Newline') || this.match('Comma')) {} }
    private objectSeparators() { while (this.match('Newline') || this.match('Comma') || this.match('Indent') || this.match('Dedent')) {} }
    parse(): Statement[] {
        const body: Statement[] = []
        const topSeparators = () => { while (this.match('Newline') || this.match('Comma') || this.match('Dedent')) {} }
        topSeparators()
        while (!this.is('EOF')) { body.push(this.statement()); topSeparators() }
        return body
    }
    private statement(): Statement {
        if (this.match('Keyword', 'import')) return this.importStatement()
        if (this.match('Keyword', 'let') || this.match('Keyword', 'const')) {
            const mutable = this.value(this.tokens[this.pos - 1]) === 'let', name = this.identifier()
            const type = this.match('Colon') ? this.type() : undefined
            let initializer: Expression | undefined
            if (this.match('Equal')) {
                const multiline = this.match('Newline')
                if (multiline) this.take('Indent', 'Expected an indented initializer')
                initializer = this.expression()
            }
            if (!initializer && !type) this.fail('A variable needs a type or initializer')
            if (!mutable && !initializer) this.fail('const requires an initializer')
            return { kind: 'Variable', name, mutable, type, initializer }
        }
        if (this.match('Keyword', 'fun')) {
            const name = this.identifier(), params = this.parameters(), returnType = this.match('Colon') ? this.type() : undefined
            this.take('Equal', "Expected '=' before function body")
            return { kind: 'FunctionDeclaration', name, params, returnType, body: this.block() }
        }
        if (this.match('Keyword', 'type')) {
            const name = this.identifier(), generics = this.match('Less') ? this.genericNames() : []
            this.take('Equal', "Expected '=' in type declaration")
            const indented = this.match('Newline') && this.match('Indent')
            const value = this.type()
            if (indented) { this.separators(); this.take('Dedent') }
            return { kind: 'TypeDeclaration', name, generics, value }
        }
        if (this.match('Keyword', 'return')) return { kind: 'Return', value: this.is('Newline') || this.is('Dedent') || this.is('EOF') ? undefined : this.expression() }
        if (this.match('Keyword', 'if')) {
            const condition = this.expression(), consequent = this.block(); this.separators()
            const alternate = this.match('Keyword', 'else') ? this.block() : undefined
            return { kind: 'If', condition, consequent, alternate }
        }
        if (this.match('Keyword', 'while')) return { kind: 'While', condition: this.expression(), body: this.block() }
        if (this.match('Keyword', 'for')) {
            const mutable = this.match('Keyword', 'let') || !this.match('Keyword', 'const'), binding = this.identifier()
            this.take('Keyword', "Expected 'of'"); const iterable = this.expression()
            return { kind: 'ForOf', binding, mutable, iterable, body: this.block() }
        }
        return { kind: 'ExpressionStatement', expression: this.expression() }
    }
    private importStatement(): Statement {
        let defaultImport: string | undefined
        const namedImports: string[] = []
        if (this.match('LeftBrace')) {
            if (!this.is('RightBrace')) do { namedImports.push(this.identifier()) } while (this.match('Comma'))
            this.take('RightBrace', "Expected '}' after imported names")
        } else {
            defaultImport = this.identifier()
            if (this.match('Comma')) {
                this.take('LeftBrace', "Expected '{' before named imports")
                if (!this.is('RightBrace')) do { namedImports.push(this.identifier()) } while (this.match('Comma'))
                this.take('RightBrace', "Expected '}' after imported names")
            }
        }
        this.take('Keyword', "Expected 'from' after import names")
        const moduleToken = this.take('String', "Expected 'juno' or 'juno:node' module name")
        const module = this.value(moduleToken)
        if (module !== 'juno' && module !== 'juno:node') this.fail(`Unsupported module '${module}'`)
        if (!defaultImport && namedImports.length === 0) this.fail('Import must name at least one binding')
        return { kind: 'Import', module, defaultImport, namedImports }
    }
    private block(): Statement[] {
        this.take('Newline', 'Expected a newline before indented block'); this.take('Indent', 'Expected an indented block')
        const body: Statement[] = []; this.separators()
        while (!this.is('Dedent') && !this.is('EOF')) { body.push(this.statement()); this.separators() }
        this.take('Dedent'); return body
    }
    private parameters(): Parameter[] {
        this.take('LeftParen'); const params: Parameter[] = []
        while (!this.is('RightParen')) { const name = this.identifier(), type = this.match('Colon') ? this.type() : undefined, defaultValue = this.match('Equal') ? this.expression() : undefined; params.push({ name, type, defaultValue }); if (!this.match('Comma') && !this.is('RightParen')) this.fail("Expected ',' or ')' in parameters") }
        this.take('RightParen'); return params
    }
    private genericNames(): string[] { const names: string[] = []; do { names.push(this.identifier()) } while (this.match('Comma')); this.take('Greater'); return names }
    private type(): TypeNode {
        let left = this.typeAtom()
        while (this.is('Pipe') || this.is('Ampersand')) { const operator = this.current.type; this.pos++; const right = this.typeAtom(); const kind = operator === 'Pipe' ? 'UnionType' : 'IntersectionType'; left = left.kind === kind ? { ...left, types: [...left.types, right] } : { kind, types: [left, right] } }
        return left
    }
    private typeAtom(): TypeNode {
        let result: TypeNode
        if (this.match('LeftBrace')) {
            const members: TypeMember[] = []; this.objectSeparators()
            while (!this.is('RightBrace') && !this.is('EOF')) {
                const readonly = this.match('Keyword', 'readonly'), constant = this.match('Keyword', 'const'), name = this.propertyName(), optional = this.match('Question')
                let params: Parameter[] | undefined, method = false, type: TypeNode
                if (this.is('LeftParen')) { method = true; params = this.parameters(); type = this.match('Colon') ? this.type() : { kind: 'NamedType', name: 'void' } }
                else { this.take('Colon', "Expected ':' after field name"); type = this.type() }
                const defaultValue = this.match('Equal') ? this.expression() : undefined
                if (constant && defaultValue === undefined) this.fail('const type fields need a default value')
                members.push({ name, optional, readonly, constant, type, defaultValue, method, params }); this.objectSeparators()
            }
            this.take('RightBrace'); result = { kind: 'ObjectType', members }
        } else if (this.match('LeftParen')) {
            const args: TypeNode[] = []; if (!this.is('RightParen')) do { args.push(this.type()) } while (this.match('Comma'))
            this.take('RightParen'); if (this.match('Arrow')) result = { kind: 'FunctionType', params: args, result: this.type() }; else if (args.length === 1) result = args[0]; else this.fail('Expected function return type after ->')
        } else if (this.match('Keyword', 'null')) {
            result = { kind: 'NamedType', name: 'null' }
        } else {
            const name = this.identifier(); let args: TypeNode[] = []
            if (this.match('Less')) { args.push(this.type()); while (this.match('Comma')) args.push(this.type()); this.take('Greater') }
            result = args.length ? { kind: 'GenericType', name, args } : { kind: 'NamedType', name }
        }
        while (this.match('LeftBracket')) { this.take('RightBracket'); result = { kind: 'ArrayType', element: result } }
        return result
    }
    private expression(min = 0): Expression {
        let left = this.prefix()
        let typeArguments: TypeNode[] | undefined
        while (true) {
            // Generic call type arguments are compile-time only: parse and discard them here.
            if (this.is('Less') && left.kind === 'Identifier') {
                const saved = this.pos
                try {
                    this.pos++
                    typeArguments = [this.type()]
                    while (this.match('Comma')) typeArguments.push(this.type())
                    this.take('Greater')
                    if (!this.is('LeftParen')) { this.pos = saved; typeArguments = undefined }
                } catch { this.pos = saved; typeArguments = undefined }
                if (typeArguments) continue
            }
            if (this.match('Dot')) { left = { kind: 'Member', object: left, property: this.identifier(), optional: false }; continue }
            if (this.match('Question') && this.match('Dot')) { left = { kind: 'Member', object: left, property: this.identifier(), optional: true }; continue }
            if (this.match('LeftParen')) { const args: Expression[] = []; if (!this.is('RightParen')) do { args.push(this.expression()) } while (this.match('Comma')); this.take('RightParen'); left = { kind: 'Call', callee: left, args, typeArguments }; typeArguments = undefined; continue }
            const op = opTypes[this.current.type], p = op ? precedence[op] : undefined
            if (!op || p === undefined || p < min) break
            this.pos++; left = { kind: 'Binary', operator: op, left, right: this.expression(p + 1) }
        }
        return left
    }
    private prefix(): Expression {
        if (this.match('Minus') || this.match('Bang')) return { kind: 'Unary', operator: this.tokens[this.pos - 1].type === 'Minus' ? '-' : '!', operand: this.expression(7) }
        if (this.match('Number')) return { kind: 'Literal', value: this.value(this.tokens[this.pos - 1]) as number }
        if (this.match('String')) return { kind: 'Literal', value: this.value(this.tokens[this.pos - 1]) as string }
        if (this.match('Keyword', 'true')) return { kind: 'Literal', value: true }
        if (this.match('Keyword', 'false')) return { kind: 'Literal', value: false }
        if (this.match('Keyword', 'null')) return { kind: 'Literal', value: null }
        if (this.match('Identifier')) return { kind: 'Identifier', name: String(this.value(this.tokens[this.pos - 1])) }
        if (this.match('LeftParen')) { const value = this.expression(); this.take('RightParen'); return value }
        if (this.match('LeftBracket')) { const elements: Expression[] = []; if (!this.is('RightBracket')) do { elements.push(this.expression()) } while (this.match('Comma')); this.take('RightBracket'); return { kind: 'Array', elements } }
        if (this.match('LeftBrace')) {
            const properties: { key: string; value: Expression }[] = []; this.objectSeparators()
            while (!this.is('RightBrace') && !this.is('EOF')) {
                const key = this.is('Identifier') || this.is('Keyword') ? String(this.value(this.tokens[this.pos++])) : String(this.value(this.take('String')))
                let value: Expression
                if (this.match('Colon')) value = this.expression()
                else if (this.match('LeftParen')) { this.pos--; const params = this.parameters(); this.take('Equal', "Expected '=' for method body"); value = { kind: 'Function', params, body: this.block() } }
                else value = { kind: 'Identifier', name: key }
                properties.push({ key, value }); this.objectSeparators()
            }
            this.take('RightBrace'); return { kind: 'Object', properties }
        }
        if (this.match('Keyword', 'fun')) { const params = this.parameters(), returnType = this.match('Colon') ? this.type() : undefined; this.take('Equal'); return { kind: 'Function', params, returnType, body: this.block() } }
        this.fail('Expected expression')
    }
}

export function parse(source: string): Statement[] { return new Parser(Lexer(source).tokenize()).parse() }

