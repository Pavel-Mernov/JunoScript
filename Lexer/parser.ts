import { Lexer, Token, TokenType } from './lexer'

export type Loc = { line: number; column: number }
export type TypeNode = { kind: 'NamedType'; name: string; loc?: Loc } | { kind: 'LiteralType'; value: string | number | boolean; loc?: Loc } | { kind: 'GenericType'; name: string; args: TypeNode[]; loc?: Loc } | { kind: 'UnionType' | 'IntersectionType'; types: TypeNode[] } | { kind: 'ArrayType'; element: TypeNode } | { kind: 'ObjectType'; members: TypeMember[] } | { kind: 'FunctionType'; params: TypeNode[]; result: TypeNode }
export type TypeMember = { name: string; loc?: Loc; type: TypeNode; optional: boolean; readonly: boolean; constant: boolean; defaultValue?: Expression; method?: boolean; accessor?: 'get' | 'set'; params?: Parameter[]; body?: Statement[] }
export type Parameter = { name: string; loc?: Loc; type?: TypeNode; defaultValue?: Expression; rest?: boolean }
export type Expression =
    | { kind: 'Literal'; value: string | number | bigint | boolean | null; loc?: Loc }
    | { kind: 'RegEx'; source: string; flags: string; loc?: Loc }
    | { kind: 'Template'; parts: (string | Expression)[]; loc?: Loc }
    | { kind: 'Identifier'; name: string; loc?: Loc } | { kind: 'Array'; elements: Expression[]; loc?: Loc }
      | { kind: 'Object'; properties: { key: string; keyLoc?: Loc; value: Expression; accessor?: 'get' | 'set'; spread?: boolean; readonly?: boolean }[]; loc?: Loc }
    | { kind: 'Unary'; operator: string; operand: Expression; loc?: Loc }
    | { kind: 'Assignment'; name: string; loc?: Loc; operatorLoc?: Loc; operator?: string; value: Expression }
    | { kind: 'MemberAssignment'; object: Expression; property?: string; propertyLoc?: Loc; index?: Expression; loc?: Loc; operator?: string; value: Expression }
    | { kind: 'Binary'; operator: string; left: Expression; right: Expression; loc?: Loc }
    | { kind: 'Conditional'; condition: Expression; consequent: Expression; alternate: Expression; loc?: Loc }
    | { kind: 'Member'; object: Expression; property: string; optional: boolean; loc?: Loc }
    | { kind: 'Index'; object: Expression; index: Expression; loc?: Loc }
    | { kind: 'Call'; callee: Expression; args: Expression[]; typeArguments?: TypeNode[] }
    | { kind: 'Function'; params: Parameter[]; returnType?: TypeNode; body: Statement[]; expressionBody?: Expression }
export type Statement =
    | { kind: 'Variable'; name: string; loc?: Loc; mutable: boolean; type?: TypeNode; initializer?: Expression }
    | { kind: 'Destructure'; bindings: { name: string; loc?: Loc }[]; mutable: boolean; initializer: Expression }
    | { kind: 'Import'; module: string; defaultImport?: string; defaultImportLoc?: Loc; namedImports: string[]; namedImportLocs?: Loc[]; importedTypes?: Record<string, TypeNode>; importedSymbols?: Record<string, { kind: string; value?: TypeNode; generics?: string[]; params?: Parameter[]; returnType?: TypeNode; type?: TypeNode }> }
    | { kind: 'Export'; declaration: Statement; default?: boolean }
    | { kind: 'FunctionDeclaration'; name: string; loc?: Loc; params: Parameter[]; returnType?: TypeNode; body: Statement[] }
    | { kind: 'TypeDeclaration'; name: string; loc?: Loc; generics: string[]; genericLocs?: Loc[]; value: TypeNode }
    | { kind: 'ConstructorDeclaration'; name: string; loc?: Loc; inheritedType: TypeNode; overloads: Extract<Expression, { kind: 'Function' }>[] }
    | { kind: 'Return'; value?: Expression } | { kind: 'ExpressionStatement'; expression: Expression }
    | { kind: 'If'; condition: Expression; consequent: Statement[]; alternate?: Statement[] }
    | { kind: 'ForOf'; binding: string; loc?: Loc; mutable: boolean; iterable: Expression; body: Statement[] }
    | { kind: 'While'; condition: Expression; body: Statement[] }

const precedence: Record<string, number> = { '|': 1, '&': 2, '??': 3, '==': 4, '!=': 4, '<': 5, '<=': 5, '>': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7 }
const opTypes: Partial<Record<TokenType, string>> = { EqualEqual: '==', NotEqual: '!=', Less: '<', LessEqual: '<=', Greater: '>', GreaterEqual: '>=', Nullish: '??', Pipe: '|', Ampersand: '&', Plus: '+', Minus: '-', Multiply: '*', Divide: '/', Percent: '%' }
const assignmentOperators: Partial<Record<TokenType, string>> = { Equal: '=', PlusEqual: '+=', MinusEqual: '-=', MultiplyEqual: '*=', DivideEqual: '/=', PercentEqual: '%=', PipeEqual: '|=', AmpersandEqual: '&=' }

export class Parser {
    private pos = 0
    constructor(private readonly tokens: Token[]) {}
    get current(): Token { return this.tokens[this.pos] }
    private is(type: TokenType, value?: string) { const t: any = this.current; return t.type === type && (value === undefined || t.value === value) }
    private take(type: TokenType, message = `Expected ${type}`): Token { if (!this.is(type)) this.fail(message); return this.tokens[this.pos++] }
    private value(token: Token): any { return (token as any).value }
    private match(type: TokenType, value?: string) { if (!this.is(type, value)) return false; this.pos++; return true }
    private fail(message: string): never { throw new SyntaxError(`${message} at ${this.current.line}:${this.current.column}`) }
    private loc(token: Token): Loc { return { line: token.line, column: token.column } }
    private identifier(): { name: string; loc: Loc } {
        const token = this.take('Identifier', 'Expected identifier')
        return { name: String(this.value(token)), loc: this.loc(token) }
    }
    private propertyName(): { name: string; loc: Loc } {
        if (this.is('Identifier') || this.is('Keyword')) {
            const token = this.tokens[this.pos++]
            return { name: String(this.value(token)), loc: this.loc(token) }
        }
        if (this.is('String')) {
            const token = this.take('String')
            return { name: String(this.value(token)), loc: this.loc(token) }
        }
        return this.identifier()
    }
    private separators() { while (this.match('Newline') || this.match('Comma')) {} }
    private objectSeparators() { while (this.match('Newline') || this.match('Comma') || this.match('Indent') || this.match('Dedent')) {} }
    private parenthesisSeparators() { while (this.match('Newline') || this.match('Indent') || this.match('Dedent')) {} }
    parse(): Statement[] {
        const body: Statement[] = []
        const topSeparators = () => { while (this.match('Newline') || this.match('Comma') || this.match('Dedent')) {} }
        topSeparators()
        while (!this.is('EOF')) { body.push(this.statement()); topSeparators() }
        return body
    }
    parseExpressionOnly(): Expression {
        const value = this.expression()
        while (this.match('Newline')) {}
        if (!this.is('EOF')) this.fail('Unexpected token after expression')
        return value
    }
    private statement(): Statement {
        if (this.match('Keyword', 'import')) return this.importStatement()
        if (this.match('Keyword', 'export')) {
            const isDefault = this.match('Keyword', 'default')
            const declaration = this.statement()
            if (!['Variable', 'FunctionDeclaration', 'TypeDeclaration'].includes(declaration.kind)) this.fail('export must precede a declaration')
            return { kind: 'Export', declaration, default: isDefault }
        }
        if (this.match('Keyword', 'let') || this.match('Keyword', 'const')) {
            const mutable = this.value(this.tokens[this.pos - 1]) === 'let'
            if (this.match('LeftBrace')) {
                const bindings: { name: string; loc?: Loc }[] = []
                const patternSeparators = () => { while (this.match('Newline') || this.match('Indent') || this.match('Dedent')) {} }
                patternSeparators()
                while (!this.is('RightBrace')) {
                    bindings.push(this.identifier())
                    patternSeparators()
                    if (this.match('Comma')) patternSeparators()
                    else if (!this.is('RightBrace')) this.fail("Expected ',' or '}' in object destructuring")
                }
                this.take('RightBrace')
                this.take('Equal', "Expected '=' after object destructuring")
                return { kind: 'Destructure', bindings, mutable, initializer: this.expression() }
            }
            const { name, loc } = this.identifier()
            const type = this.match('Colon') ? this.type() : undefined
            let initializer: Expression | undefined
            if (this.match('Equal')) {
                const multiline = this.match('Newline')
                if (multiline) this.take('Indent', 'Expected an indented initializer')
                initializer = this.expression()
            }
            if (!initializer && !type) this.fail('A variable needs a type or initializer')
            if (!mutable && !initializer) this.fail('const requires an initializer')
            return { kind: 'Variable', name, loc, mutable, type, initializer }
        }
        if (this.match('Keyword', 'fun')) {
            const { name, loc } = this.identifier(), params = this.parameters(), returnType = this.match('Colon') ? this.type() : undefined
            this.take('Equal', "Expected '=' before function body")
            return { kind: 'FunctionDeclaration', name, loc, params, returnType, body: this.block() }
        }
        if (this.match('Keyword', 'type')) {
            const { name, loc } = this.identifier()
            let generics: string[] = [], genericLocs: Loc[] = []
            if (this.match('Less')) {
                const names = this.genericNames()
                generics = names.map(item => item.name)
                genericLocs = names.map(item => item.loc)
            }
            this.take('Equal', "Expected '=' in type declaration")
            const indented = this.match('Newline')
            if (indented && this.is('Indent') && this.tokens[this.pos + 1]?.type !== 'Pipe' && this.tokens[this.pos + 1]?.type !== 'Ampersand') this.pos++
            const value = this.type()
            if (indented) { this.separators(); if (this.is('Dedent')) this.take('Dedent') }
            return { kind: 'TypeDeclaration', name, loc, generics, genericLocs, value }
        }
        if (this.match('Keyword', 'constructor')) {
            const { name, loc } = this.identifier()
            this.take('Colon', "Expected ':' before inherited constructor type")
            const inheritedType = this.type()
            this.take('LeftBrace', "Expected '{' before constructor overloads")
            const overloads: Extract<Expression, { kind: 'Function' }>[] = []
            this.objectSeparators()
            while (!this.is('RightBrace') && !this.is('EOF')) {
                this.take('Keyword', "Expected anonymous 'fun' constructor overload")
                if (this.value(this.tokens[this.pos - 1]) !== 'fun') this.fail("Expected anonymous 'fun' constructor overload")
                const params = this.parameters()
                const returnType = this.match('Colon') ? this.type() : undefined
                this.take('Equal', "Expected '=' before constructor body")
                overloads.push({ kind: 'Function', params, returnType, body: this.block() })
                this.objectSeparators()
            }
            this.take('RightBrace')
            if (!overloads.length) this.fail('A constructor needs at least one anonymous function')
            return { kind: 'ConstructorDeclaration', name, loc, inheritedType, overloads }
        }
        if (this.match('Keyword', 'return')) return { kind: 'Return', value: this.is('Newline') || this.is('Dedent') || this.is('EOF') ? undefined : this.expression() }
        if (this.is('Identifier') && assignmentOperators[this.tokens[this.pos + 1]?.type]) {
            const { name, loc } = this.identifier(), operatorToken = this.current, operator = assignmentOperators[operatorToken.type]!
            this.pos++
            return { kind: 'ExpressionStatement', expression: { kind: 'Assignment', name, loc, operatorLoc: this.loc(operatorToken), operator, value: this.expression() } }
        }
        if (this.match('Keyword', 'if')) {
            const condition = this.expression(), consequent = this.block(); this.separators()
            const alternate = this.match('Keyword', 'else') ? this.block() : undefined
            return { kind: 'If', condition, consequent, alternate }
        }
        if (this.match('Keyword', 'while')) return { kind: 'While', condition: this.expression(), body: this.block() }
        if (this.match('Keyword', 'for')) {
            const mutable = this.match('Keyword', 'let') || !this.match('Keyword', 'const'), { name: binding, loc } = this.identifier()
            this.take('Keyword', "Expected 'of'"); const iterable = this.expression()
            return { kind: 'ForOf', binding, loc, mutable, iterable, body: this.block() }
        }
        const expression = this.expression()
        const assignmentOperator = assignmentOperators[this.current.type]
        if (assignmentOperator) {
            const operatorToken = this.current
            this.pos++
            if (expression.kind === 'Member') return { kind: 'ExpressionStatement', expression: { kind: 'MemberAssignment', object: expression.object, property: expression.property, propertyLoc: expression.loc, loc: this.loc(operatorToken), operator: assignmentOperator, value: this.expression() } }
            if (expression.kind === 'Index') return { kind: 'ExpressionStatement', expression: { kind: 'MemberAssignment', object: expression.object, index: expression.index, loc: this.loc(operatorToken), operator: assignmentOperator, value: this.expression() } }
            this.fail('Only variables and object properties can be assigned here')
        }
        return { kind: 'ExpressionStatement', expression }
    }
    private importStatement(): Statement {
        let defaultImport: string | undefined
        let defaultImportLoc: Loc | undefined
        const namedImports: string[] = []
        const namedImportLocs: Loc[] = []
        if (this.match('LeftBrace')) {
            if (!this.is('RightBrace')) do {
                const ident = this.identifier()
                namedImports.push(ident.name)
                namedImportLocs.push(ident.loc)
            } while (this.match('Comma'))
            this.take('RightBrace', "Expected '}' after imported names")
        } else {
            const ident = this.identifier()
            defaultImport = ident.name
            defaultImportLoc = ident.loc
            if (this.match('Comma')) {
                this.take('LeftBrace', "Expected '{' before named imports")
                if (!this.is('RightBrace')) do {
                    const named = this.identifier()
                    namedImports.push(named.name)
                    namedImportLocs.push(named.loc)
                } while (this.match('Comma'))
                this.take('RightBrace', "Expected '}' after imported names")
            }
        }
        this.take('Keyword', "Expected 'from' after import names")
        const moduleToken = this.take('String', "Expected 'juno', 'juno:node', or 'types' module name")
        const module = String(this.value(moduleToken))
        if (!defaultImport && namedImports.length === 0) this.fail('Import must name at least one binding')
        return { kind: 'Import', module, defaultImport, defaultImportLoc, namedImports, namedImportLocs }
    }
    private block(): Statement[] {
        this.take('Newline', 'Expected a newline before indented block'); this.take('Indent', 'Expected an indented block')
        const body: Statement[] = []; this.separators()
        while (!this.is('Dedent') && !this.is('EOF')) { body.push(this.statement()); this.separators() }
        this.take('Dedent'); return body
    }
    private parameters(): Parameter[] {
        this.take('LeftParen'); const params: Parameter[] = []
        let optionalSeen = false, restSeen = false
        while (!this.is('RightParen')) {
            const rest = this.is('Dot') && this.tokens[this.pos + 1]?.type === 'Dot' && this.tokens[this.pos + 2]?.type === 'Dot'
            if (rest) this.pos += 3
            if (restSeen) this.fail('A rest parameter must be the last parameter')
            const { name, loc } = this.identifier(), type = this.match('Colon') ? this.type() : undefined, defaultValue = this.match('Equal') ? this.expression() : undefined
            if (rest && defaultValue !== undefined) this.fail('A rest parameter cannot have a default value')
            if (rest && !type) this.fail('A rest parameter must have an array type')
            if (rest && type && type.kind !== 'ArrayType' && !(type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray'))) this.fail('A rest parameter must have an array type')
            if (!rest && defaultValue !== undefined) optionalSeen = true
            else if (!rest && optionalSeen) this.fail('Parameters with default values must follow parameters without default values')
            params.push({ name, loc, type, defaultValue, rest })
            restSeen ||= rest
            if (!this.match('Comma') && !this.is('RightParen')) this.fail("Expected ',' or ')' in parameters")
        }
        this.take('RightParen'); return params
    }
    private genericNames(): { name: string; loc: Loc }[] {
        const names: { name: string; loc: Loc }[] = []
        do { names.push(this.identifier()) } while (this.match('Comma'))
        this.take('Greater')
        return names
    }
    private type(): TypeNode {
        while (this.match('Newline') || this.match('Indent')) {}
        if (this.is('Pipe') || this.is('Ampersand')) {
            const operator = this.current.type
            const parts: TypeNode[] = []
            while (this.is(operator)) {
                this.pos++
                while (this.match('Newline') || this.match('Indent')) {}
                parts.push(this.typeAtom())
                while (this.match('Newline')) {}
            }
            const kind = operator === 'Pipe' ? 'UnionType' : 'IntersectionType'
            return parts.length === 1 ? parts[0] : { kind, types: parts }
        }
        const optional = () => {
            let value = this.typeAtom()
            if (this.match('Question')) value = { kind: 'UnionType', types: [value, { kind: 'NamedType', name: 'null' }] }
            return value
        }
        let left = optional()
        while (this.is('Pipe') || this.is('Ampersand') || this.is('Newline') && (this.tokens[this.pos + 1]?.type === 'Pipe' || this.tokens[this.pos + 1]?.type === 'Ampersand') || this.is('Newline') && this.tokens[this.pos + 1]?.type === 'Indent' && (this.tokens[this.pos + 2]?.type === 'Pipe' || this.tokens[this.pos + 2]?.type === 'Ampersand')) {
            while (this.match('Newline') || this.match('Indent')) {}
            const operator = this.current.type
            if (operator !== 'Pipe' && operator !== 'Ampersand') break
            this.pos++
            while (this.match('Newline') || this.match('Indent')) {}
            const right = optional(), kind = operator === 'Pipe' ? 'UnionType' : 'IntersectionType'
            left = left.kind === kind ? { ...left, types: [...left.types, right] } : { kind, types: [left, right] }
        }
        return left
    }
    private typeAtom(): TypeNode {
        let result: TypeNode
        if (this.match('Minus')) {
            const minus = this.tokens[this.pos - 1]
            const number = this.take('Number', 'Expected a number after \'-\' in literal type')
            result = { kind: 'LiteralType', value: -(this.value(number) as number), loc: this.loc(minus) }
        } else if (this.match('Number')) {
            const token = this.tokens[this.pos - 1]
            result = { kind: 'LiteralType', value: this.value(token) as number, loc: this.loc(token) }
        } else if (this.match('String')) {
            const token = this.tokens[this.pos - 1]
            result = { kind: 'LiteralType', value: this.value(token) as string, loc: this.loc(token) }
        } else if (this.match('Keyword', 'true') || this.match('Keyword', 'false')) {
            const token = this.tokens[this.pos - 1]
            result = { kind: 'LiteralType', value: this.value(token) === 'true', loc: this.loc(token) }
        } else if (this.match('LeftBrace')) {
            const members: TypeMember[] = []; this.objectSeparators()
            while (!this.is('RightBrace') && !this.is('EOF')) {
                const readonly = this.match('Keyword', 'readonly'), constant = this.match('Keyword', 'const')
                const accessor = this.is('Identifier') && ['get', 'set'].includes(String(this.value(this.current))) && this.tokens[this.pos + 1]?.type === 'Identifier'
                    ? String(this.value(this.tokens[this.pos++])) as 'get' | 'set'
                    : undefined
                const { name, loc } = this.propertyName(); let optional = this.match('Question')
                let params: Parameter[] | undefined, method = false, type: TypeNode, body: Statement[] | undefined
                if (this.is('LeftParen')) {
                    method = true
                    params = this.parameters()
                    const returnType = this.match('Colon') ? this.type() : undefined
                    if (this.match('Equal')) {
                        body = this.is('Newline') ? this.block() : [{ kind: 'Return', value: this.expression() }]
                        type = returnType ?? { kind: 'NamedType', name: 'any' }
                    } else type = returnType ?? { kind: 'NamedType', name: 'void' }
                }
                else {
                    if (this.match('Colon')) type = this.type()
                    else if (this.is('Equal')) type = { kind: 'NamedType', name: 'any' }
                    else this.fail("Expected ':' or '=' after field name")
                }
                const defaultValue = this.match('Equal') ? this.expression() : undefined
                if (constant && defaultValue === undefined) this.fail('const type fields need a default value')
                if (!method && defaultValue && type.kind === 'NamedType' && type.name === 'any') type = inferredTypeNode(defaultValue)
                if (accessor === 'get' && params?.length) this.fail('A getter cannot have parameters')
                if (accessor === 'set' && params?.length !== 1) this.fail('A setter must have exactly one parameter')
                const accessorType = accessor === 'set' ? params?.[0]?.type ?? { kind: 'NamedType', name: 'any' } : type
                members.push({ name, loc, optional, readonly, constant, type: accessorType, defaultValue, method, accessor, params, body }); this.objectSeparators()
            }
            this.take('RightBrace'); result = { kind: 'ObjectType', members }
        } else if (this.match('LeftParen')) {
            const args: TypeNode[] = []; if (!this.is('RightParen')) do { args.push(this.type()) } while (this.match('Comma'))
            this.take('RightParen'); if (this.match('Arrow') || this.match('FatArrow')) result = { kind: 'FunctionType', params: args, result: this.type() }; else if (args.length === 1) result = args[0]; else this.fail('Expected function return type after -> or =>')
        } else if (this.match('Keyword', 'null')) {
            result = { kind: 'NamedType', name: 'null', loc: this.loc(this.tokens[this.pos - 1]) }
        } else {
            const { name, loc } = this.identifier(); let args: TypeNode[] = []
            if (this.match('Less')) { args.push(this.type()); while (this.match('Comma')) args.push(this.type()); this.take('Greater') }
            result = args.length ? { kind: 'GenericType', name, args, loc } : { kind: 'NamedType', name, loc }
        }
        while (this.match('LeftBracket')) { this.take('RightBracket'); result = { kind: 'ArrayType', element: result } }
        return result
    }
    private expression(min = 0): Expression {
        let left = this.prefix()
        let typeArguments: TypeNode[] | undefined
        while (true) {
            // Generic call type arguments are compile-time only: parse and discard them here.
            if (this.is('Less') && (left.kind === 'Identifier' || left.kind === 'Member')) {
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
            if (this.match('Dot')) {
                const property = this.propertyName()
                left = { kind: 'Member', object: left, property: property.name, optional: false, loc: property.loc }
                continue
            }
            if (this.is('Question') && this.tokens[this.pos + 1]?.type === 'Dot') {
                this.pos += 2
                const property = this.propertyName()
                left = { kind: 'Member', object: left, property: property.name, optional: true, loc: property.loc }
                continue
            }
            if (this.match('LeftBracket')) {
                const token = this.tokens[this.pos - 1]
                const index = this.expression()
                this.take('RightBracket', "Expected ']' after index")
                left = { kind: 'Index', object: left, index, loc: this.loc(token) }
                continue
            }
            if (this.match('LeftParen')) {
                const args: Expression[] = []
                this.parenthesisSeparators()
                if (!this.is('RightParen')) do {
                    args.push(this.expression())
                    this.parenthesisSeparators()
                } while (this.match('Comma') && (this.parenthesisSeparators(), true))
                this.take('RightParen')
                left = { kind: 'Call', callee: left, args, typeArguments }; typeArguments = undefined; continue
            }
            if (this.match('Bang')) {
                const token = this.tokens[this.pos - 1]
                left = { kind: 'Unary', operator: 'postfix!', operand: left, loc: this.loc(token) }
                continue
            }
            if (this.match('Increment') || this.match('Decrement')) {
                const token = this.tokens[this.pos - 1]
                if (!['Identifier', 'Member', 'Index'].includes(left.kind)) this.fail('Increment and decrement require an assignable target')
                left = { kind: 'Unary', operator: token.type === 'Increment' ? 'postfix++' : 'postfix--', operand: left, loc: this.loc(token) }
                continue
            }
            if (this.is('Question') && min <= 0) {
                const token = this.current
                this.pos++
                const consequent = this.expression()
                this.take('Colon', "Expected ':' in conditional expression")
                const alternate = this.expression()
                left = { kind: 'Conditional', condition: left, consequent, alternate, loc: this.loc(token) }
                continue
            }
            const op = opTypes[this.current.type], p = op ? precedence[op] : undefined
            if (!op || p === undefined || p < min) break
            const operatorToken = this.current
            this.pos++; left = { kind: 'Binary', operator: op, left, right: this.expression(p + 1), loc: this.loc(operatorToken) }
        }
        return left
    }
    private templateExpression(value: string, loc: Loc): Expression {
        const parts: (string | Expression)[] = []
        let cursor = 0
        while (cursor < value.length) {
            const start = value.indexOf('${', cursor)
            if (start < 0) {
                parts.push(value.slice(cursor).replace(/\uE000/g, '$'))
                break
            }
            if (start > cursor) parts.push(value.slice(cursor, start).replace(/\uE000/g, '$'))
            let depth = 1, quote = '', escaped = false, end = start + 2
            for (; end < value.length; end++) {
                const char = value[end]
                if (escaped) { escaped = false; continue }
                if (char === '\\') { escaped = true; continue }
                if (quote) { if (char === quote) quote = ''; continue }
                if (char === '"' || char === "'" || char === '`') { quote = char; continue }
                if (char === '{') depth++
                else if (char === '}' && --depth === 0) break
            }
            if (depth !== 0) this.fail('Unterminated string interpolation')
            const rawSource = value.slice(start + 2, end)
            const leadingWhitespace = rawSource.length - rawSource.trimStart().length
            const source = rawSource.trim()
            if (!source) this.fail('String interpolation cannot be empty')
            const expression = new Parser(Lexer(source).tokenize()).parseExpressionOnly()
            const offset = start + 2 + leadingWhitespace
            const shiftLoc = (loc: Loc | undefined): Loc | undefined => {
                if (!loc) return loc
                const absoluteOffset = offset + loc.column - 1
                const before = value.slice(0, absoluteOffset)
                const lastNewline = before.lastIndexOf('\n')
                return {
                    line: loc.line + (before.match(/\n/g)?.length ?? 0),
                    column: (lastNewline < 0 ? loc.column + offset : absoluteOffset - lastNewline) + (loc.line > 1 ? loc.column - 1 : 0)
                }
            }
            const shiftExpression = (node: Expression): void => {
                if ('loc' in node) node.loc = shiftLoc(node.loc)
                switch (node.kind) {
                    case 'Template':
                        for (const part of node.parts) if (typeof part !== 'string') shiftExpression(part)
                        break
                    case 'RegEx': break
                    case 'Array': node.elements.forEach(shiftExpression); break
                    case 'Object':
                        for (const property of node.properties) {
                            property.keyLoc = shiftLoc(property.keyLoc)
                            shiftExpression(property.value)
                        }
                        break
                    case 'Unary': shiftExpression(node.operand); break
                    case 'Assignment': shiftExpression(node.value); break
                    case 'MemberAssignment': node.propertyLoc = shiftLoc(node.propertyLoc); shiftExpression(node.object); if (node.index) shiftExpression(node.index); shiftExpression(node.value); break
                    case 'Binary': shiftExpression(node.left); shiftExpression(node.right); break
                    case 'Conditional': shiftExpression(node.condition); shiftExpression(node.consequent); shiftExpression(node.alternate); break
                    case 'Member': shiftExpression(node.object); break
                    case 'Index': shiftExpression(node.object); shiftExpression(node.index); break
                    case 'Call': shiftExpression(node.callee); node.args.forEach(shiftExpression); break
                    case 'Function':
                        for (const param of node.params) {
                            param.loc = shiftLoc(param.loc)
                            if (param.defaultValue) shiftExpression(param.defaultValue)
                        }
                        node.body.forEach(shiftStatement)
                        if (node.expressionBody) shiftExpression(node.expressionBody)
                        break
                }
            }
            const shiftStatement = (statement: Statement): void => {
                if ('loc' in statement) statement.loc = shiftLoc(statement.loc)
                switch (statement.kind) {
                    case 'Variable': if (statement.initializer) shiftExpression(statement.initializer); break
                    case 'ExpressionStatement': shiftExpression(statement.expression); break
                    case 'Return': if (statement.value) shiftExpression(statement.value); break
                    case 'If':
                        shiftExpression(statement.condition)
                        statement.consequent.forEach(shiftStatement)
                        statement.alternate?.forEach(shiftStatement)
                        break
                    case 'ForOf': shiftExpression(statement.iterable); statement.body.forEach(shiftStatement); break
                    case 'While': shiftExpression(statement.condition); statement.body.forEach(shiftStatement); break
                    case 'FunctionDeclaration': statement.body.forEach(shiftStatement); break
                    case 'TypeDeclaration': break
                    case 'Import': break
                }
            }
            shiftExpression(expression)
            parts.push(expression)
            cursor = end + 1
        }
        if (!parts.length) parts.push(value.replace(/\uE000/g, '$'))
        return { kind: 'Template', parts, loc }
    }
    private prefix(): Expression {
        if (this.match('Increment') || this.match('Decrement')) {
            const token = this.tokens[this.pos - 1]
            const operand = this.expression(8)
            if (!['Identifier', 'Member', 'Index'].includes(operand.kind)) this.fail('Increment and decrement require an assignable target')
            return { kind: 'Unary', operator: token.type === 'Increment' ? 'prefix++' : 'prefix--', operand, loc: this.loc(token) }
        }
        if (this.match('Minus') || this.match('Bang')) {
            const token = this.tokens[this.pos - 1]
            return { kind: 'Unary', operator: token.type === 'Minus' ? '-' : '!', operand: this.expression(7), loc: this.loc(token) }
        }
        if (this.match('BigInt')) {
            const token = this.tokens[this.pos - 1]
            return { kind: 'Literal', value: this.value(token) as bigint, loc: this.loc(token) }
        }
        if (this.match('Number')) {
            const token = this.tokens[this.pos - 1]
            return { kind: 'Literal', value: this.value(token) as number, loc: this.loc(token) }
        }
        if (this.match('String')) {
            const token = this.tokens[this.pos - 1]
            const value = this.value(token) as string
            return value.includes('${') ? this.templateExpression(value, this.loc(token)) : { kind: 'Literal', value: value.replace(/\uE000/g, '$'), loc: this.loc(token) }
        }
        if (this.match('RegEx')) {
            const token = this.tokens[this.pos - 1] as Extract<Token, { type: 'RegEx' }>
            return { kind: 'RegEx', source: token.value.source, flags: token.value.flags, loc: this.loc(token) }
        }
        if (this.match('Keyword', 'true')) return { kind: 'Literal', value: true, loc: this.loc(this.tokens[this.pos - 1]) }
        if (this.match('Keyword', 'false')) return { kind: 'Literal', value: false, loc: this.loc(this.tokens[this.pos - 1]) }
        if (this.match('Keyword', 'null')) return { kind: 'Literal', value: null, loc: this.loc(this.tokens[this.pos - 1]) }
        if (this.match('Identifier')) {
            const token = this.tokens[this.pos - 1]
            return { kind: 'Identifier', name: String(this.value(token)), loc: this.loc(token) }
        }
        if (this.match('LeftParen')) {
            const saved = this.pos
            let arrow = false
            try {
                const params: Parameter[] = []
                if (!this.is('RightParen')) {
                    do {
                        const rest = this.is('Dot') && this.tokens[this.pos + 1]?.type === 'Dot' && this.tokens[this.pos + 2]?.type === 'Dot'
                        if (rest) this.pos += 3
                        const { name, loc } = this.identifier(), type = this.match('Colon') ? this.type() : undefined
                        if (rest && (!type || (type.kind !== 'ArrayType' && !(type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray'))))) this.fail('A rest parameter must have an array type')
                        params.push({ name, loc, type, rest })
                    } while (this.match('Comma'))
                }
                this.take('RightParen')
                const hasReturnType = this.match('Colon')
                const returnType = hasReturnType ? this.type() : undefined
                if (hasReturnType && this.match('FatArrow')) {
                    arrow = true
                    if (this.match('Newline')) {
                        this.take('Indent', 'Expected an indented function body')
                        const body: Statement[] = []; this.separators()
                        while (!this.is('Dedent') && !this.is('EOF')) { body.push(this.statement()); this.separators() }
                        this.take('Dedent')
                        return { kind: 'Function', params, returnType, body }
                    }
                    return { kind: 'Function', params, returnType, body: [], expressionBody: this.expression() }
                }
                if (this.match('FatArrow')) {
                    arrow = true
                    if (this.match('Newline')) {
                        this.take('Indent', 'Expected an indented function body')
                        const body: Statement[] = []; this.separators()
                        while (!this.is('Dedent') && !this.is('EOF')) { body.push(this.statement()); this.separators() }
                        this.take('Dedent')
                        return { kind: 'Function', params, returnType, body }
                    }
                    const expressionBody = this.expression()
                    return { kind: 'Function', params, returnType, body: [], expressionBody }
                }
            } catch (error) { if (arrow) throw error /* Otherwise try parsing as a grouped expression. */ }
            this.pos = saved
            const value = this.expression(); this.take('RightParen'); return value
        }
        if (this.match('LeftBracket')) {
            const token = this.tokens[this.pos - 1]
            const elements: Expression[] = []
            this.parenthesisSeparators()
            while (!this.is('RightBracket') && !this.is('EOF')) {
                elements.push(this.expression())
                this.parenthesisSeparators()
                if (this.match('Comma')) this.parenthesisSeparators()
                else if (!this.is('RightBracket')) this.fail("Expected ',' or ']' in array")
            }
            this.take('RightBracket')
            return { kind: 'Array', elements, loc: this.loc(token) }
        }
        if (this.match('LeftBrace')) {
            const token = this.tokens[this.pos - 1]
            const properties: { key: string; keyLoc?: Loc; value: Expression; accessor?: 'get' | 'set'; spread?: boolean; readonly?: boolean }[] = []; this.objectSeparators()
            while (!this.is('RightBrace') && !this.is('EOF')) {
                if (this.match('Ellipsis')) {
                    const value = this.expression()
                    properties.push({ key: '', keyLoc: 'loc' in value ? value.loc : undefined, value, spread: true })
                    this.objectSeparators()
                    if (this.match('Comma')) this.objectSeparators()
                    continue
                }
                const readonly = this.match('Keyword', 'readonly')
                const explicitFunction = this.match('Keyword', 'fun')
                const accessor = this.is('Identifier') && ['get', 'set'].includes(String(this.value(this.current))) && this.tokens[this.pos + 1]?.type === 'Identifier'
                    ? String(this.value(this.tokens[this.pos++])) as 'get' | 'set'
                    : undefined
                const property = this.propertyName()
                let value: Expression
                if (accessor) {
                    const params = this.parameters()
                    const returnType = this.match('Colon') ? this.type() : undefined
                    if (accessor === 'get' && params.length) this.fail('A getter cannot have parameters')
                    if (accessor === 'set' && params.length !== 1) this.fail('A setter must have exactly one parameter')
                    this.take('Equal', "Expected '=' before accessor body")
                    value = { kind: 'Function', params, returnType, body: this.block() }
                }
                else if (this.match('Colon')) value = this.expression()
                else if (this.match('LeftParen')) { this.pos--; const params = this.parameters(); this.take('Equal', "Expected '=' for method body"); value = { kind: 'Function', params, body: this.block() } }
                else if (explicitFunction) this.fail("Expected '(' after object function name")
                else value = { kind: 'Identifier', name: property.name, loc: property.loc }
                properties.push({ key: property.name, keyLoc: property.loc, value, accessor, readonly })
                this.objectSeparators()
                if (this.match('Comma')) this.objectSeparators()
            }
            this.take('RightBrace'); return { kind: 'Object', properties, loc: this.loc(token) }
        }
        if (this.match('Keyword', 'fun')) { const params = this.parameters(), returnType = this.match('Colon') ? this.type() : undefined; this.take('Equal'); return { kind: 'Function', params, returnType, body: this.block() } }
        this.fail('Expected expression')
    }
}

type InferredType =
    | { kind: 'primitive'; name: string }
    | { kind: 'literal'; value: string | number | boolean }
    | { kind: 'union'; types: InferredType[] }
    | { kind: 'array'; element: InferredType }
    | { kind: 'object'; fields: Map<string, InferredType> }
    | { kind: 'function'; params?: { type: InferredType; optional: boolean; rest: boolean }[]; result?: InferredType }
    | { kind: 'unknown' }

const unknownType: InferredType = { kind: 'unknown' }
function primitive(name: string): InferredType { return { kind: 'primitive', name } }

function inferredTypeNode(expression: Expression): TypeNode {
    switch (expression.kind) {
        case 'RegEx': return { kind: 'NamedType', name: 'RegEx' }
        case 'Literal': return { kind: 'NamedType', name: typeof expression.value === 'bigint' ? 'BigInt' : expression.value === null ? 'null' : typeof expression.value }
        case 'Template': return { kind: 'NamedType', name: 'string' }
        case 'Array': return { kind: 'ArrayType', element: expression.elements[0] ? inferredTypeNode(expression.elements[0]) : { kind: 'NamedType', name: 'any' } }
        case 'Object': return { kind: 'ObjectType', members: expression.properties.flatMap(property => property.accessor === 'set' ? [] : [{
            name: property.key,
            type: property.accessor === 'get' && property.value.kind === 'Function' ? property.value.returnType ?? { kind: 'NamedType', name: 'any' } : inferredTypeNode(property.value),
            optional: false,
            readonly: false,
            constant: false
        }]) }
        case 'Conditional': return inferredTypeNode(expression.consequent)
        default: return { kind: 'NamedType', name: 'any' }
    }
}

function inferExpressionType(
    expression: Expression,
    variables: Map<string, InferredType>
): InferredType {
    switch (expression.kind) {
        case 'RegEx': return primitive('RegEx')
        case 'Literal':
            if (typeof expression.value === 'bigint') return primitive('BigInt')
            if (typeof expression.value === 'number' || typeof expression.value === 'string' || typeof expression.value === 'boolean') return { kind: 'literal', value: expression.value }
            return primitive('null')

        case 'Template':
            return primitive('string')

        case 'Identifier':
            return variables.get(expression.name) ?? unknownType

        case 'Array': {
            if (expression.elements.length === 0) return { kind: 'array', element: unknownType }
            const elements = expression.elements.map(element => inferExpressionType(element, variables))
            return { kind: 'array', element: commonType(elements) }
        }

        case 'Object':
            return {
                kind: 'object',
                fields: new Map(expression.properties.filter(property => property.accessor !== 'set').map(property => [
                    property.key,
                    property.accessor === 'get' && property.value.kind === 'Function'
                        ? property.value.returnType ? typeFromNode(property.value.returnType) : inferFunctionReturnType(property.value.body, variables)
                        : inferExpressionType(property.value, variables)
                ]))
            }

        case 'Unary':
            if (expression.operator === '-' && expression.operand.kind === 'Literal' && typeof expression.operand.value === 'number') return { kind: 'literal', value: -expression.operand.value }
            return inferExpressionType(expression.operand, variables)

        case 'Conditional':
            return commonType([inferExpressionType(expression.consequent, variables), inferExpressionType(expression.alternate, variables)])

        case 'Member': {
            const object = inferExpressionType(expression.object, variables)
            return object.kind === 'object' ? object.fields.get(expression.property) ?? unknownType : unknownType
        }

        case 'Index': {
            const object = inferExpressionType(expression.object, variables)
            const index = inferExpressionType(expression.index, variables)
            if (object.kind === 'array') return object.element
            if (object.kind === 'object' && index.kind === 'primitive' && (index.name === 'string' || index.name === 'number')) {
                if (expression.index.kind === 'Literal') return object.fields.get(String(expression.index.value)) ?? unknownType
                return object.fields.size ? commonType([...object.fields.values()]) : unknownType
            }
            return unknownType
        }

        case 'Binary': {
            const left = inferExpressionType(expression.left, variables)
            const right = inferExpressionType(expression.right, variables)
            const operator = expression.operator

            if (operator === '??') return left.kind === 'primitive' && left.name === 'null' ? right : left
            if (operator === '&' || operator === '|') return primitive('boolean')

            if (left.kind !== 'primitive' || right.kind !== 'primitive') return unknownType
            const leftName = left.name, rightName = right.name

            if (operator === '+') {
                const allowed =
                    (leftName === 'number' && rightName === 'number') ||
                    (leftName === 'string' && rightName === 'string') ||
                    (leftName === 'BigInt' && rightName === 'BigInt')

                if (!allowed) {
                    throw new SyntaxError(
                        `Invalid operands for '+': ${leftName} and ${rightName}. ` +
                        `Use number + number, string + string, or BigInt + BigInt.`
                    )
                }

                return left
            }

            if (operator === '*' || operator === '/') {
                const allowed =
                    (leftName === 'number' && rightName === 'number') ||
                    (leftName === 'BigInt' && rightName === 'BigInt')

                if (!allowed) {
                    throw new SyntaxError(
                        `Invalid operands for '${operator}': ${leftName} and ${rightName}. ` +
                        `Both operands must be number or both must be BigInt.`
                    )
                }

                return left
            }

            if (operator === '-') {
                const allowed =
                    (leftName === 'number' && rightName === 'number') ||
                    (leftName === 'BigInt' && rightName === 'BigInt')

                if (!allowed) {
                    throw new SyntaxError(
                        `Invalid operands for '-': ${leftName} and ${rightName}. ` +
                        `Both operands must be number or both must be BigInt.`
                    )
                }

                return left
            }

            if (operator === '<') {
                const allowed =
                    (leftName === 'number' && rightName === 'number') ||
                    (leftName === 'BigInt' && rightName === 'BigInt')

                if (!allowed) {
                    throw new SyntaxError(
                        `Invalid operands for '<': ${leftName} and ${rightName}. ` +
                        `Both operands must be number or both must be BigInt.`
                    )
                }

                return primitive('boolean')
            }

            if (operator === '>') {
                const allowed =
                    (leftName === 'number' && rightName === 'number') ||
                    (leftName === 'BigInt' && rightName === 'BigInt')

                if (!allowed) {
                    throw new SyntaxError(
                        `Invalid operands for '>': ${leftName} and ${rightName}. ` +
                        `Both operands must be number or both must be BigInt.`
                    )
                }

                return primitive('boolean')
            }

            if (operator === '<=') {
                const allowed =
                    (leftName === 'number' && rightName === 'number') ||
                    (leftName === 'BigInt' && rightName === 'BigInt')

                if (!allowed) {
                    throw new SyntaxError(
                        `Invalid operands for '<=': ${leftName} and ${rightName}. ` +
                        `Both operands must be number or both must be BigInt.`
                    )
                }

                return primitive('boolean')
            }

            if (operator === '>=') {
                const allowed =
                    (leftName === 'number' && rightName === 'number') ||
                    (leftName === 'BigInt' && rightName === 'BigInt')

                if (!allowed) {
                    throw new SyntaxError(
                        `Invalid operands for '>=': ${leftName} and ${rightName}. ` +
                        `Both operands must be number or both must be BigInt.`
                    )
                }

                return primitive('boolean')
            }

            return unknownType
        }

        case 'Assignment':
            return unknownType
        case 'MemberAssignment':
            return unknownType
        case 'Function': {
            const scope = new Map(variables)
            for (const param of expression.params) {
                const declared = param.type ? typeFromNode(param.type) : undefined
                const inferred = param.defaultValue ? inferExpressionType(param.defaultValue, scope) : unknownType
                const parameterType = declared ?? (param.rest ? { kind: 'array', element: inferred } as InferredType : inferred)
                scope.set(param.name, parameterType)
            }
            const result = expression.returnType
                ? typeFromNode(expression.returnType)
                : expression.expressionBody
                    ? inferExpressionType(expression.expressionBody, scope)
                    : inferFunctionReturnType(expression.body, scope)
            return { kind: 'function', params: expression.params.map(param => ({
                type: param.type ? typeFromNode(param.type) : param.defaultValue ? inferExpressionType(param.defaultValue, scope) : unknownType,
                optional: param.defaultValue !== undefined,
                rest: param.rest === true
            })), result }
        }
        case 'Call': {
            const callee = inferExpressionType(expression.callee, variables)
            if (callee.kind !== 'function') return unknownType
            if (callee.params) {
                const required = callee.params.filter(param => !param.optional && !param.rest).length
                const rest = callee.params.some(param => param.rest)
                const maximum = rest ? Infinity : callee.params.length
                if (expression.args.length < required || expression.args.length > maximum) {
                    throw new SyntaxError(`Expected ${required}${maximum === required ? '' : ` to ${maximum === Infinity ? 'any number of' : maximum}`} arguments, received ${expression.args.length}`)
                }
                expression.args.forEach((argument, index) => {
                    const parameter = callee.params!.find((item, paramIndex) => item.rest ? index >= paramIndex : paramIndex === index)
                    if (!parameter) return
                    const actual = inferExpressionType(argument, variables)
                    if (!isAssignable(parameter.rest && parameter.type.kind === 'array' ? parameter.type.element : parameter.type, actual)) {
                        throw new SyntaxError(`Argument ${index + 1} has type ${describeType(actual)}; expected ${describeType(parameter.rest && parameter.type.kind === 'array' ? parameter.type.element : parameter.type)}`)
                    }
                })
            }
            return callee.result ?? primitive('null')
        }
    }
}

function commonType(types: InferredType[]): InferredType {
    const first = types[0] ?? unknownType
    if (types.every(type => sameType(first, type))) return first
    return unknownType
}

function inferFunctionReturnType(statements: Statement[], variables: Map<string, InferredType>): InferredType {
    const returns: InferredType[] = []
    const collect = (body: Statement[], scope: Map<string, InferredType>) => {
        for (const statement of body) {
            if (statement.kind === 'Return') returns.push(statement.value ? inferExpressionType(statement.value, scope) : primitive('null'))
            else if (statement.kind === 'If') {
                collect(statement.consequent, new Map(scope))
                if (statement.alternate) collect(statement.alternate, new Map(scope))
            } else if (statement.kind === 'While' || statement.kind === 'ForOf') {
                collect(statement.body, new Map(scope))
            } else if (statement.kind === 'Variable' && statement.initializer) {
                scope.set(statement.name, statement.type ? typeFromNode(statement.type) : inferExpressionType(statement.initializer, scope))
            }
        }
    }
    collect(statements, new Map(variables))
    return commonType(returns.length ? returns : [primitive('null')])
}

function sameType(a: InferredType, b: InferredType): boolean {
    if (a.kind !== b.kind) return false
    if (a.kind === 'primitive' && b.kind === 'primitive') return a.name === b.name
    if (a.kind === 'literal' && b.kind === 'literal') return a.value === b.value
    if (a.kind === 'array' && b.kind === 'array') return sameType(a.element, b.element)
    if (a.kind === 'object' && b.kind === 'object') {
        return a.fields.size === b.fields.size && [...a.fields].every(([key, value]) => b.fields.has(key) && sameType(value, b.fields.get(key)!))
    }
    return a.kind === 'function' || a.kind === 'unknown'
}

function typeFromNode(type: TypeNode, aliases: Map<string, TypeNode> = new Map(), resolving = new Set<string>()): InferredType {
    if (type.kind === 'LiteralType') return { kind: 'literal', value: type.value }
    if (type.kind === 'NamedType') {
        const alias = aliases.get(type.name)
        if (alias && !resolving.has(type.name)) {
            const next = new Set(resolving)
            next.add(type.name)
            return typeFromNode(alias, aliases, next)
        }
        return primitive(type.name)
    }
    if (type.kind === 'ArrayType') return { kind: 'array', element: typeFromNode(type.element, aliases, resolving) }
    if (type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray')) {
        return { kind: 'array', element: type.args[0] ? typeFromNode(type.args[0], aliases, resolving) : unknownType }
    }
    if (type.kind === 'GenericType' && ['Partial', 'Required', 'Readonly', 'Pick', 'Omit'].includes(type.name) && type.args[0]) {
        const source = typeFromNode(type.args[0], aliases, resolving)
        if (source.kind !== 'object') return unknownType
        let fields = [...source.fields]
        if (type.name === 'Pick' || type.name === 'Omit') {
            const keyValues = (node: TypeNode | undefined): string[] => {
                if (!node) return []
                if (node.kind === 'LiteralType' && typeof node.value === 'string') return [node.value]
                if (node.kind === 'UnionType') return node.types.flatMap(keyValues)
                if (node.kind === 'ArrayType') return keyValues(node.element)
                return []
            }
            const keys = new Set(keyValues(type.args[1]))
            fields = fields.filter(([key]) => type.name === 'Pick' ? keys.has(key) : !keys.has(key))
        }
        if (type.name === 'Partial') return { kind: 'object', fields: new Map() }
        return { kind: 'object', fields: new Map(fields) }
    }
    if (type.kind === 'ObjectType') return { kind: 'object', fields: new Map(type.members.filter(member => (!member.method || member.accessor === 'get') && member.accessor !== 'set' && !member.optional && member.defaultValue === undefined && !(member.type.kind === 'UnionType' && member.type.types.some(part => part.kind === 'NamedType' && part.name === 'null'))).map(member => [member.name, typeFromNode(member.type, aliases, resolving)])) }
    if (type.kind === 'FunctionType') return { kind: 'function' }
    if (type.kind === 'UnionType') return { kind: 'union', types: type.types.map(part => typeFromNode(part, aliases, resolving)) }
    return unknownType
}

function describeType(type: InferredType): string {
    if (type.kind === 'primitive') return type.name
    if (type.kind === 'literal') return typeof type.value === 'string' ? JSON.stringify(type.value) : String(type.value)
    if (type.kind === 'union') return type.types.map(describeType).join(' | ')
    if (type.kind === 'array') return `${describeType(type.element)}[]`
    if (type.kind === 'object') return `{ ${[...type.fields].map(([key, value]) => `${key}: ${describeType(value)}`).join(', ')} }`
    return type.kind
}

function isAssignable(expected: InferredType, actual: InferredType): boolean {
    if (expected.kind === 'unknown' || actual.kind === 'unknown') return true
    if (expected.kind === 'union') return actual.kind === 'union'
        ? actual.types.every(part => expected.types.some(option => isAssignable(option, part)))
        : expected.types.some(option => isAssignable(option, actual))
    if (actual.kind === 'union') return actual.types.every(part => isAssignable(expected, part))
    if (expected.kind === 'literal') {
        if (actual.kind === 'literal') return expected.value === actual.value
        if (actual.kind === 'primitive') return actual.name === typeof expected.value
        return false
    }
    if (actual.kind === 'literal' && expected.kind === 'primitive') return expected.name === typeof actual.value
    if (expected.kind !== actual.kind) return false
    if (expected.kind === 'primitive' && actual.kind === 'primitive') return expected.name === actual.name
    if (expected.kind === 'array' && actual.kind === 'array') return isAssignable(expected.element, actual.element)
    if (expected.kind === 'object' && actual.kind === 'object') {
        return [...expected.fields].every(([key, type]) => actual.fields.has(key) && isAssignable(type, actual.fields.get(key)!))
    }
    return true
}

function validateArithmeticTypes(statements: Statement[], variables = new Map<string, InferredType>()): void {
    const aliases = new Map<string, TypeNode>()
    for (const statement of statements) {
        if (statement.kind === 'TypeDeclaration') aliases.set(statement.name, statement.value)
        if (statement.kind === 'Export' && statement.declaration.kind === 'TypeDeclaration') aliases.set(statement.declaration.name, statement.declaration.value)
        if (statement.kind === 'Import' && statement.importedTypes) for (const [name, value] of Object.entries(statement.importedTypes)) aliases.set(name, value)
    }
    for (const statement of statements) if (statement.kind === 'Import' && !statement.importedTypes) {
        try {
            const { readFileSync } = require('node:fs') as typeof import('node:fs')
            const { resolve, dirname } = require('node:path') as typeof import('node:path')
            if (statement.module.startsWith('.')) {
                const base = resolve(process.cwd(), statement.module)
                const file = /\.jn$/i.test(base) ? base : `${base}.jn`
                const imported = new Parser(Lexer(readFileSync(file, 'utf8')).tokenize()).parse()
                for (const item of imported) if (item.kind === 'Export' && item.declaration.kind === 'TypeDeclaration') aliases.set(item.declaration.name, item.declaration.value)
            } else if (statement.module === 'juno' && statement.namedImports.includes('Error')) {
                aliases.set('Error', { kind: 'ObjectType', members: [
                    { name: 'name', type: { kind: 'NamedType', name: 'string' }, optional: false, readonly: false, constant: false },
                    { name: 'message', type: { kind: 'NamedType', name: 'string' }, optional: false, readonly: false, constant: false },
                    { name: 'stack', type: { kind: 'NamedType', name: 'string' }, optional: true, readonly: false, constant: false }
                ] })
            }
        } catch { /* unresolved modules are reported by the interpreter */ }
    }
    for (const statement of statements) {
        switch (statement.kind) {
            case 'Variable': {
                const declaredType = statement.type ? typeFromNode(statement.type, aliases) : undefined
                const inferredType = statement.initializer
                    ? inferExpressionType(statement.initializer, variables)
                    : undefined

                const type = declaredType ?? inferredType
                if (type) variables.set(statement.name, type)

                if (statement.initializer) {
                    const actual = inferExpressionType(statement.initializer, variables)
                    if (declaredType && !isAssignable(declaredType, actual)) {
                        throw new SyntaxError(`Cannot assign ${describeType(actual)} to ${describeType(declaredType)} for '${statement.name}'`)
                    }
                }
                break
            }

            case 'ExpressionStatement':
                inferExpressionType(statement.expression, variables)
                break

            case 'Return':
                if (statement.value) inferExpressionType(statement.value, variables)
                break

            case 'If':
                inferExpressionType(statement.condition, variables)
                validateArithmeticTypes(statement.consequent, new Map(variables))
                if (statement.alternate) {
                    validateArithmeticTypes(statement.alternate, new Map(variables))
                }
                break

            case 'While':
                inferExpressionType(statement.condition, variables)
                validateArithmeticTypes(statement.body, new Map(variables))
                break

            case 'ForOf':
                inferExpressionType(statement.iterable, variables)
                validateArithmeticTypes(statement.body, new Map(variables))
                break

            case 'FunctionDeclaration':
                {
                    const scope = new Map(variables)
                    const params = statement.params.map(param => {
                        const declared = param.type ? typeFromNode(param.type, aliases) : undefined
                        const inferred = param.defaultValue ? inferExpressionType(param.defaultValue, scope) : unknownType
                        const type = declared ?? (param.rest ? { kind: 'array', element: inferred } as InferredType : inferred)
                        scope.set(param.name, type)
                        return { type: param.rest && type.kind !== 'array' ? unknownType : type, optional: param.defaultValue !== undefined, rest: param.rest === true }
                    })
                    validateArithmeticTypes(statement.body, scope)
                    const result = statement.returnType
                        ? typeFromNode(statement.returnType, aliases)
                        : inferFunctionReturnType(statement.body, scope)
                    variables.set(statement.name, { kind: 'function', params, result })
                }
                break

            case 'Import':
            case 'TypeDeclaration':
                break
        }
    }
}

export function parse(source: string, options: { validate?: boolean; filePath?: string } = {}): Statement[] {
        const statements = new Parser(Lexer(source).tokenize()).parse()
    const types = new Map<string, TypeNode>()
    const visit = (items: Statement[], seen = new Set<string>()): void => {
        for (const item of items) {
            if (item.kind === 'Export' && item.declaration.kind === 'TypeDeclaration') types.set(item.declaration.name, item.declaration.value)
            if (item.kind === 'TypeDeclaration') types.set(item.name, item.value)
            if (item.kind === 'Import' && item.module.startsWith('.')) {
                try {
                    const fs = require('node:fs') as typeof import('node:fs')
                    const path = require('node:path') as typeof import('node:path')
                    const base = path.resolve(options.filePath ? path.dirname(options.filePath) : process.cwd(), item.module)
                    const candidates = /\.jn$/i.test(base) ? [base] : [`${base}.jn`, path.resolve(base, 'index.jn')]
                    const file = candidates.find(candidate => fs.existsSync(candidate))
                    if (!file || seen.has(file)) continue
                    const nested = visitParsed(file, seen)
                    for (const [name, value] of nested) if (item.namedImports.includes(name)) types.set(name, value)
                } catch { /* module loading diagnostics are handled separately */ }
            }
            if (item.kind === 'Export' && item.declaration.kind === 'Import') visit([item.declaration], seen)
        }
    }
    const visitParsed = (file: string, seen: Set<string>): Map<string, TypeNode> => {
        seen.add(file)
        const nested = new Map<string, TypeNode>()
        const parsed = new Parser(Lexer((require('node:fs') as typeof import('node:fs')).readFileSync(file, 'utf8')).tokenize()).parse()
        for (const item of parsed) {
            if (item.kind === 'Export' && item.declaration.kind === 'TypeDeclaration') nested.set(item.declaration.name, item.declaration.value)
            else if (item.kind === 'TypeDeclaration') nested.set(item.name, item.value)
            else if (item.kind === 'Export' && item.declaration.kind === 'Import' && item.declaration.importedTypes) for (const [name, value] of Object.entries(item.declaration.importedTypes)) nested.set(name, value)
        }
        return nested
    }
    visit(statements)
    for (const item of statements) if (item.kind === 'Import' && item.module === 'juno' && item.namedImports.includes('Error')) types.set('Error', { kind: 'ObjectType', members: [
        { name: 'name', type: { kind: 'NamedType', name: 'string' }, optional: false, readonly: false, constant: false },
        { name: 'message', type: { kind: 'NamedType', name: 'string' }, optional: false, readonly: false, constant: false },
        { name: 'stack', type: { kind: 'NamedType', name: 'string' }, optional: true, readonly: false, constant: false }
    ] })
    for (const item of statements) if (item.kind === 'Import') {
        item.importedTypes = Object.fromEntries([...types].filter(([name]) => item.namedImports.includes(name)))
    }
    if (options.validate !== false) {
        validateDeclarations(statements)
        validateArithmeticTypes(statements)
    }
    return statements
}

function validateDeclarations(statements: Statement[], initialNames: Set<string> = new Set()): void {
    const names = new Set(initialNames)
    for (const statement of statements) {
        const declarations: string[] = []
        if (statement.kind === 'Import') declarations.push(...(statement.defaultImport ? [statement.defaultImport] : []), ...statement.namedImports)
        else if (statement.kind === 'Variable' || statement.kind === 'FunctionDeclaration' || statement.kind === 'TypeDeclaration') declarations.push(statement.name)
        for (const name of declarations) {
            if (names.has(name)) throw new SyntaxError(`Duplicate declaration '${name}' in the same scope`)
            names.add(name)
        }
        if (statement.kind === 'If') { validateDeclarations(statement.consequent); if (statement.alternate) validateDeclarations(statement.alternate) }
        else if (statement.kind === 'While' || statement.kind === 'ForOf') validateDeclarations(statement.body)
        else if (statement.kind === 'FunctionDeclaration') {
            const functionNames = new Set(statement.params.map(param => param.name))
            validateDeclarations(statement.body, functionNames)
        }
    }
}
