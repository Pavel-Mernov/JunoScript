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
    | { kind: 'module'; module: string; docs?: string }

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

function mathType(): TypeNode {
    const number = named('number')
    const unary = (name: string) => method(name, [{ name: 'value', type: number }], number)
    const binary = (name: string) => method(name, [{ name: 'x', type: number }, { name: 'y', type: number }], number)
    return {
        kind: 'ObjectType',
        members: [
            ...['E', 'LN10', 'LN2', 'LOG10E', 'LOG2E', 'PI', 'SQRT1_2', 'SQRT2'].map(name => field(name, number, true)),
            ...['abs', 'acos', 'acosh', 'asin', 'asinh', 'atan', 'atanh', 'cbrt', 'ceil', 'clz32', 'cos', 'cosh', 'exp', 'expm1', 'floor', 'fround', 'log', 'log10', 'log1p', 'log2', 'round', 'sign', 'sin', 'sinh', 'sqrt', 'tan', 'tanh', 'trunc'].map(unary),
            binary('atan2'), binary('imul'), binary('pow'),
            method('hypot', [{ name: 'values', type: arrayOf(number), rest: true }], number),
            method('max', [{ name: 'values', type: arrayOf(number), rest: true }], number),
            method('min', [{ name: 'values', type: arrayOf(number), rest: true }], number),
            method('random', [], number)
        ]
    }
}

function typeUtilitiesType(): TypeNode {
    const any = named('any')
    return {
        kind: 'ObjectType',
        members: ['Partial', 'Required', 'Readonly', 'Pick', 'Omit'].map(name => field(name, {
            kind: 'FunctionType', params: name === 'Pick' || name === 'Omit' ? [any, arrayOf(named('string'))] : [any], result: any
        }))
    }
}

function moduleType(module: 'juno' | 'juno:node' | 'types'): TypeNode {
    if (module === 'types') return typeUtilitiesType()
    return { kind: 'ObjectType', members: [field('console', consoleType(), true), ...(module === 'juno' ? [field('Math', mathType(), true), field('types', typeUtilitiesType(), true)] : [])] }
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
        case 'LiteralType': return typeof type.value === 'string' ? JSON.stringify(type.value) : String(type.value)
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
                if (member.accessor === 'get') return `get ${member.name}(): ${printType(member.type)}`
                if (member.accessor === 'set') return `set ${member.name}(${(member.params ?? []).map(printParam).join(', ')}): void`
                if (member.method) return `${prefix}(${(member.params ?? []).map(printParam).join(', ')}): ${printType(member.type)}`
                return `${prefix}: ${printType(member.type)}`
            })
            return members.length ? `{ ${members.join(', ')} }` : '{}'
        }
        case 'FunctionType': return `(${type.params.map(printType).join(', ')}) -> ${printType(type.result)}`
    }
}

function printParam(param: Parameter): string {
    return `${param.rest === true ? '...' : ''}${param.name}${param.type ? `: ${printType(param.type)}` : ''}${param.defaultValue !== undefined ? ' = …' : ''}`
}

function parameterType(param: Parameter): TypeNode {
    const type = param.type ?? named('any')
    return param.rest === true && type.kind === 'ArrayType' ? type : param.rest === true && type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray')
        ? arrayOf(type.args[0] ?? named('any'))
        : type
}

function parameterBodyType(param: Parameter): TypeNode {
    const type = parameterType(param)
    return type
}

function bindInferredParameters(params: Parameter[], env: Env): Map<string, SymbolInfo> {
    const local = new Map(env)
    for (const param of params) {
        const type = param.type ? parameterBodyType(param) : param.defaultValue ? inferExpression(param.defaultValue, local) : parameterBodyType(param)
        local.set(param.name, { kind: 'var', mutable: true, type })
    }
    return local
}

function parameterHover(param: Parameter, type = parameterType(param)): string {
    return `(parameter) ${param.rest === true ? '...' : ''}${param.name}: ${printType(type)}${param.defaultValue !== undefined ? ' = …' : ''}`
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
        if (node.kind === 'ObjectType') return { ...node, members: node.members.map(member => ({ ...member, type: replace(member.type), params: member.params?.map(param => ({ ...param, type: param.type ? replace(param.type) : undefined })) })) }
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
        if (['Partial', 'Required', 'Readonly', 'Pick', 'Omit'].includes(type.name) && type.args[0]) {
            const source = resolveType(type.args[0], env)
            if (source.kind === 'ObjectType') {
                let members = source.members
                if (type.name === 'Partial') members = members.map(member => ({ ...member, optional: true }))
                else if (type.name === 'Required') members = members.map(member => ({ ...member, optional: false }))
                else if (type.name === 'Readonly') members = members.map(member => ({ ...member, readonly: true }))
                else if (type.name === 'Pick' || type.name === 'Omit') {
                    const keysOf = (node: TypeNode | undefined): string[] => {
                        if (!node) return []
                        if (node.kind === 'LiteralType' && typeof node.value === 'string') return [node.value]
                        if (node.kind === 'UnionType') return node.types.flatMap(keysOf)
                        if (node.kind === 'ArrayType') return keysOf(node.element)
                        return []
                    }
                    const keys = new Set(keysOf(type.args[1]))
                    members = members.filter(member => type.name === 'Pick' ? keys.has(member.name) : !keys.has(member.name))
                }
                return { ...source, members }
            }
        }
        return type
    }
    if (type.kind === 'IntersectionType') {
        const flatten = (part: TypeNode): TypeNode[] => {
            const resolved = resolveType(part, env)
            return resolved.kind === 'IntersectionType' ? resolved.types.flatMap(flatten) : [resolved]
        }
        const parts = type.types.flatMap(flatten)
        if (parts.some(part => part.kind === 'UnionType')) return { kind: 'IntersectionType', types: parts }
        const members: TypeMember[] = []
        for (const part of parts) {
            if (part.kind === 'ObjectType') members.push(...part.members)
        }
        return members.length ? { kind: 'ObjectType', members } : { kind: 'IntersectionType', types: parts }
    }
    if (type.kind === 'UnionType') return { ...type, types: type.types.map(part => resolveType(part, env)) }
    if (type.kind === 'ArrayType') return { ...type, element: resolveType(type.element, env) }
    if (type.kind === 'ObjectType') return { ...type, members: type.members.map(member => ({ ...member, type: resolveType(member.type, env), params: member.params?.map(param => ({ ...param, type: param.type ? resolveType(param.type, env) : undefined })) })) }
    if (type.kind === 'FunctionType') return { ...type, params: type.params.map(param => resolveType(param, env)), result: resolveType(type.result, env) }
    return type
}

type FunctionSymbol = { kind: 'fun'; params: Parameter[]; returnType: TypeNode; body?: Statement[]; ownerType?: TypeNode }

function isFunctionSymbol(value: TypeNode | FunctionSymbol | undefined): value is FunctionSymbol {
    return Boolean(value && typeof value === 'object' && 'kind' in value && value.kind === 'fun' && 'returnType' in value)
}

function lookupMember(type: TypeNode, name: string, env: Env): TypeNode | FunctionSymbol | undefined {
    const resolved = resolveType(type, env)
    if (resolved.kind === 'IntersectionType') {
        for (const part of resolved.types) {
            const member = lookupMember(part, name, env)
            if (member) return member
        }
    }
    if (resolved.kind === 'UnionType') {
        const members = resolved.types.map(part => lookupMember(part, name, env))
        if (members.length && members.every(Boolean)) return members[0]
    }
    if (resolved.kind === 'ObjectType') {
        const member = resolved.members.find(item => item.name === name && item.accessor === 'get')
            ?? resolved.members.find(item => item.name === name)
        if (member) {
            if (member.accessor === 'get') return member.type
            if (member.accessor === 'set') return member.type
            if (member.method) return { kind: 'fun', params: member.params ?? [], returnType: member.type, body: member.body, ownerType: resolved }
            return member.type
        }
        if (name === 'has') return { kind: 'fun', params: [{ name: 'key', type: named('string') }], returnType: named('boolean') }
    }
    if (name === 'has' && (resolved.kind === 'ArrayType' || resolved.kind === 'GenericType' && (resolved.name === 'Array' || resolved.name === 'ReadonlyArray'))) {
        return { kind: 'fun', params: [{ name: 'key', type: named('string') }], returnType: named('boolean') }
    }
    const element = resolved.kind === 'ArrayType'
        ? resolved.element
        : resolved.kind === 'GenericType' && (resolved.name === 'Array' || resolved.name === 'ReadonlyArray')
            ? resolved.args[0] ?? named('any')
            : undefined
    if (element) {
        const fn = (params: Parameter[], returnType: TypeNode): FunctionSymbol => ({ kind: 'fun', params, returnType })
        const p = (paramName: string, paramType: TypeNode, optional = false): Parameter => ({ name: paramName, type: paramType, ...(optional ? { defaultValue: { kind: 'Literal', value: null } as Expression } : {}) })
        const callback = (params: TypeNode[], result: TypeNode): TypeNode => ({ kind: 'FunctionType', params, result })
        const number = named('number'), boolean = named('boolean'), string = named('string'), any = named('any')
        switch (name) {
            case 'length': return number
            case 'at': return fn([p('index', number)], unionOf([element, named('null')]))
            case 'concat': return fn([{ name: 'items', type: arrayOf(element), rest: true }], arrayOf(element))
            case 'every':
            case 'some': return fn([p('callback', callback([element], boolean))], boolean)
            case 'filter': return fn([p('callback', callback([element], boolean))], arrayOf(element))
            case 'find':
            case 'findLast': return fn([p('callback', callback([element], boolean))], unionOf([element, named('null')]))
            case 'findIndex':
            case 'findLastIndex':
            case 'indexOf':
            case 'lastIndexOf': return fn([p(name.startsWith('find') ? 'callback' : 'value', name.startsWith('find') ? callback([element], boolean) : element)], number)
            case 'flat': return fn([], arrayOf(any))
            case 'flatMap': return fn([p('callback', callback([element], arrayOf(any)))], arrayOf(any))
            case 'forEach': return fn([p('callback', callback([element], any))], named('void'))
            case 'includes': return fn([p('value', element)], boolean)
            case 'join': return fn([p('separator', string, true)], string)
            case 'map': return fn([p('callback', callback([element], any))], arrayOf(any))
            case 'pop':
            case 'shift': return fn([], unionOf([element, named('null')]))
            case 'push':
            case 'unshift': return fn([{ name: 'items', type: arrayOf(element), rest: true }], number)
            case 'reduce':
            case 'reduceRight': return fn([p('callback', callback([any, element], any)), p('initial', any)], any)
            case 'slice': return fn([p('start', number, true), p('end', number, true)], arrayOf(element))
            case 'sort': return fn([p('compare', callback([element, element], number), true)], arrayOf(element))
            case 'toLocaleString':
            case 'toString': return fn([], string)
            case 'toReversed':
            case 'toSorted': return fn([], arrayOf(element))
            case 'toSpliced': return fn([p('start', number), p('deleteCount', number), p('items', arrayOf(element), true)], arrayOf(element))
            case 'with': return fn([p('index', number), p('value', element)], arrayOf(element))
        }
    }
    if (name === 'toString' && !(resolved.kind === 'NamedType' && resolved.name === 'null') && !(resolved.kind === 'LiteralType' && resolved.value === null)) {
        return { kind: 'fun', params: [], returnType: named('string') }
    }
    if (name === 'as' && !(resolved.kind === 'NamedType' && resolved.name === 'null') && !(resolved.kind === 'LiteralType' && resolved.value === null)) {
        return { kind: 'fun', params: [], returnType: named('any') }
    }
    return undefined
}

function narrowHasProperty(type: TypeNode, name: string, env: Env): TypeNode {
    const resolved = resolveType(type, env)
    if (resolved.kind === 'IntersectionType') {
        return { ...resolved, types: resolved.types.map(part => narrowHasProperty(part, name, env)) }
    }
    if (resolved.kind === 'UnionType') {
        const matches = resolved.types.filter(part => lookupMember(part, name, env) !== undefined)
        return matches.length ? unionOf(matches) : resolved
    }
    return resolved
}

function missingUnionMember(type: TypeNode, name: string, env: Env): TypeNode | undefined {
    const resolved = resolveType(type, env)
    if (resolved.kind === 'UnionType') return resolved.types.find(part => !lookupMember(part, name, env))
    if (resolved.kind === 'IntersectionType') {
        for (const part of resolved.types) {
            const missing = missingUnionMember(part, name, env)
            if (missing) return missing
        }
    }
    return undefined
}

function isAssignableTo(expected: TypeNode, actual: TypeNode, env: Env): boolean {
    const target = resolveType(expected, env)
    const value = resolveType(actual, env)
    if (isNamedType(target, 'any') || isNamedType(value, 'any')) return true
    if (target.kind === 'IntersectionType') return target.types.every(part => isAssignableTo(part, value, env))
    if (value.kind === 'IntersectionType') return value.types.some(part => isAssignableTo(target, part, env))
    if (target.kind === 'UnionType') {
        return value.kind === 'UnionType'
            ? value.types.every(valuePart => target.types.some(targetPart => isAssignableTo(targetPart, valuePart, env)))
            : target.types.some(part => isAssignableTo(part, value, env))
    }
    if (value.kind === 'UnionType') return value.types.every(part => isAssignableTo(target, part, env))
    if (target.kind === 'LiteralType') {
        if (value.kind === 'LiteralType') return typeof target.value === typeof value.value && target.value === value.value
        if (value.kind === 'NamedType') {
            const literalType = typeof target.value === 'string' ? 'string' : typeof target.value
            return value.name === literalType || value.name === 'any'
        }
        return false
    }
    if (value.kind === 'LiteralType' && target.kind === 'NamedType') {
        return target.name === (typeof value.value === 'string' ? 'string' : typeof value.value)
    }
    if (target.kind === 'ArrayType' && value.kind === 'ArrayType') return isAssignableTo(target.element, value.element, env)
    if (target.kind === 'ObjectType' && value.kind === 'ObjectType') {
        return target.members.filter(member => !member.optional && (!member.method || member.accessor === 'get') && member.accessor !== 'set' && !member.body && !isNullable(member.type, env)).every(member => {
            const actualMember = value.members.find(item => item.name === member.name)
            return Boolean(actualMember && isAssignableTo(member.type, actualMember.type, env))
        }) && target.members.filter(member => !member.method || member.accessor === 'get').every(member => {
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

type ImportedSymbol = { kind: 'type'; value: TypeNode; generics: string[] } | { kind: 'fun'; params: Parameter[]; returnType: TypeNode } | { kind: 'var'; type: TypeNode }

function importedDeclarations(statements: Statement[], filePath?: string, seen = new Set<string>()): Map<string, ImportedSymbol> {
    const result = new Map<string, ImportedSymbol>()
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    for (const statement of statements) {
        const declaration = statement.kind === 'Export' ? statement.declaration : statement
        const exported = statement.kind === 'Export'
        if (declaration.kind === 'TypeDeclaration' && exported) result.set(declaration.name, { kind: 'type', value: declaration.value, generics: declaration.generics })
        else if (declaration.kind === 'FunctionDeclaration' && exported) result.set(declaration.name, { kind: 'fun', params: declaration.params, returnType: declaration.returnType ?? inferFunctionReturnType(declaration.body, globals(), declaration.params) })
        else if (declaration.kind === 'Variable' && exported) result.set(declaration.name, { kind: 'var', type: declaration.type ?? (declaration.initializer ? inferExpression(declaration.initializer, globals()) : named('any')) })
    }
    if (!filePath) return result
    for (const statement of statements) {
        if (statement.kind !== 'Import' || !statement.module.startsWith('.')) continue
        const base = path.resolve(path.dirname(filePath), statement.module)
        const candidates = /\.jn$/i.test(base) ? [base] : [`${base}.jn`, path.resolve(base, 'index.jn')]
        const importedFile = candidates.find(candidate => fs.existsSync(candidate))
        if (!importedFile || seen.has(importedFile)) continue
        seen.add(importedFile)
        try {
            const nested = parse(fs.readFileSync(importedFile, 'utf8'), { validate: false, filePath: importedFile })
            const declarations = importedDeclarations(nested, importedFile, seen)
            for (const name of statement.namedImports) if (declarations.has(name)) result.set(name, declarations.get(name)!)
        } catch { /* diagnostics handle unresolved or invalid modules */ }
    }
    if (statements.some(item => item.kind === 'Import' && item.module === 'juno' && item.namedImports.includes('Error'))) {
        result.set('Error', { kind: 'type', generics: [], value: { kind: 'ObjectType', members: [field('name', named('string')), field('message', named('string')), { ...field('stack', named('string')), optional: true }] } })
    }
    return result
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

function removeNull(type: TypeNode): TypeNode {
    if (type.kind !== 'UnionType') return isNamedType(type, 'null') ? named('any') : type
    return unionOf(type.types.filter(part => !isNamedType(part, 'null')))
}

function iterableElementType(type: TypeNode, env: Env): TypeNode {
    const resolved = resolveType(type, env)
    if (resolved.kind === 'ArrayType') return resolved.element
    if (resolved.kind === 'GenericType' && (resolved.name === 'Array' || resolved.name === 'ReadonlyArray')) {
        return resolved.args[0] ?? named('any')
    }
    if (resolved.kind === 'ObjectType') {
        const toArray = resolved.members.find(member => member.name === 'toArray' && member.method)
        if (toArray) {
            const result = resolveType(toArray.type, env)
            if (result.kind === 'ArrayType') return result.element
            if (result.kind === 'GenericType' && (result.name === 'Array' || result.name === 'ReadonlyArray')) return result.args[0] ?? named('any')
        }
    }
    if (resolved.kind === 'UnionType') return unionOf(resolved.types.map(part => iterableElementType(part, env)))
    if (isNamedType(resolved, 'string')) return named('string')
    return named('any')
}

function isNullable(type: TypeNode, env: Env): boolean {
    const resolved = resolveType(type, env)
    return isNamedType(resolved, 'null') || (resolved.kind === 'UnionType' && resolved.types.some(part => isNamedType(resolveType(part, env), 'null')))
}

function hasSameNumericType(left: TypeNode, right: TypeNode): boolean {
    return (isNamedType(left, 'number') && isNamedType(right, 'number')) ||
        (isNamedType(left, 'BigInt') && isNamedType(right, 'BigInt'))
}

function binaryResultType(operator: string, left: TypeNode, right: TypeNode): TypeNode {
    if (operator === '??') {
        const remaining = left.kind === 'UnionType'
            ? left.types.filter(part => !isNamedType(part, 'null'))
            : isNamedType(left, 'null') ? [] : [left]
        return unionOf([...remaining, right])
    }
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
        case 'Template': return named('string')
        case 'Literal': return inferLiteral(expression.value)
        case 'Assignment': return inferExpression(expression.value, env)
        case 'MemberAssignment': return inferExpression(expression.value, env)
        case 'Identifier': {
            if (expression.name === 'this') {
                const self = env.get('this')
                return self?.kind === 'var' ? self.type : named('any')
            }
            const symbol = env.get(expression.name)
            if (!symbol) return named('any')
            if (symbol.kind === 'var') return symbol.type
            if (symbol.kind === 'fun') return { kind: 'FunctionType', params: symbol.params.map(parameterType), result: symbol.returnType }
            if (symbol.kind === 'module') return moduleType(symbol.module)
            return named(expression.name)
        }
        case 'Array': {
            if (!expression.elements.length) return arrayOf(named('any'))
            const elements = expression.elements.map(item => inferExpression(item, env))
            const resolvedElements = elements.map(item => resolveType(item, env))
            if (resolvedElements.every(item => item.kind === 'ObjectType')) {
                const objectElements = resolvedElements as Extract<TypeNode, { kind: 'ObjectType' }>[]
                const memberNames = [...new Set(objectElements.flatMap(item => item.members.map(member => member.name)))]
                const members = memberNames.map(name => {
                    const present = objectElements.flatMap(item => item.members.filter(member => member.name === name))
                    const types = present.map(member => member.type)
                    if (present.length < objectElements.length) types.push(named('null'))
                    return field(name, unionOf(types))
                })
                return arrayOf({ kind: 'ObjectType', members })
            }
            return arrayOf(unionOf(elements))
        }
        case 'Object': {
            // Build the object's shape before inferring methods so `this` inside a
            // method can resolve both fields and other methods on the object.
            const members: TypeMember[] = expression.properties.flatMap(property => {
                if (property.accessor === 'get' && property.value.kind === 'Function') {
                    const result = property.value.returnType ?? inferFunctionReturnType(property.value.body, env, property.value.params)
                    return [{ ...field(property.key, result), accessor: 'get' as const }]
                }
                if (property.accessor === 'set' && property.value.kind === 'Function') {
                    const setterType = property.value.params[0] ? parameterBodyType(property.value.params[0]) : named('any')
                    return [{ ...field(property.key, setterType), accessor: 'set' as const, params: property.value.params }]
                }
                if (property.value.kind === 'Function') {
                    return [method(property.key, property.value.params, property.value.returnType ?? named('any'))]
                }
                return [field(property.key, inferExpression(property.value, env))]
            })
            const objectType: TypeNode = { kind: 'ObjectType', members }
            const methodEnv = new Map(env)
            methodEnv.set('this', { kind: 'var', mutable: false, type: objectType })
            for (const property of expression.properties) {
                if (property.accessor === 'set' || property.value.kind !== 'Function' || property.value.returnType) continue
                const index = members.findIndex(member => member.name === property.key)
                if (index >= 0) {
                    const inferred = inferFunctionReturnType(property.value.body, methodEnv, property.value.params)
                    members[index] = property.accessor === 'get'
                        ? { ...field(property.key, inferred), accessor: 'get' }
                        : method(property.key, property.value.params, inferred)
                }
            }
            return objectType
        }
        case 'Unary': return expression.operator === 'postfix!' ? removeNull(inferExpression(expression.operand, env)) : expression.operator.endsWith('++') || expression.operator.endsWith('--') ? inferExpression(expression.operand, env) : expression.operator === '-' ? named('number') : named('boolean')
        case 'Conditional':
            return unionOf([inferExpression(expression.consequent, env), inferExpression(expression.alternate, env)])
        case 'Binary': {
            const left = inferExpression(expression.left, env)
            const right = inferExpression(expression.right, env)
            return binaryResultType(expression.operator, left, right)
        }
        case 'Member': {
            const objectType = inferExpression(expression.object, env)
            const nonNullObjectType = removeNull(resolveType(objectType, env))
            const resolvedObjectType = resolveType(nonNullObjectType, env)
            const member = lookupMember(nonNullObjectType, expression.property, env)
            if (!member) return resolvedObjectType.kind === 'ObjectType' ? named('null') : named('any')
            const memberType = isFunctionSymbol(member)
                ? { kind: 'FunctionType', params: member.params.map(parameterType), result: member.returnType } as TypeNode
                : member
            return expression.optional ? unionOf([memberType, named('null')]) : memberType
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
            if (expression.callee.kind === 'Member' && expression.callee.property === 'as' && expression.typeArguments?.length) return expression.typeArguments[0]
            if (expression.callee.kind === 'Identifier' && env.get(expression.callee.name)?.kind === 'type') return named(expression.callee.name)
            const callee = inferExpression(expression.callee, env)
            if (callee.kind === 'FunctionType') return callee.result
            if (expression.callee.kind === 'Identifier') {
                const symbol = env.get(expression.callee.name)
                if (symbol?.kind === 'fun') return symbol.returnType
            }
            if (expression.callee.kind === 'Member') {
                const objectType = inferExpression(expression.callee.object, env)
                const member = lookupMember(objectType, expression.callee.property, env)
                if (isFunctionSymbol(member)) {
                    if (!member.body) return member.returnType
                    const local = bindInferredParameters(member.params, env)
                    local.set('this', { kind: 'var', mutable: false, type: member.ownerType ?? objectType })
                    return inferFunctionReturnType(member.body, local, member.params)
                }
            }
            return named('any')
        }
        case 'Function': return { kind: 'FunctionType', params: expression.params.map(parameterType), result: expression.returnType ?? (expression.expressionBody ? inferExpression(expression.expressionBody, env) : inferFunctionReturnType(expression.body, env, expression.params)) }
    }
}

function inferFunctionReturnType(statements: Statement[], outer: Env, params: Parameter[] = []): TypeNode {
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
    const local = bindInferredParameters(params, outer)
    collect(statements, local)
    return returns.length ? unionOf(returns) : named('null')
}

function unionOf(types: TypeNode[]): TypeNode {
    const flattened = types.flatMap(type => type.kind === 'UnionType' ? type.types : [type])
    if (!flattened.length) return named('any')
    const unique = flattened.filter((type, index) => flattened.findIndex(item => printType(item) === printType(type)) === index)
    return unique.length === 1 ? unique[0] : { kind: 'UnionType', types: unique }
}

function functionType(params: Parameter[], returnType?: TypeNode): TypeNode {
    return { kind: 'FunctionType', params: params.map(parameterType), result: returnType ?? named('any') }
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

    analyze(statements: Statement[], builtins: Map<string, ImportedSymbol> = new Map()): void {
        const env = globals()
        for (const [name, symbol] of builtins) if (symbol.kind === 'type') {
            env.set(name, { kind: 'type', generics: symbol.generics, value: symbol.value })
        }
        for (const statement of statements) if (statement.kind === 'Import') {
            for (const [name, symbol] of Object.entries(statement.importedSymbols ?? {})) {
                if (symbol.kind === 'type' && symbol.value) env.set(name, { kind: 'type', generics: symbol.generics ?? [], value: symbol.value })
                else if (symbol.kind === 'fun') env.set(name, { kind: 'fun', params: symbol.params ?? [], returnType: symbol.returnType ?? named('any') })
                else if (symbol.kind === 'var') env.set(name, { kind: 'var', mutable: false, type: symbol.type ?? named('any') })
            }
            for (const [name, value] of Object.entries(statement.importedTypes ?? {})) {
                env.set(name, { kind: 'type', generics: [], value })
            }
        }
        for (const statement of statements) if (statement.kind === 'Import') this.statement(statement, env)
        this.statements(statements, env)
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
        let positional = 0
        args.forEach(arg => {
            const param = params!.find((item, index) => item.rest === true ? positional >= index : index === positional)
            const loc = expressionStart(arg)
            if (!param || !loc) return
            const inferredParamType = parameterType(param)
            const argumentType = param.rest === true && inferredParamType.kind === 'ArrayType' ? inferredParamType.element : inferredParamType
            this.hints.push({
                line: loc.line,
                column: loc.column,
                label: `${param.name}:`,
                tooltip: `${param.name}: ${printType(argumentType)}`,
                kind: 'parameter'
            })
            positional++
        })
    }

    private bind(env: Env, name: string, symbol: SymbolInfo): void {
        env.set(name, symbol)
    }

    private narrowedConditionEnv(condition: Expression, env: Env, whenTruthy: boolean): Env {
        const narrowed = new Map(env)
        if (condition.kind === 'Call'
            && condition.callee.kind === 'Member'
            && condition.callee.property === 'has'
            && condition.callee.object.kind === 'Identifier'
            && condition.callee.object.name === 'this') {
            const argument = condition.args[0]
            const argumentSymbol = argument?.kind === 'Identifier' ? env.get(argument.name) : undefined
            const property = argument?.kind === 'Literal' && typeof argument.value === 'string'
                ? argument.value
                : argumentSymbol?.kind === 'var' && argumentSymbol.type.kind === 'LiteralType' && typeof argumentSymbol.type.value === 'string'
                    ? argumentSymbol.type.value
                    : undefined
            if (property) {
                const self = narrowed.get('this')
                if (self?.kind === 'var') narrowed.set('this', { ...self, type: narrowHasProperty(self.type, property, env) })
            }
        }
        if (condition.kind === 'Binary' && (condition.operator === '==' || condition.operator === '!=')) {
            const identifier = condition.left.kind === 'Identifier' && condition.right.kind === 'Literal' && condition.right.value === null
                ? condition.left
                : condition.right.kind === 'Identifier' && condition.left.kind === 'Literal' && condition.left.value === null
                    ? condition.right
                    : undefined
            if (identifier) {
                const symbol = narrowed.get(identifier.name)
                const isNullBranch = (condition.operator === '==') === whenTruthy
                if (symbol?.kind === 'var') narrowed.set(identifier.name, { ...symbol, type: isNullBranch ? named('null') : removeNull(symbol.type) })
            }
        }
        return narrowed
    }

    private statements(statements: Statement[], env: Env): void {
        const declaredHere = new Set<string>()
        for (const statement of statements) {
            const candidate = statement.kind === 'Export' ? statement.declaration : statement
            const declarationName = candidate.kind === 'Variable' || candidate.kind === 'FunctionDeclaration' || candidate.kind === 'TypeDeclaration'
                ? candidate.name
                : undefined
            if (declarationName && declaredHere.has(declarationName)) {
                const loc = candidate.loc
                if (loc) this.diagnostics.push({
                    line: loc.line,
                    column: loc.column,
                    length: declarationName.length,
                    message: `Duplicate declaration '${declarationName}' in the same scope.`
                })
            }
            if (declarationName) declaredHere.add(declarationName)
            this.statement(statement, env)
        }
    }

    private statement(statement: Statement, env: Env): void {
        switch (statement.kind) {
            case 'Import': {
                const imported = statement.module === 'juno:node'
                    ? 'Node.js helpers for JunoScript (`console.args`, `console.read`, `console.readLines`).'
                    : statement.module === 'types' ? 'Runtime type utilities for transforming Juno type declarations.' : 'Standard JunoScript module. `console` mirrors the host console.'
                if (statement.defaultImport) {
                    const symbol: SymbolInfo = { kind: 'module', module: statement.module, docs: imported }
                    this.bind(env, statement.defaultImport, symbol)
                    const printed = printSymbol(statement.defaultImport, symbol)
                    this.addHover(statement.defaultImport, statement.defaultImportLoc, printed.code, printed.docs)
                }
                statement.namedImports.forEach((name, index) => {
                    const importedAlias = statement.importedTypes?.[name]
                    const importedSymbol = statement.importedSymbols?.[name]
                    const type = importedAlias ? resolveType(importedAlias, env) : importedSymbol?.kind === 'var' ? importedSymbol.type ?? named('any') : name === 'console' ? consoleType()
                        : name === 'Math' && statement.module === 'juno' ? mathType()
                        : name === 'types' && statement.module === 'juno' ? typeUtilitiesType()
                        : statement.module === 'types' && ['Partial', 'Required', 'Readonly', 'Pick', 'Omit'].includes(name) ? typeUtilitiesType().kind === 'ObjectType' ? typeUtilitiesType().members.find(member => member.name === name)?.type ?? named('any') : named('any')
                        : named('any')
                    const symbol: SymbolInfo = importedSymbol?.kind === 'fun'
                        ? { kind: 'fun', params: importedSymbol.params ?? [], returnType: importedSymbol.returnType ?? named('any'), docs: imported }
                        : {
                        kind: importedAlias || importedSymbol?.kind === 'type' ? 'type' : 'var',
                        mutable: false,
                        ...(importedAlias || importedSymbol?.kind === 'type' ? { generics: importedSymbol?.generics ?? [], value: importedAlias ?? importedSymbol?.value ?? named('any') } : { type }),
                        docs: name === 'console'
                            ? (statement.module === 'juno:node' ? 'Console with `log`, `args`, `read`, and `readLines`.' : 'Host console (`log`, `error`, `warn`).')
                            : name === 'Math' && statement.module === 'juno' ? 'Standard JavaScript Math constants and functions.'
                            : name === 'types' && statement.module === 'juno' ? 'Runtime type transformation utilities.' : imported
                    }
                    this.bind(env, name, symbol)
                    const printed = printSymbol(name, symbol)
                    this.addHover(name, statement.namedImportLocs?.[index], printed.code, printed.docs)
                })
                return
            }
            case 'Export': this.statement(statement.declaration, env); return
            case 'TypeDeclaration': {
                const symbol: SymbolInfo = { kind: 'type', generics: statement.generics, value: statement.value }
                this.bind(env, statement.name, symbol)
                this.walkType(statement.value, env)
                const resolved = resolveType(statement.value, env)
                const printed = {
                    code: `type ${statement.name}${statement.generics.length ? `<${statement.generics.join(', ')}>` : ''} = ${printType(resolved)}`
                }
                this.addHover(statement.name, statement.loc, printed.code)
                statement.generics.forEach((name, index) => this.addHover(name, statement.genericLocs?.[index], `(type parameter) ${name}`))
                return
            }
            case 'Variable': {
                this.walkExpression(statement.initializer, env)
                const type = statement.type ? resolveType(statement.type, env) : statement.initializer ? inferExpression(statement.initializer, env) : named('any')
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
                        const missing = expected.members.filter(member => !member.optional && (!member.method || member.accessor === 'get') && member.accessor !== 'set' && !member.defaultValue && !isNullable(member.type, env) && !actualMembers.some(item => item.name === member.name))
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
                const inferenceEnv = bindInferredParameters(statement.params, env)
                const returnType = statement.returnType ?? inferFunctionReturnType(statement.body, inferenceEnv, statement.params)
                const symbol: SymbolInfo = { kind: 'fun', params: statement.params, returnType }
                statement.params.forEach((param, index) => {
                    if (!param.type && param.defaultValue !== undefined) symbol.params[index] = { ...param, type: (inferenceEnv.get(param.name) as Extract<SymbolInfo, { kind: 'var' }>).type }
                })
                this.bind(env, statement.name, symbol)
                const printed = printSymbol(statement.name, symbol)
                this.addHover(statement.name, statement.loc, printed.code)
                const local = bindInferredParameters(statement.params, env)
                for (const param of statement.params) {
                    const bodyType = (local.get(param.name) as Extract<SymbolInfo, { kind: 'var' }>).type
                    const type = param.rest ? parameterType(param) : bodyType
                    this.addHover(param.name, param.loc, parameterHover(param, param.rest ? parameterType(param) : bodyType))
                    this.addTypeHint(param.loc, param.name, Boolean(param.type), bodyType)
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
                if (isNullable(inferExpression(statement.condition, env), env)) this.addDiagnostic(expressionStart(statement.condition), 'Nullable value cannot be used as a condition; use ! or ?? to handle null.')
                this.statements(statement.consequent, this.narrowedConditionEnv(statement.condition, env, true))
                if (statement.alternate) this.statements(statement.alternate, this.narrowedConditionEnv(statement.condition, env, false))
                return
            }
            case 'While':
                this.walkExpression(statement.condition, env)
                if (isNullable(inferExpression(statement.condition, env), env)) this.addDiagnostic(expressionStart(statement.condition), 'Nullable value cannot be used as a condition; use ! or ?? to handle null.')
                this.statements(statement.body, this.narrowedConditionEnv(statement.condition, env, true))
                return
            case 'ForOf': {
                this.walkExpression(statement.iterable, env)
                const iterable = inferExpression(statement.iterable, env)
                const bindingType = iterableElementType(iterable, env)
                const local = new Map(env)
                this.bind(local, statement.binding, { kind: 'var', mutable: statement.mutable, type: bindingType })
                this.addHover(statement.binding, statement.loc, `${statement.mutable ? 'let' : 'const'} ${statement.binding}: ${printType(bindingType)}`)
                this.addTypeHint(statement.loc, statement.binding, false, bindingType)
                this.statements(statement.body, local)
                return
            }
        }
    }

    private walkType(type: TypeNode, env: Env, thisType?: TypeNode): void {
        switch (type.kind) {
            case 'NamedType': {
                const symbol = env.get(type.name)
                if (symbol) {
                    const printed = printSymbol(type.name, symbol)
                    this.addHover(type.name, type.loc, printed.code, printed.docs)
                } else this.addHover(type.name, type.loc, `(type) ${type.name}`)
                return
            }
            case 'LiteralType':
                return
            case 'GenericType': {
                const symbol = env.get(type.name)
                if (['Partial', 'Required', 'Readonly', 'Pick', 'Omit'].includes(type.name)) {
                    const parameters = type.name === 'Pick' || type.name === 'Omit' ? '<T, K>' : '<T>'
                    this.addHover(type.name, type.loc, `type ${type.name}${parameters}`)
                } else if (symbol && symbol.kind !== 'type') {
                    const printed = printSymbol(type.name, symbol)
                    this.addHover(type.name, type.loc, printed.code, printed.docs)
                } else {
                    const resolved = resolveType(type, env)
                    this.addHover(type.name, type.loc, `(type) ${printType(resolved)}`)
                }
                type.args.forEach(arg => this.walkType(arg, env))
                return
            }
            case 'UnionType':
            case 'IntersectionType':
                type.types.forEach(part => this.walkType(part, env, thisType ?? type))
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
                    if (!member.method || !member.body) continue
                    const local = new Map(env)
                    this.bind(local, 'this', { kind: 'var', mutable: false, type: thisType ?? type })
                    for (const param of member.params ?? []) {
                        const paramType = parameterBodyType(param)
                        this.bind(local, param.name, { kind: 'var', mutable: true, type: paramType })
                        if (param.defaultValue) this.walkExpression(param.defaultValue, local)
                    }
                    if (isNamedType(member.type, 'any')) member.type = inferFunctionReturnType(member.body, local, member.params ?? [])
                    this.statements(member.body, local)
                }
                for (const member of type.members) {
                    const signature = member.accessor === 'get'
                        ? `(getter) ${member.name}: ${printType(member.type)}`
                        : member.accessor === 'set'
                            ? `(setter) ${member.name}(${(member.params ?? []).map(printParam).join(', ')})`
                            : member.method
                                ? `(method) ${member.name}(${(member.params ?? []).map(printParam).join(', ')}): ${printType(member.type)}`
                                : `(property) ${member.readonly ? 'readonly ' : ''}${member.name}${member.optional ? '?' : ''}: ${printType(member.type)}`
                    this.addHover(member.name, member.loc, signature)
                    this.walkType(member.type, env)
                    if (member.method) {
                        for (const param of member.params ?? []) {
                        const paramType = parameterBodyType(param)
                            this.addHover(param.name, param.loc, parameterHover(param, paramType))
                            this.addTypeHint(param.loc, param.name, Boolean(param.type), paramType)
                            if (param.type) this.walkType(param.type, env)
                        }
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
            case 'Template':
                for (const part of expression.parts) if (typeof part !== 'string') this.walkExpression(part, env, thisType)
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
            case 'MemberAssignment':
                this.walkExpression(expression.object, env, thisType)
                this.walkExpression(expression.value, env, thisType)
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
                    if (property.value.kind === 'Identifier' && property.key === property.value.name) {
                        const symbol = env.get(property.value.name)
                        if (symbol) {
                            const printed = printSymbol(property.value.name, symbol)
                            this.addHover(property.value.name, property.value.loc, printed.code, printed.docs)
                        }
                    } else if (property.value.kind === 'Function') this.walkFunction(property.value, methodEnv)
                    else this.walkExpression(property.value, env, thisType)
                }
                return
            }
            case 'Unary':
                this.walkExpression(expression.operand, env, thisType)
                if (expression.operator !== 'postfix!' && isNullable(inferExpression(expression.operand, env), env)) this.addDiagnostic(expression.loc, 'Nullable value cannot be used with this operator; use ! or ?? to handle null.')
                return
            case 'Binary': {
                this.walkExpression(expression.left, env, thisType)
                this.walkExpression(expression.right, env, thisType)
                const leftType = inferExpression(expression.left, env), rightType = inferExpression(expression.right, env)
                const nullComparison = ['==', '!='].includes(expression.operator) && (expression.left.kind === 'Literal' && expression.left.value === null || expression.right.kind === 'Literal' && expression.right.value === null)
                if (expression.operator !== '??' && !nullComparison && (isNullable(leftType, env) || isNullable(rightType, env))) {
                    this.addDiagnostic(expression.loc, 'Nullable value cannot be used with this operator; use ! or ?? to handle null.')
                } else {
                    const message = binaryErrorMessage(expression.operator, leftType, rightType)
                    if (message) this.addDiagnostic(expression.loc, message)
                }
                return
            }
            case 'Index': {
                this.walkExpression(expression.object, env, thisType)
                this.walkExpression(expression.index, env, thisType)
                if (isNullable(inferExpression(expression.object, env), env)) this.addDiagnostic(expression.loc, 'Cannot index a nullable value; use ! or ?? to handle null.')
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
                const nullableObject = isNullable(objectType, env)
                const nonNullObjectType = removeNull(resolveType(objectType, env))
                const resolvedObjectType = resolveType(nonNullObjectType, env)
                const member = lookupMember(nonNullObjectType, expression.property, env)
                if (nullableObject && !expression.optional) this.diagnostics.push({ line: expression.loc?.line ?? 1, column: expression.loc?.column ?? 1, length: expression.property.length, message: `Cannot access '${expression.property}' on a nullable value; use ! or ?., or ?? to handle null.` })
                if (isFunctionSymbol(member)) {
                    const signature = expression.property === 'as'
                        ? '(method) as<T>(): T'
                        : `(method) ${expression.property}(${member.params.map(printParam).join(', ')}): ${printType(member.returnType)}`
                    this.addHover(expression.property, expression.loc, signature)
                } else if (member) {
                    this.addHover(expression.property, expression.loc, `(property) ${expression.property}: ${printType(member)}`)
                } else if (resolvedObjectType.kind === 'UnionType') {
                    const missingPart = resolvedObjectType.types.find(part => !lookupMember(part, expression.property, env))
                    if (missingPart && expression.loc) this.diagnostics.push({
                        line: expression.loc.line,
                        column: expression.loc.column,
                        length: expression.property.length,
                        message: `Property '${expression.property}' does not exist on type '${printType(objectType)}'.\n  Property '${expression.property}' does not exist on type '${printType(missingPart)}'.`
                    })
                } else if (resolvedObjectType.kind === 'ObjectType') {
                    if (expression.loc) this.diagnostics.push({
                        line: expression.loc.line,
                        column: expression.loc.column,
                        length: expression.property.length,
                        message: `Property '${expression.property}' does not exist on type '${printType(objectType)}'.`
                    })
                } else {
                    const missingPart = missingUnionMember(resolvedObjectType, expression.property, env)
                    if (missingPart && expression.loc) this.diagnostics.push({
                        line: expression.loc.line,
                        column: expression.loc.column,
                        length: expression.property.length,
                        message: `Property '${expression.property}' does not exist on type '${printType(objectType)}'.\n  Property '${expression.property}' does not exist on type '${printType(missingPart)}'.`
                    })
                }
                return
            }
            case 'Call': {
                this.walkExpression(expression.callee, env, thisType)
                const calleeType = resolveType(inferExpression(expression.callee, env), env)
                if (isNullable(calleeType, env) && !(expression.callee.kind === 'Member' && expression.callee.optional)) {
                    this.addDiagnostic(expressionStart(expression.callee), 'Cannot call a nullable value; use ! or ?? to handle null.')
                }
                if (calleeType.kind === 'UnionType') {
                    const nonCallable = calleeType.types.find(part => {
                        const resolved = resolveType(part, env)
                        return !isNamedType(resolved, 'any') && resolved.kind !== 'FunctionType'
                    })
                    if (nonCallable) {
                        let loc = expressionStart(expression.callee)
                        let length = 1
                        if (expression.callee.kind === 'Index' && expression.callee.loc) {
                            const objectLoc = expressionStart(expression.callee.object) ?? expression.callee.loc
                            loc = objectLoc
                            const indexLoc = expressionStart(expression.callee.index) ?? expression.callee.loc
                            const indexLength = expression.callee.index.kind === 'Literal' ? String(expression.callee.index.value).length : 1
                            length = Math.max(1, indexLoc.column + indexLength + 1 - objectLoc.column)
                        }
                        if (loc) this.diagnostics.push({
                            line: loc.line,
                            column: loc.column,
                            length,
                            message: `This expression is not callable.\n  Not all constituents of type '${printType(calleeType)}' are callable.\n    Type '${printType(nonCallable)}' has no call signatures.`
                        })
                    }
                }
                if (expression.callee.kind === 'Member' && expression.callee.loc) {
                    const hover = this.hovers.find(item => item.line === expression.callee.loc?.line && item.column === expression.callee.loc?.column && item.code.startsWith('(method)'))
                    if (hover) hover.code += `\n(infer) ${printType(inferExpression(expression, env))}`
                }
                expression.args.forEach((arg, index) => {
                    const contextualType = calleeType.kind === 'FunctionType' ? calleeType.params[index] : undefined
                    if (arg.kind === 'Function') this.walkFunction(arg, env, contextualType)
                    else this.walkExpression(arg, env, thisType)
                })
                expression.typeArguments?.forEach(type => this.walkType(type, env))
                if (expression.callee.kind === 'Member' && expression.callee.property === 'as' && expression.typeArguments?.length) {
                    const target = expression.typeArguments[0]
                    if (target.loc) {
                        const hover = this.hovers.find(item => item.line === target.loc?.line && item.column === target.loc?.column)
                        if (hover && !hover.code.includes('(infer)')) hover.code += `\n(infer) ${printType(inferExpression(expression, env))}`
                    }
                }
                this.addParameterHints(expression.callee, expression.args, env)
                return
            }
            case 'Function':
                this.walkFunction(expression, env)
                return
        case 'Conditional':
            this.walkExpression(expression.condition, env, thisType)
            this.walkExpression(expression.consequent, env, thisType)
            this.walkExpression(expression.alternate, env, thisType)
            return
        }
    }

    private walkFunction(expression: Extract<Expression, { kind: 'Function' }>, env: Env, contextualType?: TypeNode): void {
        const local = bindInferredParameters(expression.params, env)
        const contextual = contextualType ? resolveType(contextualType, env) : undefined
        if (contextual?.kind === 'FunctionType') expression.params.forEach((param, index) => {
            if (!param.type && contextual.params[index]) local.set(param.name, { kind: 'var', mutable: true, type: contextual.params[index] })
        })
        for (const param of expression.params) {
            const type = (local.get(param.name) as Extract<SymbolInfo, { kind: 'var' }>).type
            if (!param.type && param.defaultValue !== undefined) {
                const index = expression.params.indexOf(param)
                expression.params[index] = { ...param, type }
            }
            this.addHover(param.name, param.loc, parameterHover(param, type))
            this.addTypeHint(param.loc, param.name, Boolean(param.type), type)
            if (param.type) this.walkType(param.type, env)
            if (param.defaultValue) this.walkExpression(param.defaultValue, local)
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
        case 'MemberAssignment':
            return expression.loc ?? expressionStart(expression.object)
        case 'Template':
            return expression.loc
        case 'Conditional':
            return expressionStart(expression.condition)
        case 'Binary':
            return expressionStart(expression.left)
        case 'Member':
            return expressionStart(expression.object)
        case 'Index':
            return expressionStart(expression.object)
        case 'Call':
            return expressionStart(expression.callee)
        case 'Function':
            return expression.params[0]?.loc
    }
}

export function analyze(source: string, filePath?: string): { hovers: HoverInfo[]; hints: InlayHintInfo[]; diagnostics: DiagnosticInfo[] } | undefined {
    try {
        const analyzer = new Analyzer()
        const statements = parse(source, { validate: false, filePath })
        const imported = importedDeclarations(statements, filePath)
        if (statements.some(statement => statement.kind === 'TypeDeclaration' && JSON.stringify(statement.value).includes('Iterable'))) {
            const fs = require('node:fs') as typeof import('node:fs')
            const path = require('node:path') as typeof import('node:path')
            let directory = path.dirname(path.resolve(filePath ?? process.cwd()))
            let iterablePath: string | undefined
            while (true) {
                const candidate = path.join(directory, 'iterable.jn')
                if (fs.existsSync(candidate)) { iterablePath = candidate; break }
                const parent = path.dirname(directory)
                if (parent === directory) break
                directory = parent
            }
            iterablePath ??= path.resolve(__dirname, '../../iterable.jn')
            if (fs.existsSync(iterablePath)) {
                const iterableStatements = parse(fs.readFileSync(iterablePath, 'utf8'), { validate: false, filePath: iterablePath })
                const iterable = importedDeclarations(iterableStatements).get('Iterable')
                if (iterable?.kind === 'type') imported.set('Iterable', iterable)
            }
        }
        for (const statement of statements) if (statement.kind === 'Import') {
            const selected = [...imported].filter(([name]) => statement.namedImports.includes(name))
            statement.importedTypes = Object.fromEntries(selected.flatMap(([name, symbol]) => symbol.kind === 'type' ? [[name, symbol.value]] : []))
            statement.importedSymbols = Object.fromEntries(selected)
        }
        const builtins = new Map<string, ImportedSymbol>()
        const iterable = imported.get('Iterable')
        if (iterable?.kind === 'type' && !statements.some(statement => statement.kind === 'TypeDeclaration' && statement.name === 'Iterable')) builtins.set('Iterable', iterable)
        analyzer.analyze(statements, builtins)
        return { hovers: analyzer.hovers, hints: analyzer.hints, diagnostics: analyzer.diagnostics }
    } catch (error) {
        return undefined
        return undefined
    }
}

export function hoverAt(source: string, line: number, column: number, filePath?: string): HoverInfo | undefined {
    const result = analyze(source, filePath)
    if (!result) return undefined
    const matches = result.hovers.filter(item => item.line === line && column >= item.column && column <= item.column + item.length)
    return matches.sort((a, b) => a.length - b.length)[0]
}

export function inlayHintsFor(source: string, filePath?: string): InlayHintInfo[] {
    return analyze(source, filePath)?.hints ?? []
}

