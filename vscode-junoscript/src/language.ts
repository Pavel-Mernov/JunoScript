import { Expression, Loc, Parameter, Statement, TypeMember, TypeNode, parse } from '../../Lexer/parser'

export type HoverInfo = {
    line: number
    column: number
    length: number
    code: string
    docs?: string
}

export type InlayHintInfo = {
    line: number
    column: number
    label: string
    tooltip: string
    kind: 'type' | 'parameter'
}

export type DiagnosticInfo = {
    line: number
    column: number
    length: number
    message: string
    fix?: { title: string; line: number; fields: { name: string; type: string }[] }
}

type SymbolInfo =
    | { kind: 'var'; mutable: boolean; type: TypeNode; docs?: string }
    | { kind: 'fun'; params: Parameter[]; returnType: TypeNode; docs?: string }
    | { kind: 'type'; generics: string[]; value: TypeNode; docs?: string }
    | { kind: 'module'; module: 'juno' | 'juno:node'; docs?: string }

type Env = Map<string, SymbolInfo>

const named = (name: string): TypeNode => ({ kind: 'NamedType', name })
const arrayOf = (element: TypeNode): TypeNode => ({ kind: 'ArrayType', element })
const optionalParam = (name: string, type: TypeNode): Parameter => ({ name, type })

function method(name: string, params: Parameter[], result: TypeNode): TypeMember {
    return { name, optional: false, readonly: false, constant: false, method: true, params, type: result }
}

function field(name: string, type: TypeNode, readonly = false): TypeMember {
    return { name, optional: false, readonly, constant: false, type }
}

function consoleType(): TypeNode {
    return {
        kind: 'ObjectType',
        members: [
            method('log', [{ name: 'data', type: named('any') }], named('void')),
            field('args', arrayOf(named('string')), true),
            method('read', [optionalParam('encoding', named('string'))], named('string')),
            method('readLines', [optionalParam('encoding', named('string'))], arrayOf(named('string')))
        ]
    }
}

function moduleType(module: 'juno' | 'juno:node'): TypeNode {
    return { kind: 'ObjectType', members: [field('console', consoleType(), true)] }
}

function globals(): Env {
    const env: Env = new Map()
    env.set('isType', {
        kind: 'fun',
        params: [{ name: 'value', type: named('any') }],
        returnType: named('boolean'),
        docs: 'Returns true if `value` matches the type argument, for example `isType<number>(answer)`.'
    })
    return env
}

export function printType(type: TypeNode): string {
    switch (type.kind) {
        case 'NamedType': return type.name
        case 'GenericType': return `${type.name}<${type.args.map(printType).join(', ')}>`
        case 'UnionType': return type.types.map(printType).join(' | ')
        case 'IntersectionType': return type.types.map(printType).join(' & ')
        case 'ArrayType': {
            const inner = printType(type.element)
            return type.element.kind === 'UnionType' || type.element.kind === 'IntersectionType' || type.element.kind === 'FunctionType'
                ? `(${inner})[]`
                : `${inner}[]`
        }
        case 'ObjectType': {
            const members = type.members.map(member => {
                const prefix = `${member.readonly ? 'readonly ' : ''}${member.constant ? 'const ' : ''}${member.name}${member.optional ? '?' : ''}`
                if (member.method) return `${prefix}(${(member.params ?? []).map(printParam).join(', ')}): ${printType(member.type)}`
                return `${prefix}: ${printType(member.type)}`
            })
            return members.length ? `{ ${members.join(', ')} }` : '{}'
        }
        case 'FunctionType': return `(${type.params.map(printType).join(', ')}) -> ${printType(type.result)}`
    }
}

function printParam(param: Parameter): string {
    return param.type ? `${param.name}: ${printType(param.type)}` : param.name
}

function printFunction(name: string, params: Parameter[], returnType: TypeNode): string {
    return `fun ${name}(${params.map(printParam).join(', ')}): ${printType(returnType)}`
}

function printSymbol(name: string, symbol: SymbolInfo): { code: string; docs?: string } {
    switch (symbol.kind) {
        case 'var': return { code: `${symbol.mutable ? 'let' : 'const'} ${name}: ${printType(symbol.type)}`, docs: symbol.docs }
        case 'fun': return { code: printFunction(name, symbol.params, symbol.returnType), docs: symbol.docs }
        case 'type': {
            const generics = symbol.generics.length ? `<${symbol.generics.join(', ')}>` : ''
            return { code: `type ${name}${generics} = ${printType(symbol.value)}`, docs: symbol.docs }
        }
        case 'module': return { code: `import ${name} from '${symbol.module}'`, docs: symbol.docs }
    }
}

function instantiate(type: TypeNode, generics: string[], args: TypeNode[]): TypeNode {
    const map = new Map(generics.map((name, index) => [name, args[index] ?? named(name)]))
    const replace = (node: TypeNode): TypeNode => {
        if (node.kind === 'NamedType' && map.has(node.name)) return map.get(node.name)!
        if (node.kind === 'GenericType') return { ...node, args: node.args.map(replace) }
        if (node.kind === 'UnionType' || node.kind === 'IntersectionType') return { ...node, types: node.types.map(replace) }
        if (node.kind === 'ArrayType') return { ...node, element: replace(node.element) }
        if (node.kind === 'FunctionType') return { ...node, params: node.params.map(replace), result: replace(node.result) }
        if (node.kind === 'ObjectType') return { ...node, members: node.members.map(member => ({ ...member, type: replace(member.type) })) }
        return node
    }
    return replace(type)
}

function resolveType(type: TypeNode, env: Env): TypeNode {
    if (type.kind === 'NamedType') {
        const symbol = env.get(type.name)
        if (symbol?.kind === 'type') return resolveType(instantiate(symbol.value, symbol.generics, []), env)
        return type
    }
    if (type.kind === 'GenericType') {
        const symbol = env.get(type.name)
        if (symbol?.kind === 'type') return resolveType(instantiate(symbol.value, symbol.generics, type.args), env)
        return type
    }
    if (type.kind === 'IntersectionType') {
        const parts = type.types.map(part => resolveType(part, env))
        const members: TypeMember[] = []
        for (const part of parts) {
            if (part.kind === 'ObjectType') members.push(...part.members)
        }
        return members.length ? { kind: 'ObjectType', members } : { kind: 'IntersectionType', types: parts }
    }
    return type
}

type FunctionSymbol = { kind: 'fun'; params: Parameter[]; returnType: TypeNode }

function isFunctionSymbol(value: TypeNode | FunctionSymbol | undefined): value is FunctionSymbol {
    return Boolean(value && typeof value === 'object' && 'kind' in value && value.kind === 'fun' && 'returnType' in value)
}

function lookupMember(type: TypeNode, name: string, env: Env): TypeNode | FunctionSymbol | undefined {
    const resolved = resolveType(type, env)
    if (resolved.kind !== 'ObjectType') return undefined
    const member = resolved.members.find(item => item.name === name)
    if (!member) return undefined
    if (member.method) return { kind: 'fun', params: member.params ?? [], returnType: member.type }
    return member.type
}

function isAssignableTo(expected: TypeNode, actual: TypeNode, env: Env): boolean {
    const target = resolveType(expected, env)
    const value = resolveType(actual, env)
    if (isNamedType(target, 'any') || isNamedType(value, 'any')) return true
    if (target.kind === 'UnionType') return target.types.some(part => isAssignableTo(part, value, env))
    if (value.kind === 'UnionType') return value.types.every(part => isAssignableTo(target, part, env))
    if (target.kind === 'ArrayType' && value.kind === 'ArrayType') return isAssignableTo(target.element, value.element, env)
    if (target.kind === 'ObjectType' && value.kind === 'ObjectType') {
        return target.members.filter(member => !member.optional && !member.method).every(member => {
            const actualMember = value.members.find(item => item.name === member.name)
            return Boolean(actualMember && isAssignableTo(member.type, actualMember.type, env))
        }) && target.members.filter(member => !member.method).every(member => {
            const actualMember = value.members.find(item => item.name === member.name)
            return !actualMember || isAssignableTo(member.type, actualMember.type, env)
        })
    }
    if (target.kind !== value.kind) return false
    if (target.kind === 'NamedType' && value.kind === 'NamedType') return target.name === value.name
    if (target.kind === 'GenericType' && value.kind === 'GenericType') return target.name === value.name && target.args.length === value.args.length && target.args.every((item, index) => isAssignableTo(item, value.args[index], env))
    if (target.kind === 'FunctionType' && value.kind === 'FunctionType') return target.params.length === value.params.length && target.params.every((item, index) => isAssignableTo(item, value.params[index], env)) && isAssignableTo(target.result, value.result, env)
    return true
}

function inferLiteral(value: string | number | bigint | boolean | null): TypeNode {
    if (value === null) return named('null')
    if (typeof value === 'string') return named('string')
    if (typeof value === 'number') return named('number')
    if (typeof value === 'bigint') return named('BigInt')
    return named('boolean')
}

const errorType = (): TypeNode => named('<Error-Type>')

function isNamedType(type: TypeNode, name: string): boolean {
    return type.kind === 'NamedType' && type.name === name
}

function hasSameNumericType(left: TypeNode, right: TypeNode): boolean {
    return (isNamedType(left, 'number') && isNamedType(right, 'number')) ||
        (isNamedType(left, 'BigInt') && isNamedType(right, 'BigInt'))
}

function binaryResultType(operator: string, left: TypeNode, right: TypeNode): TypeNode {
    if (operator === '+') {
        if (hasSameNumericType(left, right) || (isNamedType(left, 'string') && isNamedType(right, 'string'))) return left
        return errorType()
    }
    if (['-', '*', '/', '%'].includes(operator)) return hasSameNumericType(left, right) ? left : errorType()
    if (['<', '<=', '>', '>='].includes(operator)) return hasSameNumericType(left, right) ? named('boolean') : errorType()
    if (['==', '!=', '&', '|'].includes(operator)) return named('boolean')
    return named('any')
}

function binaryErrorMessage(operator: string, left: TypeNode, right: TypeNode): string | undefined {
    if (isNamedType(left, '<Error-Type>') || isNamedType(right, '<Error-Type>')) return undefined
    const leftName = printType(left), rightName = printType(right)
    if (operator === '+' && !(hasSameNumericType(left, right) || (isNamedType(left, 'string') && isNamedType(right, 'string')))) {
        return `Invalid operands for '+': ${leftName} and ${rightName}. Use number + number, string + string, or BigInt + BigInt.`
    }
    if (['-', '*', '/', '%'].includes(operator) && !hasSameNumericType(left, right)) {
        return `Invalid operands for '${operator}': ${leftName} and ${rightName}. Both operands must be number or both must be BigInt.`
    }
    if (['<', '<=', '>', '>='].includes(operator) && !hasSameNumericType(left, right)) {
        return `Invalid operands for '${operator}': ${leftName} and ${rightName}. Both operands must be number or both must be BigInt.`
    }
    return undefined
}

function inferExpression(expression: Expression, env: Env): TypeNode {
    switch (expression.kind) {
        case 'Literal': return inferLiteral(expression.value)
        case 'Assignment': return inferExpression(expression.value, env)
        case 'Identifier': {
            if (expression.name === 'this') {
                const self = env.get('this')
                return self?.kind === 'var' ? self.type : named('any')
            }
            const symbol = env.get(expression.name)
            if (!symbol) return named('any')
            if (symbol.kind === 'var') return symbol.type
            if (symbol.kind === 'fun') return { kind: 'FunctionType', params: symbol.params.map(param => param.type ?? named('any')), result: symbol.returnType }
            if (symbol.kind === 'module') return moduleType(symbol.module)
            return named(expression.name)
        }
        case 'Array': {
            if (!expression.elements.length) return arrayOf(named('any'))
            const elements = expression.elements.map(item => inferExpression(item, env))
            return arrayOf(unionOf(elements))
        }
        case 'Object': {
            const members: TypeMember[] = expression.properties.map(property => {
                if (property.value.kind === 'Function') {
                    return method(property.key, property.value.params, property.value.returnType ?? inferFunctionReturnType(property.value.body, env))
                }
                return field(property.key, inferExpression(property.value, env))
            })
            return { kind: 'ObjectType', members }
        }
        case 'Unary': return expression.operator === '-' ? named('number') : named('boolean')
        case 'Binary': {
            const left = inferExpression(expression.left, env)
            const right = inferExpression(expression.right, env)
            return binaryResultType(expression.operator, left, right)
        }
        case 'Member': {
            const objectType = inferExpression(expression.object, env)
            const resolvedObjectType = resolveType(objectType, env)
            const member = lookupMember(objectType, expression.property, env)
            if (!member) return resolvedObjectType.kind === 'ObjectType' ? named('null') : named('any')
            if (isFunctionSymbol(member)) return { kind: 'FunctionType', params: member.params.map(param => param.type ?? named('any')), result: member.returnType }
            return member
        }
        case 'Index': {
            const objectType = inferExpression(expression.object, env)
            const indexType = (type: TypeNode): TypeNode => {
                if (type.kind === 'ArrayType') return type.element
                if (type.kind === 'UnionType') return unionOf(type.types.map(indexType))
                if (type.kind === 'ObjectType') {
                    if (expression.index.kind === 'Literal') {
                        const key = String(expression.index.value)
                        return type.members.find(member => member.name === key)?.type ?? named('any')
                    }
                    return unionOf(type.members.map(member => member.type))
                }
                return named('any')
            }
            return indexType(objectType)
        }
        case 'Call': {
            if (expression.callee.kind === 'Identifier' && expression.callee.name === 'isType') return named('boolean')
            const callee = inferExpression(expression.callee, env)
            if (callee.kind === 'FunctionType') return callee.result
            if (expression.callee.kind === 'Identifier') {
                const symbol = env.get(expression.callee.name)
                if (symbol?.kind === 'fun') return symbol.returnType
            }
            if (expression.callee.kind === 'Member') {
                const objectType = inferExpression(expression.callee.object, env)
                const member = lookupMember(objectType, expression.callee.property, env)
                if (isFunctionSymbol(member)) return member.returnType
            }
            return named('any')
        }
        case 'Function': return { kind: 'FunctionType', params: expression.params.map(param => param.type ?? named('any')), result: expression.returnType ?? (expression.expressionBody ? inferExpression(expression.expressionBody, env) : inferFunctionReturnType(expression.body, env)) }
    }
}

function inferFunctionReturnType(statements: Statement[], outer: Env): TypeNode {
    const returns: TypeNode[] = []
    const collect = (body: Statement[], env: Env): void => {
        for (const statement of body) {
            if (statement.kind === 'Return') {
                returns.push(statement.value ? inferExpression(statement.value, env) : named('null'))
            } else if (statement.kind === 'If') {
                collect(statement.consequent, new Map(env))
                if (statement.alternate) collect(statement.alternate, new Map(env))
            } else if (statement.kind === 'While' || statement.kind === 'ForOf') {
                collect(statement.body, new Map(env))
            } else if (statement.kind === 'Variable') {
                env.set(statement.name, { kind: 'var', mutable: statement.mutable, type: statement.type ?? (statement.initializer ? inferExpression(statement.initializer, env) : named('any')) })
            }
        }
    }
    collect(statements, new Map(outer))
    return returns.length ? unionOf(returns) : named('null')
}

function unionOf(types: TypeNode[]): TypeNode {
    const flattened = types.flatMap(type => type.kind === 'UnionType' ? type.types : [type])
    if (!flattened.length) return named('any')
    const unique = flattened.filter((type, index) => flattened.findIndex(item => printType(item) === printType(type)) === index)
    return unique.length === 1 ? unique[0] : { kind: 'UnionType', types: unique }
}

function functionType(params: Parameter[], returnType?: TypeNode): TypeNode {
    return { kind: 'FunctionType', params: params.map(param => param.type ?? named('any')), result: returnType ?? named('any') }
}

function contains(loc: Loc | undefined, name: string, line: number, column: number): boolean {
    if (!loc) return false
    return loc.line === line && column >= loc.column && column <= loc.column + name.length
}

function lengthOf(name: string, loc?: Loc): number {
    return name.length
}

class Analyzer {
    hovers: HoverInfo[] = []
    hints: InlayHintInfo[] = []
    diagnostics: DiagnosticInfo[] = []

    analyze(statements: Statement[]): void {
        this.statements(statements, globals())
    }

    private addHover(name: string, loc: Loc | undefined, code: string, docs?: string): void {
        if (!loc) return
        this.hovers.push({ line: loc.line, column: loc.column, length: lengthOf(name, loc), code, docs })
    }

    private addTypeHint(loc: Loc | undefined, name: string, hasType: boolean, type: TypeNode): void {
        if (!loc || hasType) return
        const printed = printType(type)
        this.hints.push({
            line: loc.line,
            column: loc.column + name.length,
            label: `: ${printed}`,
            tooltip: printed,
            kind: 'type'
        })
    }

    private addDiagnostic(loc: Loc | undefined, message: string): void {
        if (!loc) return
        this.diagnostics.push({ line: loc.line, column: loc.column, length: 1, message })
    }

    private addParameterHints(callee: Expression, args: Expression[], env: Env): void {
        let params: Parameter[] | undefined
        if (callee.kind === 'Identifier') {
            const symbol = env.get(callee.name)
            if (symbol?.kind === 'fun') params = symbol.params
        } else if (callee.kind === 'Member') {
            const member = lookupMember(inferExpression(callee.object, env), callee.property, env)
            if (isFunctionSymbol(member)) params = member.params
        }
        if (!params) return
        args.forEach((arg, index) => {
            const param = params![index]
            const loc = expressionStart(arg)
            if (!param || !loc || param.name.startsWith('.')) return
            this.hints.push({
                line: loc.line,
                column: loc.column,
                label: `${param.name}:`,
                tooltip: param.type ? `${param.name}: ${printType(param.type)}` : param.name,
                kind: 'parameter'
            })
        })
    }

    private bind(env: Env, name: string, symbol: SymbolInfo): void {
        env.set(name, symbol)
    }

    private statements(statements: Statement[], env: Env): void {
        for (const statement of statements) this.statement(statement, env)
    }

    private statement(statement: Statement, env: Env): void {
        switch (statement.kind) {
            case 'Import': {
                const imported = statement.module === 'juno:node'
                    ? 'Node.js helpers for JunoScript (`console.args`, `console.read`, `console.readLines`).'
                    : 'Standard JunoScript module. `console` mirrors the host console.'
                if (statement.defaultImport) {
                    const symbol: SymbolInfo = { kind: 'module', module: statement.module, docs: imported }
                    this.bind(env, statement.defaultImport, symbol)
                    const printed = printSymbol(statement.defaultImport, symbol)
                    this.addHover(statement.defaultImport, statement.defaultImportLoc, printed.code, printed.docs)
                }
                statement.namedImports.forEach((name, index) => {
                    const type = name === 'console' ? consoleType() : named('any')
                    const symbol: SymbolInfo = {
                        kind: 'var',
                        mutable: false,
                        type,
                        docs: name === 'console' ? (statement.module === 'juno:node' ? 'Console with `log`, `args`, `read`, and `readLines`.' : 'Host console (`log`, `error`, `warn`).') : imported
                    }
                    this.bind(env, name, symbol)
                    const printed = printSymbol(name, symbol)
                    this.addHover(name, statement.namedImportLocs?.[index], printed.code, printed.docs)
                })
                return
            }
            case 'TypeDeclaration': {
                const symbol: SymbolInfo = { kind: 'type', generics: statement.generics, value: statement.value }
                this.bind(env, statement.name, symbol)
                const printed = printSymbol(statement.name, symbol)
                this.addHover(statement.name, statement.loc, printed.code, printed.docs)
                statement.generics.forEach((name, index) => this.addHover(name, statement.genericLocs?.[index], `(type parameter) ${name}`))
                this.walkType(statement.value, env)
                return
            }
            case 'Variable': {
                this.walkExpression(statement.initializer, env)
                const type = statement.type ?? (statement.initializer ? inferExpression(statement.initializer, env) : named('any'))
                if (statement.type && statement.initializer?.kind === 'Object') {
                    const expected = resolveType(statement.type, env)
                    if (expected.kind === 'ObjectType') {
                        const properties = statement.initializer.properties
                        const actual = inferExpression(statement.initializer, env)
                        const actualMembers = actual.kind === 'ObjectType' ? actual.members : []
                        for (const property of properties) {
                            const member = expected.members.find(item => item.name === property.key)
                            if (!member) continue
                            const propertyType = inferExpression(property.value, env)
                            if (!isAssignableTo(member.type, propertyType, env)) {
                                if (property.keyLoc) this.diagnostics.push({ line: property.keyLoc.line, column: property.keyLoc.column, length: property.key.length, message: `Type '${printType(propertyType)}' is not assignable to type '${printType(member.type)}' for '${property.key}'.` })
                            }
                        }
                        const missing = expected.members.filter(member => !member.optional && !member.method && !actualMembers.some(item => item.name === member.name))
                        if (missing.length) {
                            const loc = statement.initializer.kind === 'Object' ? statement.initializer.loc : undefined
                            if (loc) this.diagnostics.push({
                                line: loc.line, column: loc.column, length: 1,
                                message: `Missing required properties: ${missing.map(member => `'${member.name}'`).join(', ')}.`,
                                fix: { title: 'Fill all required properties', line: loc.line, fields: missing.map(member => ({ name: member.name, type: printType(member.type) })) }
                            })
                        }
                    } else if (!isAssignableTo(statement.type, inferExpression(statement.initializer, env), env)) {
                        this.addDiagnostic(statement.initializer.loc, `Type '${printType(inferExpression(statement.initializer, env))}' is not assignable to type '${printType(statement.type)}'.`)
                    }
                } else if (statement.type && statement.initializer && !isAssignableTo(statement.type, inferExpression(statement.initializer, env), env)) {
                    this.addDiagnostic(statement.initializer.loc, `Type '${printType(inferExpression(statement.initializer, env))}' is not assignable to type '${printType(statement.type)}'.`)
                }
                const symbol: SymbolInfo = { kind: 'var', mutable: statement.mutable, type }
                this.bind(env, statement.name, symbol)
                const printed = printSymbol(statement.name, symbol)
                this.addHover(statement.name, statement.loc, printed.code)
                this.addTypeHint(statement.loc, statement.name, Boolean(statement.type), type)
                if (statement.type) this.walkType(statement.type, env)
                return
            }
            case 'FunctionDeclaration': {
                const inferenceEnv = new Map(env)
                for (const param of statement.params) this.bind(inferenceEnv, param.name, { kind: 'var', mutable: true, type: param.type ?? named('any') })
                const returnType = statement.returnType ?? inferFunctionReturnType(statement.body, inferenceEnv)
                const symbol: SymbolInfo = { kind: 'fun', params: statement.params, returnType }
                this.bind(env, statement.name, symbol)
                const printed = printSymbol(statement.name, symbol)
                this.addHover(statement.name, statement.loc, printed.code)
                const local = new Map(env)
                for (const param of statement.params) {
                    const type = param.type ?? named('any')
                    this.bind(local, param.name, { kind: 'var', mutable: true, type })
                    this.addHover(param.name, param.loc, `(parameter) ${param.name}: ${printType(type)}`)
                    this.addTypeHint(param.loc, param.name, Boolean(param.type), type)
                    if (param.type) this.walkType(param.type, env)
                    if (param.defaultValue) this.walkExpression(param.defaultValue, local)
                }
                if (statement.returnType) this.walkType(statement.returnType, env)
                this.statements(statement.body, local)
                return
            }
            case 'Return':
                this.walkExpression(statement.value, env)
                return
            case 'ExpressionStatement':
                if (statement.expression.kind === 'Assignment') {
                    const symbol = env.get(statement.expression.name)
                    if (symbol?.kind === 'var' && !symbol.mutable) {
                        const loc = statement.expression.operatorLoc
                        if (loc) this.diagnostics.push({ line: loc.line, column: loc.column, length: 1, message: `Cannot assign to constant '${statement.expression.name}'` })
                    }
                }
                this.walkExpression(statement.expression, env)
                return
            case 'If': {
                this.walkExpression(statement.condition, env)
                this.statements(statement.consequent, new Map(env))
                if (statement.alternate) this.statements(statement.alternate, new Map(env))
                return
            }
            case 'While':
                this.walkExpression(statement.condition, env)
                this.statements(statement.body, new Map(env))
                return
            case 'ForOf': {
                this.walkExpression(statement.iterable, env)
                const iterable = inferExpression(statement.iterable, env)
                const bindingType = iterable.kind === 'ArrayType' ? iterable.element : named('any')
                const local = new Map(env)
                this.bind(local, statement.binding, { kind: 'var', mutable: statement.mutable, type: bindingType })
                this.addHover(statement.binding, statement.loc, `${statement.mutable ? 'let' : 'const'} ${statement.binding}: ${printType(bindingType)}`)
                this.addTypeHint(statement.loc, statement.binding, false, bindingType)
                this.statements(statement.body, local)
                return
            }
        }
    }

    private walkType(type: TypeNode, env: Env): void {
        switch (type.kind) {
            case 'NamedType': {
                const symbol = env.get(type.name)
                if (symbol) {
                    const printed = printSymbol(type.name, symbol)
                    this.addHover(type.name, type.loc, printed.code, printed.docs)
                } else this.addHover(type.name, type.loc, `(type) ${type.name}`)
                return
            }
            case 'GenericType': {
                const symbol = env.get(type.name)
                if (symbol) {
                    const printed = printSymbol(type.name, symbol)
                    this.addHover(type.name, type.loc, printed.code, printed.docs)
                } else this.addHover(type.name, type.loc, `(type) ${printType(type)}`)
                type.args.forEach(arg => this.walkType(arg, env))
                return
            }
            case 'UnionType':
            case 'IntersectionType':
                type.types.forEach(part => this.walkType(part, env))
                return
            case 'ArrayType':
                this.walkType(type.element, env)
                return
            case 'FunctionType':
                type.params.forEach(param => this.walkType(param, env))
                this.walkType(type.result, env)
                return
            case 'ObjectType':
                for (const member of type.members) {
                    const signature = member.method
                        ? `(method) ${member.name}(${(member.params ?? []).map(printParam).join(', ')}): ${printType(member.type)}`
                        : `(property) ${member.readonly ? 'readonly ' : ''}${member.name}${member.optional ? '?' : ''}: ${printType(member.type)}`
                    this.addHover(member.name, member.loc, signature)
                    this.walkType(member.type, env)
                    for (const param of member.params ?? []) {
                        const type = param.type ?? named('any')
                        this.addHover(param.name, param.loc, `(parameter) ${param.name}: ${printType(type)}`)
                        if (param.type) this.walkType(param.type, env)
                    }
                }
        }
    }

    private walkExpression(expression: Expression | undefined, env: Env, thisType?: TypeNode): void {
        if (!expression) return
        switch (expression.kind) {
            case 'Literal':
                this.addHover(literalLabel(expression.value), expression.loc, `(${printType(inferLiteral(expression.value))}) ${literalPreview(expression.value)}`)
                return
            case 'Identifier': {
                if (expression.name === 'this') {
                    const type = env.get('this')?.kind === 'var' ? (env.get('this') as { type: TypeNode }).type : named('any')
                    this.addHover('this', expression.loc, `(this) ${printType(type)}`)
                    return
                }
                const symbol = env.get(expression.name)
                if (symbol) {
                    const printed = printSymbol(expression.name, symbol)
                    this.addHover(expression.name, expression.loc, printed.code, printed.docs)
                }
                return
            }
            case 'Array':
                expression.elements.forEach(item => this.walkExpression(item, env, thisType))
                return
            case 'Object': {
                const objectType = inferExpression(expression, env)
                const methodEnv = new Map(env)
                this.bind(methodEnv, 'this', { kind: 'var', mutable: false, type: objectType })
                for (const property of expression.properties) {
                    const member = lookupMember(objectType, property.key, env)
                    const code = isFunctionSymbol(member)
                        ? `(method) ${property.key}(${member.params.map(printParam).join(', ')}): ${printType(member.returnType)}`
                        : `(property) ${property.key}: ${printType(member && !isFunctionSymbol(member) ? member : named('any'))}`
                    this.addHover(property.key, property.keyLoc, code)
                    if (property.value.kind === 'Function') this.walkFunction(property.value, methodEnv)
                    else this.walkExpression(property.value, env, thisType)
                }
                return
            }
            case 'Unary':
                this.walkExpression(expression.operand, env, thisType)
                return
            case 'Binary': {
                this.walkExpression(expression.left, env, thisType)
                this.walkExpression(expression.right, env, thisType)
                const message = binaryErrorMessage(expression.operator, inferExpression(expression.left, env), inferExpression(expression.right, env))
                if (message) this.addDiagnostic(expression.loc, message)
                return
            }
            case 'Index': {
                this.walkExpression(expression.object, env, thisType)
                this.walkExpression(expression.index, env, thisType)
                if (expression.loc) {
                    this.hovers.push({
                        line: expression.loc.line,
                        column: expression.loc.column,
                        length: 1,
                        code: `(infer) ${printType(inferExpression(expression, env))}`
                    })
                }
                return
            }
            case 'Member': {
                this.walkExpression(expression.object, env, thisType)
                const objectType = inferExpression(expression.object, env)
                const resolvedObjectType = resolveType(objectType, env)
                const member = lookupMember(objectType, expression.property, env)
                if (isFunctionSymbol(member)) {
                    this.addHover(expression.property, expression.loc, `(method) ${expression.property}(${member.params.map(printParam).join(', ')}): ${printType(member.returnType)}`)
                } else if (member) {
                    this.addHover(expression.property, expression.loc, `(property) ${expression.property}: ${printType(member)}`)
                } else if (resolvedObjectType.kind === 'ObjectType') {
                    if (expression.loc) this.diagnostics.push({
                        line: expression.loc.line,
                        column: expression.loc.column,
                        length: expression.property.length,
                        message: `Property '${expression.property}' does not exist on type '${printType(objectType)}'.`
                    })
                }
                return
            }
            case 'Call':
                this.walkExpression(expression.callee, env, thisType)
                expression.args.forEach(arg => this.walkExpression(arg, env, thisType))
                expression.typeArguments?.forEach(type => this.walkType(type, env))
                this.addParameterHints(expression.callee, expression.args, env)
                return
            case 'Function':
                this.walkFunction(expression, env)
                return
        }
    }

    private walkFunction(expression: Extract<Expression, { kind: 'Function' }>, env: Env): void {
        const local = new Map(env)
        for (const param of expression.params) {
            const type = param.type ?? named('any')
            this.bind(local, param.name, { kind: 'var', mutable: true, type })
            this.addHover(param.name, param.loc, `(parameter) ${param.name}: ${printType(type)}`)
            this.addTypeHint(param.loc, param.name, Boolean(param.type), type)
            if (param.type) this.walkType(param.type, env)
        }
        if (expression.returnType) this.walkType(expression.returnType, env)
        this.statements(expression.body, local)
    }
}

function literalLabel(value: string | number | bigint | boolean | null): string {
    if (typeof value === 'string') return value.length ? value : '""'
    return String(value)
}

function literalPreview(value: string | number | bigint | boolean | null): string {
    if (typeof value === 'string') return JSON.stringify(value)
    if (value === null) return 'null'
    return String(value)
}

function expressionStart(expression: Expression): Loc | undefined {
    switch (expression.kind) {
        case 'Literal':
        case 'Identifier':
        case 'Array':
        case 'Object':
        case 'Unary':
            return expression.loc
        case 'Binary':
            return expressionStart(expression.left)
        case 'Member':
            return expressionStart(expression.object)
        case 'Call':
            return expressionStart(expression.callee)
        case 'Function':
            return expression.params[0]?.loc
    }
}

export function analyze(source: string): { hovers: HoverInfo[]; hints: InlayHintInfo[]; diagnostics: DiagnosticInfo[] } | undefined {
    try {
        const analyzer = new Analyzer()
        analyzer.analyze(parse(source, { validate: false }))
        return { hovers: analyzer.hovers, hints: analyzer.hints, diagnostics: analyzer.diagnostics }
    } catch {
        return undefined
    }
}

export function hoverAt(source: string, line: number, column: number): HoverInfo | undefined {
    const result = analyze(source)
    if (!result) return undefined
    const matches = result.hovers.filter(item => item.line === line && column >= item.column && column <= item.column + item.length)
    return matches.sort((a, b) => a.length - b.length)[0]
}

export function inlayHintsFor(source: string): InlayHintInfo[] {
    return analyze(source)?.hints ?? []
}
