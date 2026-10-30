import { Lexer, Token, TokenType } from './lexer'

export type Loc = { line: number; column: number }
export type TypeNode = { kind: 'NamedType'; name: string; loc?: Loc } | { kind: 'GenericType'; name: string; args: TypeNode[]; loc?: Loc } | { kind: 'UnionType' | 'IntersectionType'; types: TypeNode[] } | { kind: 'ArrayType'; element: TypeNode } | { kind: 'ObjectType'; members: TypeMember[] } | { kind: 'FunctionType'; params: TypeNode[]; result: TypeNode }
export type TypeMember = { name: string; loc?: Loc; type: TypeNode; optional: boolean; readonly: boolean; constant: boolean; defaultValue?: Expression; method?: boolean; params?: Parameter[] }
export type Parameter = { name: string; loc?: Loc; type?: TypeNode; defaultValue?: Expression }
export type Expression =
    | { kind: 'Literal'; value: string | number | bigint | boolean | null; loc?: Loc }
    | { kind: 'Identifier'; name: string; loc?: Loc } | { kind: 'Array'; elements: Expression[]; loc?: Loc }
    | { kind: 'Object'; properties: { key: string; keyLoc?: Loc; value: Expression }[]; loc?: Loc }
    | { kind: 'Unary'; operator: string; operand: Expression; loc?: Loc }
    | { kind: 'Assignment'; name: string; loc?: Loc; operatorLoc?: Loc; value: Expression }
    | { kind: 'Binary'; operator: string; left: Expression; right: Expression; loc?: Loc }
    | { kind: 'Member'; object: Expression; property: string; optional: boolean; loc?: Loc }
    | { kind: 'Index'; object: Expression; index: Expression; loc?: Loc }
    | { kind: 'Call'; callee: Expression; args: Expression[]; typeArguments?: TypeNode[] }
    | { kind: 'Function'; params: Parameter[]; returnType?: TypeNode; body: Statement[]; expressionBody?: Expression }
export type Statement =
    | { kind: 'Variable'; name: string; loc?: Loc; mutable: boolean; type?: TypeNode; initializer?: Expression }
    | { kind: 'Import'; module: 'juno' | 'juno:node'; defaultImport?: string; defaultImportLoc?: Loc; namedImports: string[]; namedImportLocs?: Loc[] }
    | { kind: 'FunctionDeclaration'; name: string; loc?: Loc; params: Parameter[]; returnType?: TypeNode; body: Statement[] }
    | { kind: 'TypeDeclaration'; name: string; loc?: Loc; generics: string[]; genericLocs?: Loc[]; value: TypeNode }
    | { kind: 'Return'; value?: Expression } | { kind: 'ExpressionStatement'; expression: Expression }
    | { kind: 'If'; condition: Expression; consequent: Statement[]; alternate?: Statement[] }
    | { kind: 'ForOf'; binding: string; loc?: Loc; mutable: boolean; iterable: Expression; body: Statement[] }
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
            const mutable = this.value(this.tokens[this.pos - 1]) === 'let', { name, loc } = this.identifier()
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
            const indented = this.match('Newline') && this.match('Indent')
            const value = this.type()
            if (indented) { this.separators(); this.take('Dedent') }
            return { kind: 'TypeDeclaration', name, loc, generics, genericLocs, value }
        }
        if (this.match('Keyword', 'return')) return { kind: 'Return', value: this.is('Newline') || this.is('Dedent') || this.is('EOF') ? undefined : this.expression() }
        if (this.is('Identifier') && (this.tokens[this.pos + 1]?.type === 'Equal')) {
            const { name, loc } = this.identifier(), operatorLoc = this.loc(this.take('Equal'))
            return { kind: 'ExpressionStatement', expression: { kind: 'Assignment', name, loc, operatorLoc, value: this.expression() } }
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
        return { kind: 'ExpressionStatement', expression: this.expression() }
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
        const moduleToken = this.take('String', "Expected 'juno' or 'juno:node' module name")
        const module = this.value(moduleToken)
        if (module !== 'juno' && module !== 'juno:node') this.fail(`Unsupported module '${module}'`)
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
        while (!this.is('RightParen')) {
            const { name, loc } = this.identifier(), type = this.match('Colon') ? this.type() : undefined, defaultValue = this.match('Equal') ? this.expression() : undefined
            params.push({ name, loc, type, defaultValue })
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
        const optional = () => {
            let value = this.typeAtom()
            if (this.match('Question')) value = { kind: 'UnionType', types: [value, { kind: 'NamedType', name: 'null' }] }
            return value
        }
        let left = optional()
        while (this.is('Pipe') || this.is('Ampersand')) { const operator = this.current.type; this.pos++; const right = optional(); const kind = operator === 'Pipe' ? 'UnionType' : 'IntersectionType'; left = left.kind === kind ? { ...left, types: [...left.types, right] } : { kind, types: [left, right] } }
        return left
    }
    private typeAtom(): TypeNode {
        let result: TypeNode
        if (this.match('LeftBrace')) {
            const members: TypeMember[] = []; this.objectSeparators()
            while (!this.is('RightBrace') && !this.is('EOF')) {
                const readonly = this.match('Keyword', 'readonly'), constant = this.match('Keyword', 'const'), { name, loc } = this.propertyName(); let optional = this.match('Question')
                let params: Parameter[] | undefined, method = false, type: TypeNode
                if (this.is('LeftParen')) { method = true; params = this.parameters(); type = this.match('Colon') ? this.type() : { kind: 'NamedType', name: 'void' } }
                else {
                    this.take('Colon', "Expected ':' after field name"); type = this.type()
                    // Accept `field: Type?` as optional property syntax as well as `field?: Type`.
                    if (type.kind === 'UnionType') {
                        const nonNull = type.types.filter(part => !(part.kind === 'NamedType' && part.name === 'null'))
                        if (nonNull.length === 1 && nonNull.length !== type.types.length) { optional = true; type = nonNull[0] }
                    }
                }
                const defaultValue = this.match('Equal') ? this.expression() : undefined
                if (constant && defaultValue === undefined) this.fail('const type fields need a default value')
                members.push({ name, loc, optional, readonly, constant, type, defaultValue, method, params }); this.objectSeparators()
            }
            this.take('RightBrace'); result = { kind: 'ObjectType', members }
        } else if (this.match('LeftParen')) {
            const args: TypeNode[] = []; if (!this.is('RightParen')) do { args.push(this.type()) } while (this.match('Comma'))
            this.take('RightParen'); if (this.match('Arrow')) result = { kind: 'FunctionType', params: args, result: this.type() }; else if (args.length === 1) result = args[0]; else this.fail('Expected function return type after ->')
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
            if (this.match('Dot')) {
                const property = this.identifier()
                left = { kind: 'Member', object: left, property: property.name, optional: false, loc: property.loc }
                continue
            }
            if (this.match('Question') && this.match('Dot')) {
                const property = this.identifier()
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
            if (this.match('LeftParen')) { const args: Expression[] = []; if (!this.is('RightParen')) do { args.push(this.expression()) } while (this.match('Comma')); this.take('RightParen'); left = { kind: 'Call', callee: left, args, typeArguments }; typeArguments = undefined; continue }
            const op = opTypes[this.current.type], p = op ? precedence[op] : undefined
            if (!op || p === undefined || p < min) break
            const operatorToken = this.current
            this.pos++; left = { kind: 'Binary', operator: op, left, right: this.expression(p + 1), loc: this.loc(operatorToken) }
        }
        return left
    }
    private prefix(): Expression {
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
            return { kind: 'Literal', value: this.value(token) as string, loc: this.loc(token) }
        }
        if (this.match('Keyword', 'true')) return { kind: 'Literal', value: true, loc: this.loc(this.tokens[this.pos - 1]) }
        if (this.match('Keyword', 'false')) return { kind: 'Literal', value: false, loc: this.loc(this.tokens[this.pos - 1]) }
        if (this.match('Keyword', 'null')) return { kind: 'Literal', value: null, loc: this.loc(this.tokens[this.pos - 1]) }
        if (this.match('Identifier')) {
            const token = this.tokens[this.pos - 1]
            return { kind: 'Identifier', name: String(this.value(token)), loc: this.loc(token) }
        }
        if (this.match('LeftParen')) {
            const saved = this.pos - 1
            let arrow = false
            try {
                const params: Parameter[] = []
                if (!this.is('RightParen')) {
                    do {
                        const { name, loc } = this.identifier(), type = this.match('Colon') ? this.type() : undefined
                        params.push({ name, loc, type })
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
            const elements: Expression[] = []; if (!this.is('RightBracket')) do { elements.push(this.expression()) } while (this.match('Comma')); this.take('RightBracket'); return { kind: 'Array', elements, loc: this.loc(token) }
        }
        if (this.match('LeftBrace')) {
            const token = this.tokens[this.pos - 1]
            const properties: { key: string; keyLoc?: Loc; value: Expression }[] = []; this.objectSeparators()
            while (!this.is('RightBrace') && !this.is('EOF')) {
                const property = this.propertyName()
                let value: Expression
                if (this.match('Colon')) value = this.expression()
                else if (this.match('LeftParen')) { this.pos--; const params = this.parameters(); this.take('Equal', "Expected '=' for method body"); value = { kind: 'Function', params, body: this.block() } }
                else value = { kind: 'Identifier', name: property.name, loc: property.loc }
                properties.push({ key: property.name, keyLoc: property.loc, value }); this.objectSeparators()
            }
            this.take('RightBrace'); return { kind: 'Object', properties, loc: this.loc(token) }
        }
        if (this.match('Keyword', 'fun')) { const params = this.parameters(), returnType = this.match('Colon') ? this.type() : undefined; this.take('Equal'); return { kind: 'Function', params, returnType, body: this.block() } }
        this.fail('Expected expression')
    }
}

type InferredType =
    | { kind: 'primitive'; name: string }
    | { kind: 'array'; element: InferredType }
    | { kind: 'object'; fields: Map<string, InferredType> }
    | { kind: 'function'; result?: InferredType }
    | { kind: 'unknown' }

const unknownType: InferredType = { kind: 'unknown' }
function primitive(name: string): InferredType { return { kind: 'primitive', name } }

function inferExpressionType(
    expression: Expression,
    variables: Map<string, InferredType>
): InferredType {
    switch (expression.kind) {
        case 'Literal':
            if (typeof expression.value === 'bigint') return primitive('BigInt')
            if (typeof expression.value === 'number') return primitive('number')
            if (typeof expression.value === 'string') return primitive('string')
            if (typeof expression.value === 'boolean') return primitive('boolean')
            return primitive('null')

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
                fields: new Map(expression.properties.map(property => [
                    property.key,
                    inferExpressionType(property.value, variables)
                ]))
            }

        case 'Unary':
            return inferExpressionType(expression.operand, variables)

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
        case 'Function': {
            const result = expression.returnType
                ? typeFromNode(expression.returnType)
                : expression.expressionBody
                    ? inferExpressionType(expression.expressionBody, variables)
                    : inferFunctionReturnType(expression.body, variables)
            return { kind: 'function', result }
        }
        case 'Call': {
            const callee = inferExpressionType(expression.callee, variables)
            return callee.kind === 'function' ? callee.result ?? primitive('null') : unknownType
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
    if (a.kind === 'array' && b.kind === 'array') return sameType(a.element, b.element)
    if (a.kind === 'object' && b.kind === 'object') {
        return a.fields.size === b.fields.size && [...a.fields].every(([key, value]) => b.fields.has(key) && sameType(value, b.fields.get(key)!))
    }
    return a.kind === 'function' || a.kind === 'unknown'
}

function typeFromNode(type: TypeNode, aliases: Map<string, TypeNode> = new Map(), resolving = new Set<string>()): InferredType {
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
    if (type.kind === 'ObjectType') return { kind: 'object', fields: new Map(type.members.filter(member => !member.optional).map(member => [member.name, typeFromNode(member.type, aliases, resolving)])) }
    if (type.kind === 'FunctionType') return { kind: 'function' }
    return unknownType
}

function describeType(type: InferredType): string {
    if (type.kind === 'primitive') return type.name
    if (type.kind === 'array') return `${describeType(type.element)}[]`
    if (type.kind === 'object') return `{ ${[...type.fields].map(([key, value]) => `${key}: ${describeType(value)}`).join(', ')} }`
    return type.kind
}

function isAssignable(expected: InferredType, actual: InferredType): boolean {
    if (expected.kind === 'unknown' || actual.kind === 'unknown') return true
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
                validateArithmeticTypes(statement.body, new Map(variables))
                break

            case 'Import':
            case 'TypeDeclaration':
                break
        }
    }
}

export function parse(source: string, options: { validate?: boolean } = {}): Statement[] {
    const statements = new Parser(Lexer(source).tokenize()).parse()
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
