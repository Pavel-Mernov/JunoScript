// @ts-nocheck -- this analyzer is bundled by esbuild for the VS Code extension.
import { Expression, Loc, MatchPattern, Parameter, Statement, TypeMember, TypeNode, parse } from '../../Lexer/parser'

export type HoverInfo = {
    line: number
    column: number
    length: number
    code: string
    typeDescription?: string
    docs?: string
}

export type InlayHintInfo = {
    line: number
    column: number
    label: string
    tooltip: string
    kind: 'type' | 'callbackType' | 'parameter'
}

export type DiagnosticInfo = {
    line: number
    column: number
    length: number
    message: string
    fix?: { title: string; line: number; fields: { name: string; type: string }[] }
}

export type SemanticTokenInfo = {
    line: number
    column: number
    length: number
    type: 'method'
}

type SymbolInfo =
    | { kind: 'var'; mutable: boolean; type: TypeNode; docs?: string; keyConstraint?: TypeNode }
    | { kind: 'fun'; generics?: string[]; genericConstraints?: (TypeNode | undefined)[]; genericDefaults?: (TypeNode | undefined)[]; params: Parameter[]; returnType: TypeNode; docs?: string }
    | { kind: 'type'; generics: string[]; genericConstraints?: (TypeNode | undefined)[]; genericDefaults?: (TypeNode | undefined)[]; value: TypeNode; docs?: string; typeParameter?: boolean }
    | { kind: 'constructor'; generics: string[]; genericConstraints?: (TypeNode | undefined)[]; genericDefaults?: (TypeNode | undefined)[]; inheritedType: TypeNode; overloads: { params: Parameter[]; returnType: TypeNode }[]; methods: { name: string; generics: string[]; genericConstraints?: (TypeNode | undefined)[]; genericDefaults?: (TypeNode | undefined)[]; params: Parameter[]; returnType: TypeNode }[]; docs?: string }
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
            ...['E', 'LN10', 'LN2', 'LOG10E', 'LOG2E', 'PI', 'SQRT1_2', 'SQRT2', 'NaN', 'Infinity'].map(name => field(name, number, true)),
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
        members: ['Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'KeyOf', 'Exclude'].map(name => field(name, {
            kind: 'FunctionType', params: name === 'Pick' || name === 'Omit' ? [any, arrayOf(named('string'))] : [any], result: any
        }))
    }
}

function moduleType(module: 'juno' | 'juno:node' | 'juno:types' | 'types'): TypeNode {
    if (module === 'juno:types' || module === 'types') return typeUtilitiesType()
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
    env.set('RegEx', {
        kind: 'fun',
        params: [{ name: 'pattern', type: named('string') }, { name: 'flags', type: named('string'), defaultValue: { kind: 'Literal', value: '' } }],
        returnType: named('RegEx'),
        docs: 'Creates a regular expression without the `new` keyword.'
    })
    return env
}

export function printType(type: TypeNode): string {
    switch (type.kind) {
        case 'NamedType': return type.name
        case 'LiteralType': return typeof type.value === 'string' ? JSON.stringify(type.value) : String(type.value)
        case 'GenericType': return `${type.name}<${type.args.map(printType).join(', ')}>`
        case 'IndexedAccessType': return `${printType(type.object)}[${printType(type.index)}]`
        case 'TypeOfType': return `typeof<…>`
        case 'ConditionalType': return `${printType(type.check)} is ${printType(type.target)} ? ${printType(type.consequent)} : ${printType(type.alternate)}`
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
                if (member.indexType) return `[${member.name}: ${printType(member.indexType)}]: ${printType(member.type)}`
                if (member.name === '' && member.method) return `fun (${(member.params ?? []).map(printParam).join(', ')}): ${printType(member.type)}`
                const prefix = `${member.readonly ? 'readonly ' : ''}${member.sealed ? 'sealed ' : ''}${member.constant ? 'const ' : ''}${member.name}${member.optional ? '?' : ''}`
                if (member.accessor === 'get') return `${member.sealed ? 'sealed ' : ''}get ${member.name}(): ${printType(member.type)}`
                if (member.accessor === 'set') return `${member.sealed ? 'sealed ' : ''}set ${member.name}(${(member.params ?? []).map(printParam).join(', ')}): void`
                if (member.method) return `${prefix}${printGenerics(member.generics ?? [], member.genericConstraints, member.genericDefaults)}(${(member.params ?? []).map(printParam).join(', ')}): ${printType(member.type)}`
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

function printFunction(name: string, params: Parameter[], returnType: TypeNode, generics: string[] = [], constraints: (TypeNode | undefined)[] = [], defaults: (TypeNode | undefined)[] = []): string {
    const genericText = generics.length ? `<${generics.map((generic, index) => `${generic}${constraints[index] ? ` is ${printType(constraints[index]!)}` : ''}${defaults[index] ? ` = ${printType(defaults[index]!)}` : ''}`).join(', ')}>` : ''
    return `fun ${name}${genericText}(${params.map(printParam).join(', ')}): ${printType(returnType)}`
}

function printGenerics(generics: string[], constraints: (TypeNode | undefined)[] = [], defaults: (TypeNode | undefined)[] = []): string {
    return generics.length ? `<${generics.map((generic, index) => `${generic}${constraints[index] ? ` is ${printType(constraints[index]!)}` : ''}${defaults[index] ? ` = ${printType(defaults[index]!)}` : ''}`).join(', ')}>` : ''
}

function printGenericInference(generics: string[], args: TypeNode[]): string {
    return `<${generics.map((name, index) => `${name} = ${printType(args[index] ?? named('any'))}`).join(', ')}>`
}

function printSymbol(name: string, symbol: SymbolInfo): { code: string; docs?: string } {
    switch (symbol.kind) {
        case 'var': return { code: `${symbol.mutable ? 'let' : 'const'} ${name}: ${printType(symbol.type)}`, docs: symbol.docs }
        case 'fun': return { code: printFunction(name, symbol.params, symbol.returnType, symbol.generics, symbol.genericConstraints, symbol.genericDefaults), docs: symbol.docs }
        case 'type': {
            const generics = printGenerics(symbol.generics, symbol.genericConstraints, symbol.genericDefaults)
            return { code: `type ${name}${generics}`, docs: symbol.docs }
        }
        case 'module': return { code: `import ${name} from '${symbol.module}'`, docs: symbol.docs }
        case 'constructor': {
            const generics = printGenerics(symbol.generics, symbol.genericConstraints, symbol.genericDefaults)
            const resultType = symbol.generics.length ? `${name}<${symbol.generics.join(', ')}>` : name
            const structural = symbol.inheritedType.kind === 'ObjectType' && symbol.inheritedType.members.length === 0
            const overloads = symbol.overloads.map(item => `constructor ${name}${generics}(${item.params.map(printParam).join(', ')}): ${structural ? printType(item.returnType) : resultType}`)
            const methods = symbol.methods.map(method => `${name}.${method.name}${printGenerics(method.generics, method.genericConstraints, method.genericDefaults)}(${method.params.map(printParam).join(', ')}): ${printType(method.returnType)}`)
            return { code: [...overloads, ...methods].join('\n'), docs: symbol.docs }
        }
    }
}

function instantiate(type: TypeNode, generics: string[], args: TypeNode[], defaults: (TypeNode | undefined)[] = []): TypeNode {
    const map = new Map(generics.map((name, index) => [name, args[index] ?? defaults[index] ?? named(name)]))
    const replace = (node: TypeNode): TypeNode => {
        if (node.kind === 'NamedType' && map.has(node.name)) return map.get(node.name)!
        if (node.kind === 'GenericType') return { ...node, args: node.args.map(replace) }
        if (node.kind === 'UnionType' || node.kind === 'IntersectionType') return { ...node, types: node.types.map(replace) }
        if (node.kind === 'ArrayType') return { ...node, element: replace(node.element) }
        if (node.kind === 'IndexedAccessType') return { ...node, object: replace(node.object), index: replace(node.index) }
        if (node.kind === 'ConditionalType') return { ...node, check: replace(node.check), target: replace(node.target), consequent: replace(node.consequent), alternate: replace(node.alternate) }
        if (node.kind === 'FunctionType') return { ...node, params: node.params.map(replace), result: replace(node.result) }
        if (node.kind === 'ObjectType') return { ...node, members: node.members.map(member => ({ ...member, type: replace(member.type), indexType: member.indexType ? replace(member.indexType) : undefined, params: member.params?.map(param => ({ ...param, type: param.type ? replace(param.type) : undefined })) })) }
        return node
    }
    return replace(type)
}

function resolveType(type: TypeNode, env: Env): TypeNode {
    if (type.kind === 'NamedType') {
        const symbol = env.get(type.name)
        if (symbol?.kind === 'type') return resolveType(instantiate(symbol.value, symbol.generics, [], symbol.genericDefaults), env)
        return type
    }
    if (type.kind === 'GenericType') {
        const symbol = env.get(type.name)
        if (symbol?.kind === 'type') return resolveType(instantiate(symbol.value, symbol.generics, type.args, symbol.genericDefaults), env)
        if (['Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'KeyOf', 'Exclude'].includes(type.name) && type.args[0]) {
            if (type.name === 'KeyOf' && type.args[0].kind === 'NamedType' && env.get(type.args[0].name)?.kind === 'type' && (env.get(type.args[0].name) as Extract<SymbolInfo, { kind: 'type' }>).typeParameter) return type
            if (type.name === 'Exclude') {
                const source = resolveType(type.args[0], env)
                const excluded = type.args[1] ? resolveType(type.args[1], env) : named('never')
                const parts = source.kind === 'UnionType' ? source.types : [source]
                const remaining = parts.filter(part => !isAssignableTo(excluded, part, env))
                return remaining.length ? unionOf(remaining) : named('never')
            }
            const source = resolveType(type.args[0], env)
            if (type.name === 'KeyOf') {
                if (source.kind === 'ArrayType' || source.kind === 'GenericType' && (source.name === 'Array' || source.name === 'ReadonlyArray')) {
                    const names = ['length', 'indices', 'has', 'pick', 'omit', 'deepClone', 'deepFreeze', 'toDeepFreezed', ...Object.keys(arrayMethodDescriptions).filter(name => name !== 'from'), 'iterator', 'toArray', 'toString']
                    return unionOf([named('number'), ...[...new Set(names)].map(value => ({ kind: 'LiteralType', value } as TypeNode))])
                }
                if (source.kind === 'ObjectType') return unionOf(source.members.flatMap(member => member.indexType ? [member.indexType] : [{
                    kind: 'LiteralType',
                    value: member.name !== '' && Number.isFinite(Number(member.name)) && String(Number(member.name)) === member.name ? Number(member.name) : member.name
                } as TypeNode]).map(member => {
                    if (member.kind !== 'LiteralType') return member
                    return member
                }))
                return named('any')
            }
            if (source.kind === 'UnionType' || source.kind === 'IntersectionType') {
                return { ...source, types: source.types.map(part => resolveType({ ...type, args: [part, ...type.args.slice(1)] }, env)) }
            }
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
    if (type.kind === 'ArrayType') {
        const element = resolveType(type.element, env)
        return env.get('Array')?.kind === 'constructor' ? { kind: 'GenericType', name: 'Array', args: [element] } : { ...type, element }
    }
    if (type.kind === 'TypeOfType') {
        if (type.expression.kind === 'Index' && type.expression.index.kind === 'Identifier') {
            const index = env.get(type.expression.index.name)
            if (index?.kind === 'type') {
                const resolvedIndex = resolveType(index.value, env)
                if (resolvedIndex.kind !== 'LiteralType') return type
            }
        }
        return resolveType(inferExpression(type.expression, env), env)
    }
    if (type.kind === 'ConditionalType') {
        const check = resolveType(type.check, env)
        const target = resolveType(type.target, env)
        if (check.kind === 'UnionType') return unionOf(check.types.map(part => isAssignableTo(target, part, env) ? resolveType(type.consequent, env) : resolveType(type.alternate, env)))
        return resolveType(isAssignableTo(target, check, env) ? type.consequent : type.alternate, env)
    }
    if (type.kind === 'IndexedAccessType') return indexedAccessType(type.object, type.index, env) ?? named('any')
    if (type.kind === 'ObjectType') return { ...type, members: type.members.flatMap(member => {
        const indexType = member.indexType ? resolveType(member.indexType, env) : undefined
        const indexParts = indexType?.kind === 'UnionType' ? indexType.types : indexType ? [indexType] : []
        if (indexType && indexParts.length && indexParts.every(part => part.kind === 'LiteralType' && (typeof part.value === 'string' || typeof part.value === 'number'))) {
            return indexParts.map(part => {
                const memberEnv = new Map(env)
                memberEnv.set(member.name, { kind: 'type', generics: [], value: part })
                return {
                    ...member,
                    name: String((part as Extract<TypeNode, { kind: 'LiteralType' }>).value),
                    type: resolveType(member.type, memberEnv),
                    indexType: undefined,
                    params: member.params?.map(param => ({ ...param, type: param.type ? resolveType(param.type, memberEnv) : undefined }))
                }
            })
        }
        const memberEnv = indexType ? new Map(env) : env
        if (indexType) memberEnv.set(member.name, { kind: 'type', generics: [], value: indexType })
        return [{ ...member, type: resolveType(member.type, memberEnv), indexType, params: member.params?.map(param => ({ ...param, type: param.type ? resolveType(param.type, memberEnv) : undefined })) }]
    }) }
    if (type.kind === 'FunctionType') return { ...type, params: type.params.map(param => resolveType(param, env)), result: resolveType(type.result, env) }
    return type
}

type FunctionSymbol = { kind: 'fun'; generics?: string[]; genericConstraints?: (TypeNode | undefined)[]; genericDefaults?: (TypeNode | undefined)[]; params: Parameter[]; returnType: TypeNode; body?: Statement[]; ownerType?: TypeNode }

function isFunctionSymbol(value: TypeNode | FunctionSymbol | undefined): value is FunctionSymbol {
    return Boolean(value && typeof value === 'object' && 'kind' in value && value.kind === 'fun' && 'returnType' in value)
}

function indexKeyParts(type: TypeNode, env: Env): TypeNode[] {
    const resolved = resolveType(type, env)
    return resolved.kind === 'UnionType' ? resolved.types.flatMap(part => indexKeyParts(part, env)) : [resolved]
}

function tupleShape(elements: TypeNode[], readonly = true): TypeNode {
    const element = elements.length ? unionOf(elements) : named('never')
    return { kind: 'ObjectType', members: [
        ...elements.map((type, index): TypeMember => ({ name: String(index), type, optional: false, readonly, constant: false })),
        { name: 'index', indexType: named('number'), type: element, optional: false, readonly, constant: false },
        { name: 'length', type: { kind: 'LiteralType', value: elements.length }, optional: false, readonly: true, constant: false },
        { name: 'toArray', type: arrayOf(element), optional: false, readonly, constant: false, method: true, params: [] }
    ] }
}

function indexedAccessType(objectType: TypeNode, keyType: TypeNode, env: Env): TypeNode | undefined {
    let object = removeNull(resolveType(objectType, env))
    if (object.kind === 'GenericType' && object.name === 'Tuple' && object.args[0]?.kind !== 'ObjectType') object = tupleShape(object.args)
    if (object.kind === 'GenericType') {
        const constructor = env.get(object.name)
        if (constructor?.kind === 'constructor') object = removeNull(resolveType(instantiate(constructor.inheritedType, constructor.generics, object.args, constructor.genericDefaults), env))
    }
    const keys = indexKeyParts(keyType, env)
    const result: TypeNode[] = []
    const addMember = (owner: TypeNode, key: string): boolean => {
        const member = lookupMember(owner, key, env)
        if (!member) return false
        result.push(isFunctionSymbol(member) ? functionType(member.params, member.returnType) : member)
        return true
    }
    const collect = (owner: TypeNode): boolean => {
        if (owner.kind === 'UnionType') return owner.types.every(collect)
        if (owner.kind === 'IntersectionType') return owner.types.some(collect)
        const arrayLike = owner.kind === 'ArrayType' || owner.kind === 'GenericType' && (owner.name === 'Array' || owner.name === 'ReadonlyArray')
        const element = owner.kind === 'ArrayType' ? owner.element : owner.kind === 'GenericType' ? owner.args[0] ?? named('any') : undefined
        if (arrayLike) return keys.every(key => {
            if (isNamedType(key, 'number') || key.kind === 'LiteralType' && typeof key.value === 'number') {
                result.push(element ?? named('any'))
                return true
            }
            return key.kind === 'LiteralType' && typeof key.value === 'string' && addMember(owner, key.value)
        })
        if (owner.kind === 'ObjectType') return keys.every(key => {
            if (key.kind === 'LiteralType' && (typeof key.value === 'string' || typeof key.value === 'number')) {
                if (addMember(owner, String(key.value))) return true
                const signature = owner.members.find(member => member.indexType && isAssignableTo(member.indexType, key, env))
                if (signature) { result.push(signature.type); return true }
                return false
            }
            if (isNamedType(key, 'number')) {
                const signature = owner.members.find(member => member.indexType && isAssignableTo(member.indexType, key, env))
                if (signature) { result.push(signature.type); return true }
                const numeric = owner.members.filter(member => member.name !== '' && Number.isFinite(Number(member.name)) && String(Number(member.name)) === member.name)
                if (!numeric.length) return false
                result.push(...numeric.map(member => member.type))
                return true
            }
            const signature = owner.members.find(member => member.indexType && isAssignableTo(member.indexType, key, env))
            if (signature) { result.push(signature.type); return true }
            return false
        })
        return false
    }
    return collect(object) && result.length ? unionOf(result) : undefined
}

function arrayDestructureRestType(sourceType: TypeNode, start: number, env: Env): TypeNode {
    if (sourceType.kind === 'GenericType' && sourceType.name === 'Tuple' && sourceType.args[0]?.kind !== 'ObjectType') {
        return tupleShape(sourceType.args.slice(start), false)
    }
    if (sourceType.kind === 'GenericType' && sourceType.name === 'Tuple' && sourceType.args[0]?.kind === 'ObjectType') {
        const tuple = sourceType.args[0]
        const entries = tuple.members
            .filter(member => member.name !== '' && Number.isInteger(Number(member.name)) && Number(member.name) >= start)
            .sort((left, right) => Number(left.name) - Number(right.name))
        const element = entries.length ? unionOf(entries.map(member => member.type)) : named('never')
        return { kind: 'ObjectType', members: [
            ...entries.map((member, index): TypeMember => ({ ...member, name: String(index), readonly: false })),
            { name: 'index', indexType: named('number'), type: element, optional: false, readonly: false, constant: false },
            { name: 'length', type: { kind: 'LiteralType', value: entries.length }, optional: false, readonly: true, constant: false },
            { name: 'toArray', type: arrayOf(element), optional: false, readonly: false, constant: false, method: true, params: [] }
        ] }
    }
    const element = iterableElementType(sourceType, env)
    return arrayOf(element)
}

function callableType(type: TypeNode, env: Env): Extract<TypeNode, { kind: 'FunctionType' }> | undefined {
    const resolved = resolveType(type, env)
    if (resolved.kind === 'FunctionType') return resolved
    if (resolved.kind === 'ObjectType') {
        const call = resolved.members.find(member => member.name === '' && member.method)
        if (call) return { kind: 'FunctionType', params: (call.params ?? []).map(parameterType), result: call.type }
    }
    if (resolved.kind === 'IntersectionType') {
        for (const part of resolved.types) {
            const call = callableType(part, env)
            if (call) return call
        }
    }
    return undefined
}

function deepReadonlyType(type: TypeNode, env: Env): TypeNode {
    const resolved = resolveType(type, env)
    if (resolved.kind === 'ArrayType') return { kind: 'GenericType', name: 'ReadonlyArray', args: [deepReadonlyType(resolved.element, env)] }
    if (resolved.kind === 'GenericType' && (resolved.name === 'Array' || resolved.name === 'ReadonlyArray')) {
        return { kind: 'GenericType', name: 'ReadonlyArray', args: [deepReadonlyType(resolved.args[0] ?? named('any'), env)] }
    }
    if (resolved.kind === 'ObjectType') return {
        ...resolved,
        members: resolved.members.map(member => member.method
            ? member
            : { ...member, readonly: true, type: deepReadonlyType(member.type, env) })
    }
    if (resolved.kind === 'UnionType' || resolved.kind === 'IntersectionType') {
        return { ...resolved, types: resolved.types.map(part => deepReadonlyType(part, env)) }
    }
    return resolved
}

function lookupMember(type: TypeNode, name: string, env: Env): TypeNode | FunctionSymbol | undefined {
    if (type.kind === 'GenericType' && type.name === 'Tuple' && type.args[0]?.kind !== 'ObjectType') return lookupMember(tupleShape(type.args), name, env)
    if (type.kind === 'NamedType' && type.name === 'Error') {
        if (name === 'type' || name === 'message') return named('string')
        if (name === 'stackTrace') return unionOf([arrayOf(named('string')), named('null')])
    }
    if (name === 'asReadonly' || name === 'asMutable') {
        const rawElement = type.kind === 'ArrayType'
            ? type.element
            : type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray')
                ? type.args[0] ?? named('any')
                : undefined
        if (rawElement) return {
            kind: 'fun', params: [],
            returnType: { kind: 'GenericType', name: name === 'asReadonly' ? 'ReadonlyArray' : 'Array', args: [rawElement] },
            ownerType: type
        }
    }
    if (type.kind === 'NamedType') {
        const constructor = env.get(type.name)
        if (constructor?.kind === 'constructor') {
            for (const overload of constructor.overloads) {
                if (overload.returnType.kind === 'NamedType' && overload.returnType.name === type.name) continue
                const member = lookupMember(overload.returnType, name, env)
                if (member) return member
            }
            return lookupMember(constructor.inheritedType, name, env)
        }
    }
    if (type.kind === 'GenericType') {
        const constructor = env.get(type.name)
        if (constructor?.kind === 'constructor') {
            for (const overload of constructor.overloads) {
                const result = instantiate(overload.returnType, constructor.generics, type.args)
                if (result.kind === 'GenericType' && result.name === type.name) continue
                const member = lookupMember(result, name, env)
                if (member) return member
            }
            const inherited = instantiate(constructor.inheritedType, constructor.generics, type.args)
            if (!(inherited.kind === 'GenericType' && inherited.name === type.name)) {
                const member = lookupMember(inherited, name, env)
                if (member) return member
            }
        }
    }
    const resolved = resolveType(type, env)
    if (resolved.kind === 'GenericType' && resolved.name === 'ReadonlyArray' && ['copyWithin', 'fill', 'pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'].includes(name)) return undefined
    if (name === 'isType') return { kind: 'fun', params: [], returnType: named('boolean') }
    if (name === 'deepClone' && (resolved.kind === 'ObjectType' || resolved.kind === 'ArrayType' || resolved.kind === 'GenericType' && (resolved.name === 'Array' || resolved.name === 'ReadonlyArray'))) {
        return { kind: 'fun', params: [], returnType: resolved, ownerType: resolved }
    }
    if ((name === 'deepFreeze' || name === 'toDeepFreezed') && (resolved.kind === 'ObjectType' || resolved.kind === 'ArrayType' || resolved.kind === 'GenericType' && (resolved.name === 'Array' || resolved.name === 'ReadonlyArray'))) {
        return { kind: 'fun', params: [], returnType: deepReadonlyType(resolved, env), ownerType: resolved }
    }
    if (name === 'asReadonly' || name === 'asMutable') {
        let result: TypeNode = resolved
        if (resolved.kind === 'ArrayType') result = name === 'asReadonly' ? { kind: 'GenericType', name: 'ReadonlyArray', args: [resolved.element] } : resolved
        else if (resolved.kind === 'GenericType' && (resolved.name === 'Array' || resolved.name === 'ReadonlyArray')) {
            result = { kind: 'GenericType', name: name === 'asReadonly' ? 'ReadonlyArray' : 'Array', args: resolved.args }
        } else if (resolved.kind === 'ObjectType') {
            result = { ...resolved, members: resolved.members.map(member => ({ ...member, readonly: name === 'asReadonly' })) }
        }
        return { kind: 'fun', params: [], returnType: result, ownerType: resolved }
    }
    if ((name === 'pick' || name === 'omit')
        && !(resolved.kind === 'ObjectType' && resolved.members.some(member => member.name === name))
        && (resolved.kind === 'ObjectType' || resolved.kind === 'ArrayType' || resolved.kind === 'GenericType' && (resolved.name === 'Array' || resolved.name === 'ReadonlyArray'))) {
        const keys = resolveType({ kind: 'GenericType', name: 'KeyOf', args: [resolved] }, env)
        const selectedKeys: TypeNode = name === 'pick'
            ? named('T')
            : { kind: 'GenericType', name: 'Exclude', args: [{ kind: 'GenericType', name: 'KeyOf', args: [resolved] }, named('T')] }
        const result: TypeNode = {
            kind: 'ObjectType',
            members: [{
                name: 'key', indexType: selectedKeys,
                type: { kind: 'IndexedAccessType', object: resolved, index: named('key') },
                optional: false, readonly: false, constant: false
            }]
        }
        return {
            kind: 'fun', generics: ['T'], genericConstraints: [keys],
            params: [{ name: 'keys', type: arrayOf(named('T')), rest: true }],
            returnType: result, ownerType: resolved
        }
    }
    if (isNamedType(resolved, 'string')) {
        const fn = (params: Parameter[], returnType: TypeNode): FunctionSymbol => ({ kind: 'fun', params, returnType })
        const p = (paramName: string, paramType: TypeNode, optional = false): Parameter => ({ name: paramName, type: paramType, ...(optional ? { defaultValue: { kind: 'Literal', value: null } as Expression } : {}) })
        const string = named('string'), number = named('number'), boolean = named('boolean')
        const matcher = unionOf([string, named('RegEx')])
        switch (name) {
            case 'length': return number
            case 'indices': return named('Range')
            case 'at':
            case 'charAt': return fn([p('index', number)], string)
            case 'charCodeAt':
            case 'codePointAt': return fn([p('index', number)], number)
            case 'concat': return fn([{ name: 'strings', type: arrayOf(string), rest: true }], string)
            case 'endsWith':
            case 'startsWith': return fn([p('search', string), p('position', number, true)], boolean)
            case 'includes': return fn([p('search', matcher), p('position', number, true)], boolean)
            case 'test': return fn([p('pattern', matcher)], boolean)
            case 'exec': return fn([p('pattern', matcher)], unionOf([arrayOf(string), named('null')]))
            case 'find':
            case 'findLast': return fn([p('search', matcher)], unionOf([string, named('null')]))
            case 'findIndex':
            case 'findLastIndex': return fn([p('search', matcher)], number)
            case 'join': return fn([p('separator', string, true)], string)
            case 'indexOf':
            case 'lastIndexOf': return fn([p('search', string), p('position', number, true)], number)
            case 'localeCompare': return fn([p('other', string)], number)
            case 'match':
            case 'matchAll': return fn([p('regexp', matcher)], unionOf([arrayOf(string), named('null')]))
            case 'normalize': return fn([p('form', string, true)], string)
            case 'padEnd':
            case 'padStart': return fn([p('length', number), p('fill', string, true)], string)
            case 'repeat': return fn([p('count', number)], string)
            case 'replace':
            case 'replaceAll': return fn([p('search', matcher), p('replacement', string)], string)
            case 'search': return fn([p('regexp', matcher)], number)
            case 'slice':
            case 'substring':
            case 'substr': return fn([p('start', number, true), p('end', number, true)], string)
            case 'split': return fn([p('separator', matcher, true), p('limit', number, true)], arrayOf(string))
            case 'toLocaleLowerCase':
            case 'toLocaleUpperCase':
            case 'toLowerCase':
            case 'toUpperCase':
            case 'toString':
            case 'trim':
            case 'trimEnd':
            case 'trimStart':
            case 'valueOf': return fn([], string)
            case 'toArray': return fn([], arrayOf(string))
            case 'iterator': return fn([], { kind: 'FunctionType', params: [], result: unionOf([{ kind: 'ObjectType', members: [field('value', string)] }, named('null')]) })
        }
    }
    if (isNamedType(resolved, 'number') && name === 'valueOf') {
        return { kind: 'fun', params: [], returnType: named('number') }
    }
    if (isNamedType(resolved, 'RegEx')) {
        const fn = (params: Parameter[], returnType: TypeNode): FunctionSymbol => ({ kind: 'fun', params, returnType })
        const string = named('string'), boolean = named('boolean'), number = named('number'), any = named('any')
        const input = unionOf([string, named('RegEx')])
        switch (name) {
            case 'source':
            case 'flags': return string
            case 'global':
            case 'ignoreCase':
            case 'multiline':
            case 'dotAll':
            case 'sticky':
            case 'unicode':
            case 'hasIndices':
            case 'unicodeSets': return boolean
            case 'lastIndex': return number
            case 'test': return fn([{ name: 'value', type: input }], boolean)
            case 'exec': return fn([{ name: 'value', type: input }], unionOf([arrayOf(string), named('null')]))
            case 'compile': return fn([{ name: 'pattern', type: input }, { name: 'flags', type: string, defaultValue: { kind: 'Literal', value: '' } }], named('RegEx'))
        }
    }
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
            if (member.method) return { kind: 'fun', generics: member.generics, genericConstraints: member.genericConstraints, genericDefaults: member.genericDefaults, params: member.params ?? [], returnType: member.type, body: member.body, ownerType: resolved }
            return member.type
        }
        const call = resolved.members.find(item => item.name === '' && item.method)
        if (call) {
            const params = call.params ?? []
            const signature: TypeNode = { kind: 'FunctionType', params: params.map(parameterType), result: call.type }
            if (name === 'call') return { kind: 'fun', params: [{ name: 'thisArg', type: named('any') }, ...params], returnType: call.type }
            if (name === 'apply') return { kind: 'fun', params: [{ name: 'thisArg', type: named('any') }, { name: 'args', type: arrayOf(named('any')) }], returnType: call.type }
            if (name === 'bind') return { kind: 'fun', params: [{ name: 'thisArg', type: named('any') }, { name: 'args', type: arrayOf(named('any')), rest: true }], returnType: signature }
        }
        if (name === 'has') return { kind: 'fun', params: [{ name: 'key', type: named('string') }], returnType: named('boolean') }
    }
    if (resolved.kind === 'FunctionType' && name === 'call') {
        return { kind: 'fun', params: [{ name: 'thisArg', type: named('any') }, { name: 'args', type: arrayOf(named('any')), rest: true }], returnType: resolved.result }
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
            case 'indices': return named('Range')
            case 'copy':
            case 'toArray': return fn([], arrayOf(element))
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

function lookupAccessor(type: TypeNode, name: string, accessor: 'get' | 'set', env: Env): TypeMember | undefined {
    const resolved = resolveType(type, env)
    if (resolved.kind === 'ObjectType') return resolved.members.find(member => !member.indexType && member.name === name && member.accessor === accessor)
    if (resolved.kind === 'IntersectionType' || resolved.kind === 'UnionType') {
        for (const part of resolved.types) {
            const member = lookupAccessor(part, name, accessor, env)
            if (member) return member
        }
    }
    return undefined
}

const arrayMethodDescriptions: Record<string, string> = {
    at: 'Возвращает элемент по индексу. Отрицательный индекс отсчитывается от конца массива.',
    concat: 'Создаёт новый массив, объединяя текущий массив с переданными элементами.',
    copy: 'Создаёт независимую поверхностную копию массива.',
    copyWithin: 'Копирует часть массива в другую позицию внутри этого же массива.',
    entries: 'Возвращает пары индекса и значения массива.',
    enumerate: 'Возвращает пары `[index, value]` для всех элементов массива.',
    every: 'Проверяет, удовлетворяют ли все элементы условию callback.',
    fill: 'Заполняет выбранный диапазон массива указанным значением.',
    filter: 'Создаёт массив элементов, для которых callback вернул true.',
    find: 'Возвращает первый элемент, удовлетворяющий условию, или null.',
    findIndex: 'Возвращает индекс первого подходящего элемента или -1.',
    findLast: 'Возвращает последний элемент, удовлетворяющий условию, или null.',
    findLastIndex: 'Возвращает индекс последнего подходящего элемента или -1.',
    flat: 'Создаёт массив с уменьшенной на один уровень вложенностью.',
    flatMap: 'Применяет callback и объединяет полученные массивы на один уровень.',
    forEach: 'Вызывает callback для каждого элемента массива.',
    from: 'Создаёт новый Array из элементов источника и при необходимости преобразует их callback-функцией.',
    includes: 'Проверяет наличие значения в массиве.',
    indexOf: 'Возвращает первый индекс значения или -1.',
    join: 'Объединяет элементы массива в строку через разделитель.',
    lastIndexOf: 'Возвращает последний индекс значения или -1.',
    map: 'Создаёт массив результатов вызова callback для каждого элемента.',
    pop: 'Удаляет и возвращает последний элемент или null для пустого массива.',
    push: 'Добавляет элементы в конец массива и возвращает новую длину.',
    reduce: 'Сворачивает массив слева направо в одно значение.',
    reduceRight: 'Сворачивает массив справа налево в одно значение.',
    reverse: 'Разворачивает массив на месте и возвращает его.',
    shift: 'Удаляет и возвращает первый элемент или null для пустого массива.',
    slice: 'Создаёт копию выбранного диапазона массива.',
    some: 'Проверяет, удовлетворяет ли хотя бы один элемент условию callback.',
    sort: 'Сортирует массив на месте. Callback получает два элемента типа массива.',
    splice: 'Удаляет и добавляет элементы на месте, возвращая удалённые элементы.',
    toArray: 'Возвращает обычную копию элементов массива.',
    toReversed: 'Создаёт новый массив с обратным порядком элементов.',
    toSorted: 'Создаёт новый отсортированный массив.',
    toSpliced: 'Создаёт новый массив с применённой операцией splice.',
    unshift: 'Добавляет элементы в начало массива и возвращает новую длину.',
    with: 'Создаёт копию массива с заменённым элементом по индексу.'
}

function arrayMethodDescription(type: TypeNode, name: string, env: Env): string | undefined {
    const resolved = resolveType(type, env)
    const arrayLike = resolved.kind === 'ArrayType'
        || resolved.kind === 'GenericType' && (resolved.name === 'Array' || resolved.name === 'ReadonlyArray')
    return arrayLike ? arrayMethodDescriptions[name] : undefined
}

function narrowHasProperty(type: TypeNode, name: string, env: Env): TypeNode {
    const resolved = resolveType(type, env)
    if (isNamedType(resolved, 'any')) {
        return { kind: 'ObjectType', members: [field(name, named('any'))] }
    }
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
    if (target.kind === 'ArrayType' && value.kind === 'GenericType' && value.name === 'Tuple') return value.args.every(element => isAssignableTo(target.element, element, env))
    if (target.kind === 'ArrayType' && value.kind === 'ObjectType') {
        const numeric = value.members.filter(member => member.indexType && isAssignableTo(member.indexType, named('number'), env)
            || member.name !== '' && Number.isFinite(Number(member.name)) && String(Number(member.name)) === member.name)
        return numeric.length > 0 && numeric.every(member => isAssignableTo(target.element, member.type, env))
    }
    if (target.kind === 'FunctionType') {
        const callable = callableType(value, env)
        return Boolean(callable
            && target.params.length === callable.params.length
            && target.params.every((item, index) => isAssignableTo(item, callable.params[index], env))
            && isAssignableTo(target.result, callable.result, env))
    }
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
    return true
}

type ImportedSymbol = { kind: 'type'; value: TypeNode; generics: string[]; genericConstraints?: (TypeNode | undefined)[]; genericDefaults?: (TypeNode | undefined)[] } | { kind: 'fun'; generics?: string[]; genericConstraints?: (TypeNode | undefined)[]; genericDefaults?: (TypeNode | undefined)[]; params: Parameter[]; returnType: TypeNode } | { kind: 'constructor'; generics: string[]; genericConstraints?: (TypeNode | undefined)[]; genericDefaults?: (TypeNode | undefined)[]; inheritedType: TypeNode; overloads: { params: Parameter[]; returnType: TypeNode }[]; methods: { name: string; generics: string[]; genericConstraints?: (TypeNode | undefined)[]; genericDefaults?: (TypeNode | undefined)[]; params: Parameter[]; returnType: TypeNode }[] } | { kind: 'var'; type: TypeNode }

function hostType(source: string | undefined): TypeNode {
    if (!source) return named('any')
    try {
        const declaration = parse(`type __HostType = ${source.trim()}`, { validate: false })[0]
        if (declaration.kind !== 'TypeDeclaration') return named('any')
        const adapt = (type: TypeNode): TypeNode => {
            if (type.kind === 'GenericType' && type.name === 'Iterable') {
                const element = adapt(type.args[0] ?? named('any'))
                return { kind: 'ObjectType', members: [method('iterator', [], {
                    kind: 'FunctionType', params: [], result: unionOf([
                        { kind: 'ObjectType', members: [field('value', element)] },
                        named('null')
                    ])
                })] }
            }
            if (type.kind === 'GenericType') return { ...type, args: type.args.map(adapt) }
            if (type.kind === 'ArrayType') return { ...type, element: adapt(type.element) }
            if (type.kind === 'UnionType' || type.kind === 'IntersectionType') return { ...type, types: type.types.map(adapt) }
            if (type.kind === 'FunctionType') return { ...type, params: type.params.map(adapt), result: adapt(type.result) }
            if (type.kind === 'ObjectType') return { ...type, members: type.members.map(member => ({ ...member, type: adapt(member.type) })) }
            return type
        }
        return adapt(declaration.value)
    } catch { return named('any') }
}

function hostDeclarations(source: string): Map<string, ImportedSymbol> {
    const result = new Map<string, ImportedSymbol>()
    const localTypes = new Map<string, TypeNode>()
    const numberStatic = (name: string): TypeMember | undefined => {
        const number = named('number'), boolean = named('boolean'), string = named('string')
        if (['EPSILON', 'MAX_SAFE_INTEGER', 'MAX_VALUE', 'MIN_SAFE_INTEGER', 'MIN_VALUE', 'NEGATIVE_INFINITY', 'POSITIVE_INFINITY', 'NaN'].includes(name)) return field(name, number, true)
        if (['isFinite', 'isInteger', 'isNaN', 'isSafeInteger'].includes(name)) return method(name, [{ name: 'value', type: number }], boolean)
        if (name === 'parseFloat') return method(name, [{ name: 'value', type: string }], number)
        if (name === 'parseInt') return method(name, [{ name: 'value', type: string }, { name: 'radix', type: number, defaultValue: { kind: 'Literal', value: null } }], number)
        return undefined
    }
    const splitTopLevel = (value: string): string[] => {
        const parts: string[] = []
        let start = 0, depth = 0, quote = ''
        for (let index = 0; index < value.length; index++) {
            const character = value[index]
            if (quote) {
                if (character === '\\') index++
                else if (character === quote) quote = ''
                continue
            }
            if (character === "'" || character === '"' || character === '`') { quote = character; continue }
            if ('{[('.includes(character)) depth++
            else if ('}])'.includes(character)) depth--
            else if (character === ',' && depth === 0) { parts.push(value.slice(start, index).trim()); start = index + 1 }
        }
        parts.push(value.slice(start).trim())
        return parts.filter(Boolean)
    }
    const inferHostValue = (raw: string): TypeNode => {
        const value = raw.trim().replace(/;$/, '').trim()
        const assertion = /^(.*?)\s+as\s+([\s\S]+)$/.exec(value)
        if (assertion) return hostType(assertion[2])
        if (/^['"`]/.test(value)) return named('string')
        if (/^(?:true|false)$/.test(value)) return named('boolean')
        if (/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(value)) return named('number')
        if (/^[-+]?\d+n$/.test(value)) return named('BigInt')
        if (value === 'null') return named('null')
        if (value.startsWith('[') && value.endsWith(']')) {
            const elements = splitTopLevel(value.slice(1, -1)).map(inferHostValue)
            return arrayOf(elements.length ? unionOf(elements) : named('any'))
        }
        if (value.startsWith('{') && value.endsWith('}')) {
            const members = splitTopLevel(value.slice(1, -1)).flatMap((property): TypeMember[] => {
                const separator = (() => {
                    let depth = 0, quote = ''
                    for (let index = 0; index < property.length; index++) {
                        const character = property[index]
                        if (quote) { if (character === '\\') index++; else if (character === quote) quote = ''; continue }
                        if (character === "'" || character === '"' || character === '`') { quote = character; continue }
                        if ('{[('.includes(character)) depth++
                        else if ('}])'.includes(character)) depth--
                        else if (character === ':' && depth === 0) return index
                    }
                    return -1
                })()
                if (separator < 0) {
                    const name = property.trim()
                    const type = localTypes.get(name)
                    return /^[A-Za-z_$][\w$]*$/.test(name) ? [field(name, type ?? named('any'))] : []
                }
                const rawName = property.slice(0, separator).trim()
                const name = rawName.replace(/^['"]|['"]$/g, '')
                return [field(name, inferHostValue(property.slice(separator + 1)))]
            })
            return { kind: 'ObjectType', members }
        }
        return localTypes.get(value) ?? named('any')
    }
    for (const match of source.matchAll(/\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?:\:\s*([^=\n]+))?\s*=\s*/g)) {
        const start = match.index! + match[0].length
        let end = start, depth = 0, quote = ''
        for (; end < source.length; end++) {
            const character = source[end]
            if (quote) { if (character === '\\') end++; else if (character === quote) quote = ''; continue }
            if (character === "'" || character === '"' || character === '`') { quote = character; continue }
            if ('{[('.includes(character)) depth++
            else if ('}])'.includes(character)) depth--
            else if ((character === ';' || character === '\n' || character === '\r') && depth === 0) break
        }
        localTypes.set(match[1], match[2] ? hostType(match[2]) : inferHostValue(source.slice(start, end)))
    }
    const functions = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<([^>]+)>)?\s*\(([^)]*)\)\s*(?::\s*([^\n{]+))?/g
    for (const match of source.matchAll(functions)) {
        const params = match[3].trim() ? match[3].split(',').map((raw, index): Parameter => {
            const part = raw.trim(), rest = part.startsWith('...')
            const clean = rest ? part.slice(3) : part
            const separator = clean.indexOf(':')
            const rawName = (separator < 0 ? clean : clean.slice(0, separator)).trim()
            const optional = rawName.endsWith('?')
            const name = rawName.replace(/\?$/, '') || `arg${index}`
            const type = hostType(separator < 0 ? undefined : clean.slice(separator + 1))
            return { name, type, rest, ...(optional ? { defaultValue: { kind: 'Literal', value: null } as Expression } : {}) }
        }) : []
        const generics = match[2]?.split(',').map(item => item.trim().split(/\s+(?:extends|is)\s+|\s*=/)[0]) ?? []
        result.set(match[1], { kind: 'fun', generics, params, returnType: hostType(match[4]) })
    }
    const arrowFunctions = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:<([^>]+)>\s*)?\(([^)]*)\)\s*(?::\s*([^=\n]+?))?\s*=>\s*([^\n;]+)/g
    for (const match of source.matchAll(arrowFunctions)) {
        const params = match[3].trim() ? match[3].split(',').map((raw, index): Parameter => {
            const part = raw.trim(), rest = part.startsWith('...')
            const clean = rest ? part.slice(3) : part
            const separator = clean.indexOf(':')
            const rawName = (separator < 0 ? clean : clean.slice(0, separator)).trim()
            const optional = rawName.endsWith('?')
            const name = rawName.replace(/\?$/, '') || `arg${index}`
            const type = hostType(separator < 0 ? undefined : clean.slice(separator + 1))
            return { name, type, rest, ...(optional ? { defaultValue: { kind: 'Literal', value: null } as Expression } : {}) }
        }) : []
        const body = match[5].trim()
        const inferredReturnType = /^(?:globalThis\.)?Math\.(?:random|abs|ceil|floor|round|trunc|min|max|pow|sqrt|cbrt|hypot|exp|log|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|fround|imul|clz32)\s*\(/.test(body)
            || /^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(body)
            ? named('number')
            : /^(?:true|false)$/.test(body)
                ? named('boolean')
                : /^(?:["'`])/.test(body)
                    ? named('string')
                    : named('any')
        const generics = match[2]?.split(',').map(item => item.trim().split(/\s+(?:extends|is)\s+|\s*=/)[0]) ?? []
        result.set(match[1], { kind: 'fun', generics, params, returnType: match[4] ? hostType(match[4]) : inferredReturnType })
    }
    for (const match of source.matchAll(/export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) {
        if (!result.has(match[1])) result.set(match[1], { kind: 'var', type: localTypes.get(match[1]) ?? named('any') })
    }
    for (const match of source.matchAll(/const\s*\{([^}]+)\}\s*=\s*globalThis\.Number/g)) {
        for (const item of match[1].split(',')) {
            const [sourceName, localName = sourceName] = item.trim().split(/\s*:\s*/)
            const member = numberStatic(sourceName)
            if (!member) continue
            localTypes.set(localName, member.method ? { kind: 'FunctionType', params: (member.params ?? []).map(parameterType), result: member.type } : member.type)
        }
    }
    const assigned = /const\s+([A-Za-z_$][\w$]*)\s*=\s*Object\.assign\s*\(\s*\(([^)]*)\)\s*:\s*([^=\n]+)=>[\s\S]*?,\s*\{([\s\S]*?)\}\s*\)/g
    for (const match of source.matchAll(assigned)) {
        const callParams = match[2].trim() ? match[2].split(',').map((raw, index): Parameter => {
            const separator = raw.indexOf(':')
            const rawName = (separator < 0 ? raw : raw.slice(0, separator)).trim()
            const optional = rawName.includes('?')
            return { name: rawName.replace(/\?/g, '') || `arg${index}`, type: hostType(separator < 0 ? undefined : raw.slice(separator + 1)), ...(optional ? { defaultValue: { kind: 'Literal', value: null } as Expression } : {}) }
        }) : []
        const members: TypeMember[] = [{ name: '', optional: false, readonly: false, constant: false, method: true, params: callParams, type: hostType(match[3]) }]
        for (const item of match[4].split(',')) {
            const name = item.trim().match(/^([A-Za-z_$][\w$]*)/)?.[1]
            if (!name) continue
            const type = localTypes.get(name)
            if (type?.kind === 'FunctionType') members.push(method(name, type.params.map((param, index) => ({ name: index === 0 ? 'value' : `arg${index}`, type: param })), type.result))
            else if (type) members.push(field(name, type, true))
        }
        localTypes.set(match[1], { kind: 'ObjectType', members })
    }
    for (const match of source.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;?/g)) {
        const type = localTypes.get(match[2])
        if (type) result.set(match[1], { kind: 'var', type })
    }
    for (const match of source.matchAll(/export\s+(?:const|let|var)\s*\{([^}]+)\}\s*=\s*([^\n;]+)/g)) {
        const sourceExpression = match[2].trim()
        const sourceType = localTypes.get(sourceExpression)
        for (const item of match[1].split(',')) {
            const [sourceName, exportedName = sourceName] = item.trim().split(/\s*:\s*/)
            if (!sourceName) continue
            if (sourceExpression === 'globalThis.String' && ['fromCharCode', 'fromCodePoint'].includes(sourceName)) {
                const parameterName = sourceName === 'fromCharCode' ? 'codes' : 'codePoints'
                result.set(exportedName, {
                    kind: 'fun',
                    params: [{ name: parameterName, type: arrayOf(named('number')), rest: true }],
                    returnType: named('string')
                })
            } else if (sourceType?.kind === 'ObjectType') {
                result.set(exportedName, { kind: 'var', type: sourceType.members.find(member => member.name === sourceName)?.type ?? named('any') })
            } else result.set(exportedName, { kind: 'var', type: named('any') })
        }
    }
    for (const match of source.matchAll(/(?:exports\.([A-Za-z_$][\w$]*)|module\.exports\.([A-Za-z_$][\w$]*))\s*=/g)) {
        const name = match[1] ?? match[2]
        if (!result.has(name)) result.set(name, { kind: 'var', type: named('any') })
    }
    return result
}

function importedDeclarations(statements: Statement[], filePath?: string, seen = new Set<string>()): Map<string, ImportedSymbol> {
    const result = new Map<string, ImportedSymbol>()
    const fs = require('node:fs') as typeof import('node:fs')
    const path = require('node:path') as typeof import('node:path')
    const declarationEnv = globals()
    for (const statement of statements) {
        const declaration = statement.kind === 'Export' ? statement.declaration : statement
        if (declaration.kind === 'TypeDeclaration') declarationEnv.set(declaration.name, { kind: 'type', generics: declaration.generics, value: declaration.value })
    }
    const expandLocalAliases = (type: TypeNode, resolving = new Set<string>()): TypeNode => {
        if (type.kind === 'NamedType') {
            const symbol = declarationEnv.get(type.name)
            if (symbol?.kind === 'type' && symbol.generics.length === 0 && !resolving.has(type.name)) {
                return expandLocalAliases(symbol.value, new Set([...resolving, type.name]))
            }
            return type
        }
        if (type.kind === 'GenericType') {
            const symbol = declarationEnv.get(type.name)
            if (symbol?.kind === 'type' && !resolving.has(type.name)) {
                return expandLocalAliases(instantiate(symbol.value, symbol.generics, type.args, symbol.genericDefaults), new Set([...resolving, type.name]))
            }
            return { ...type, args: type.args.map(argument => expandLocalAliases(argument, resolving)) }
        }
        if (type.kind === 'UnionType' || type.kind === 'IntersectionType') return { ...type, types: type.types.map(part => expandLocalAliases(part, resolving)) }
        if (type.kind === 'ArrayType') return { ...type, element: expandLocalAliases(type.element, resolving) }
        if (type.kind === 'IndexedAccessType') return { ...type, object: expandLocalAliases(type.object, resolving), index: expandLocalAliases(type.index, resolving) }
        if (type.kind === 'FunctionType') return { ...type, params: type.params.map(param => expandLocalAliases(param, resolving)), result: expandLocalAliases(type.result, resolving) }
        if (type.kind === 'ObjectType') return { ...type, members: type.members.map(member => ({
            ...member,
            type: expandLocalAliases(member.type, resolving),
            indexType: member.indexType ? expandLocalAliases(member.indexType, resolving) : undefined,
            params: member.params?.map(param => ({ ...param, type: param.type ? expandLocalAliases(param.type, resolving) : undefined }))
        })) }
        return type
    }
    for (const statement of statements) {
        const declaration = statement.kind === 'Export' ? statement.declaration : statement
        const exported = statement.kind === 'Export'
        if (declaration.kind === 'TypeDeclaration' && exported) result.set(declaration.name, { kind: 'type', value: declaration.value, generics: declaration.generics, genericConstraints: declaration.genericConstraints, genericDefaults: declaration.genericDefaults })
        else if (declaration.kind === 'FunctionDeclaration' && exported) result.set(declaration.name, {
            kind: 'fun', generics: declaration.generics, genericConstraints: declaration.genericConstraints,
            genericDefaults: declaration.genericDefaults, params: declaration.params,
            returnType: declaration.returnType ?? inferFunctionReturnType(declaration.body, globals(), declaration.params)
        })
        else if (declaration.kind === 'ConstructorDeclaration' && exported) result.set(declaration.name, {
            kind: 'constructor',
            generics: declaration.generics,
            genericConstraints: declaration.genericConstraints,
            genericDefaults: declaration.genericDefaults,
            inheritedType: expandLocalAliases(declaration.inheritedType),
            overloads: declaration.overloads.map(overload => ({
                params: overload.params.map(param => ({ ...param, type: param.type ? expandLocalAliases(param.type) : undefined })),
                returnType: expandLocalAliases(overload.returnType ?? inferFunctionReturnType(overload.body, declarationEnv, overload.params))
            })),
            methods: declaration.methods.map(method => ({
                name: method.name, generics: method.generics ?? [], genericConstraints: method.genericConstraints,
                genericDefaults: method.genericDefaults,
                params: method.params.map(param => ({ ...param, type: param.type ? expandLocalAliases(param.type) : undefined })),
                returnType: expandLocalAliases(method.returnType ?? inferFunctionReturnType(method.body, declarationEnv, method.params))
            }))
        })
        else if (declaration.kind === 'Variable' && exported) result.set(declaration.name, { kind: 'var', type: declaration.type ? resolveType(declaration.type, declarationEnv) : declaration.initializer ? inferExpression(declaration.initializer, declarationEnv) : named('any') })
        else if (declaration.kind === 'Destructure' && exported) {
            const source = inferExpression(declaration.initializer, globals())
            for (const binding of declaration.bindings) {
                const member = lookupMember(source, binding.name, globals())
                result.set(binding.name, { kind: 'var', type: member && !isFunctionSymbol(member) ? member : named('any') })
            }
        }
    }
    if (!filePath) return result
    for (const statement of statements) {
        const importedStatement = statement.kind === 'Import' ? statement : statement.kind === 'Export' && statement.declaration.kind === 'Import' ? statement.declaration : undefined
        if (!importedStatement || (!importedStatement.module.startsWith('.') && importedStatement.module !== 'juno:types' && !importedStatement.module.startsWith('juno:types/'))) continue
        let base: string
        if (importedStatement.module === 'juno:types' || importedStatement.module.startsWith('juno:types/')) {
            const relativeModule = importedStatement.module === 'juno:types' ? 'index' : importedStatement.module.slice('juno:types/'.length)
            let directory = path.dirname(path.resolve(filePath))
            let found: string | undefined
            while (true) {
                const candidate = path.join(directory, 'types', relativeModule)
                if (fs.existsSync(`${candidate}.jn`) || fs.existsSync(path.resolve(candidate, 'index.jn'))) { found = candidate; break }
                const parent = path.dirname(directory)
                if (parent === directory) break
                directory = parent
            }
            base = found ?? path.resolve(__dirname, '../../types', relativeModule)
        } else base = path.resolve(path.dirname(filePath), importedStatement.module)
        const candidates = /\.(?:jn|[cm]?[jt]s)$/i.test(base) ? [base] : [
            `${base}.jn`, `${base}.js`, `${base}.ts`,
            path.resolve(base, 'index.jn'), path.resolve(base, 'index.js'), path.resolve(base, 'index.ts')
        ]
        const importedFile = candidates.find(candidate => fs.existsSync(candidate))
        if (!importedFile || seen.has(importedFile)) continue
        seen.add(importedFile)
        try {
            if (!/\.jn$/i.test(importedFile)) {
                const declarations = hostDeclarations(fs.readFileSync(importedFile, 'utf8'))
                for (const name of importedStatement.namedImports) if (declarations.has(name)) result.set(name, declarations.get(name)!)
                continue
            }
            const nested = parse(fs.readFileSync(importedFile, 'utf8'), { validate: false, filePath: importedFile })
            const declarations = importedDeclarations(nested, importedFile, seen)
            for (const name of importedStatement.namedImports) if (declarations.has(name)) result.set(name, declarations.get(name)!)
        } catch { /* diagnostics handle unresolved or invalid modules */ }
        finally { seen.delete(importedFile) }
    }
    if (statements.some(item => item.kind === 'Import' && item.module === 'juno' && item.namedImports.includes('Error'))) {
        result.set('Error', { kind: 'type', generics: [], value: { kind: 'ObjectType', members: [field('name', named('string')), field('message', named('string')), { ...field('stack', named('string')), optional: true }] } })
    }
    if (statements.some(item => item.kind === 'Import' && item.module === 'juno' && item.namedImports.includes('Range'))) {
        let directory = path.dirname(path.resolve(filePath))
        let rangeFile: string | undefined
        while (true) {
            const candidate = path.join(directory, 'types', 'range.jn')
            if (fs.existsSync(candidate)) { rangeFile = candidate; break }
            const parent = path.dirname(directory)
            if (parent === directory) break
            directory = parent
        }
        rangeFile ??= path.resolve(__dirname, '../../types/range.jn')
        if (fs.existsSync(rangeFile)) {
            try {
                const declarations = importedDeclarations(parse(fs.readFileSync(rangeFile, 'utf8'), { validate: false, filePath: rangeFile }), rangeFile, seen)
                const range = declarations.get('Range')
                if (range) result.set('Range', range)
                const iterableFile = path.join(path.dirname(rangeFile), 'iterable.jn')
                if (fs.existsSync(iterableFile)) {
                    const iterableDeclarations = importedDeclarations(parse(fs.readFileSync(iterableFile, 'utf8'), { validate: false, filePath: iterableFile }), iterableFile, seen)
                    const iterable = iterableDeclarations.get('Iterable')
                    if (iterable) result.set('Iterable', iterable)
                }
            } catch { /* diagnostics handle invalid declarations */ }
        }
    }
    const junoConstructors = ['Boolean', 'Number', 'String'] as const
    for (const name of junoConstructors) if (statements.some(item => item.kind === 'Import' && item.module === 'juno' && item.namedImports.includes(name))) {
        let directory = path.dirname(path.resolve(filePath ?? process.cwd()))
        let base: string | undefined
        while (true) {
            const candidate = path.join(directory, 'types', name.toLowerCase())
            if (fs.existsSync(`${candidate}.jn`) || fs.existsSync(`${candidate}.ts`)) { base = candidate; break }
            const parent = path.dirname(directory)
            if (parent === directory) break
            directory = parent
        }
        base ??= path.resolve(__dirname, '../../types', name.toLowerCase())
        const candidates = [`${base}.jn`, `${base}.ts`]
        const file = candidates.find(candidate => fs.existsSync(candidate))
        if (!file) continue
        try {
            const declarations = /\.jn$/i.test(file)
                ? importedDeclarations(parse(fs.readFileSync(file, 'utf8'), { validate: false, filePath: file }), file, seen)
                : hostDeclarations(fs.readFileSync(file, 'utf8'))
            const constructor = declarations.get(name)
            if (constructor) result.set(name, constructor)
        } catch { /* diagnostics handle invalid declarations */ }
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

function inferGenericExpression(expression: Expression, env: Env): TypeNode {
    if (expression.kind === 'Literal') {
        if (typeof expression.value === 'string' || typeof expression.value === 'number' || typeof expression.value === 'boolean') {
            return { kind: 'LiteralType', value: expression.value, loc: expression.loc }
        }
        return inferLiteral(expression.value)
    }
    if (expression.kind === 'Array') {
        if (!expression.elements.length) return arrayOf(named('any'))
        const elements = expression.elements.map(item => item.kind === 'Spread'
            ? spreadElementType(inferExpression(item.value, env), env) ?? named('any')
            : inferGenericExpression(item, env))
        return arrayOf(unionOf(elements))
    }
    return inferExpression(expression, env)
}

function widenSetElementType(type: TypeNode): TypeNode {
    if (type.kind === 'LiteralType') return inferLiteral(type.value)
    if (type.kind === 'UnionType') return unionOf(type.types.map(widenSetElementType))
    if (type.kind === 'ArrayType') return { ...type, element: widenSetElementType(type.element) }
    return type
}

function inferMapArguments(args: Expression[], env: Env): [TypeNode, TypeNode] {
    const keys: TypeNode[] = []
    const values: TypeNode[] = []
    for (const argument of args) {
        if (argument.kind === 'Array' && argument.elements.length >= 2 && argument.elements[0].kind !== 'Spread' && argument.elements[1].kind !== 'Spread') {
            keys.push(inferGenericExpression(argument.elements[0], env))
            values.push(inferGenericExpression(argument.elements[1], env))
            continue
        }
        const actual = resolveType(inferExpression(argument, env), env)
        if (actual.kind === 'GenericType' && actual.name === 'Tuple' && actual.args.length >= 2) {
            keys.push(actual.args[0])
            values.push(actual.args[1])
        }
    }
    return [
        widenSetElementType(keys.length ? unionOf(keys) : named('any')),
        widenSetElementType(values.length ? unionOf(values) : named('any'))
    ]
}

function inferGenericArguments(generics: string[], params: Parameter[], args: Expression[], env: Env): TypeNode[] {
    const inferred = new Map<string, TypeNode>()
    const collect = (pattern: TypeNode | undefined, actual: TypeNode): void => {
        if (!pattern) return
        if (pattern.kind === 'NamedType' && generics.includes(pattern.name)) {
            if (!isNamedType(actual, 'any')) {
                const previous = inferred.get(pattern.name)
                inferred.set(pattern.name, previous ? unionOf([previous, actual]) : actual)
            }
            return
        }
        if (pattern.kind === 'ArrayType') {
            const resolved = resolveType(actual, env)
            const element = resolved.kind === 'ArrayType' ? resolved.element : resolved.kind === 'GenericType' && resolved.name === 'Array' ? resolved.args[0] : undefined
            if (element) collect(pattern.element, element)
            return
        }
        if (pattern.kind === 'GenericType') {
            const resolved = resolveType(actual, env)
            if (resolved.kind === 'GenericType' && resolved.name === pattern.name) pattern.args.forEach((part, index) => collect(part, resolved.args[index] ?? named('any')))
            else if (pattern.name === 'Iterable') {
                const element = resolved.kind === 'ArrayType' ? resolved.element : resolved.kind === 'GenericType' && resolved.name === 'Array' ? resolved.args[0] : iterableElementType(resolved, env)
                if (element) collect(pattern.args[0], element)
            }
            return
        }
        if (pattern.kind === 'FunctionType') {
            const resolved = removeNull(resolveType(actual, env))
            if (resolved.kind === 'FunctionType') {
                pattern.params.forEach((part, index) => collect(part, resolved.params[index] ?? named('any')))
                collect(pattern.result, resolved.result)
            }
            return
        }
        if (pattern.kind === 'ObjectType') {
            const resolved = resolveType(actual, env)
            if (resolved.kind === 'ObjectType') for (const member of pattern.members) collect(member.type, resolved.members.find(item => item.name === member.name)?.type ?? named('any'))
        }
    }
    params.forEach((param, index) => {
        if (param.rest) {
            const restType = parameterType(param)
            if (restType.kind === 'NamedType' && generics.includes(restType.name)) {
                const elements = args.slice(index).map(arg => inferExpression(arg, env))
                const element = elements.length ? unionOf(elements) : named('any')
                inferred.set(restType.name, {
                    kind: 'ObjectType',
                    members: [
                        ...elements.map((type, itemIndex): TypeMember => ({ name: String(itemIndex), type, optional: false, readonly: true, constant: false })),
                        { name: 'index', indexType: named('number'), type: element, optional: false, readonly: true, constant: false },
                        { name: 'length', type: { kind: 'LiteralType', value: elements.length }, optional: false, readonly: true, constant: false },
                        { name: 'toArray', type: arrayOf(element), optional: false, readonly: true, constant: false, method: true, params: [] }
                    ]
                })
                return
            }
            const element = restType.kind === 'ArrayType' ? restType.element : restType.kind === 'GenericType' && restType.name === 'Array' ? restType.args[0] : undefined
            if (element && args.length > index) {
                const actuals = args.slice(index).map(arg => inferGenericExpression(arg, env))
                const actual = actuals.every(type => type.kind === 'ArrayType')
                    ? arrayOf(unionOf(actuals.map(type => (type as Extract<TypeNode, { kind: 'ArrayType' }>).element)))
                    : unionOf(actuals)
                collect(element, actual)
            }
            return
        }
        const arg = args[index]
        if (arg) collect(parameterType(param), inferGenericExpression(arg, env))
    })
    return generics.map(name => inferred.get(name) ?? named('any'))
}

function functionGenericArguments(symbol: Extract<SymbolInfo, { kind: 'fun' }>, call: Extract<Expression, { kind: 'Call' }>, env: Env): TypeNode[] {
    const generics = symbol.generics ?? []
    const inferred = inferGenericArguments(generics, symbol.params, call.args, env)
    return generics.map((_name, index) => call.typeArguments?.[index]
        ?? (!isNamedType(inferred[index], 'any') ? inferred[index] : undefined)
        ?? symbol.genericDefaults?.[index]
        ?? named('any'))
}

function constructorMethodForCall(callee: Expression, args: Expression[], env: Env, explicitTypeArguments?: TypeNode[]): { params: Parameter[]; returnType: TypeNode; generics: string[]; constraints: (TypeNode | undefined)[]; typeArguments: TypeNode[] } | undefined {
    if (callee.kind !== 'Member' || callee.object.kind !== 'Identifier') return undefined
    const constructor = env.get(callee.object.name)
    if (constructor?.kind !== 'constructor') return undefined
    const method = constructor.methods.find(item => item.name === callee.property)
    if (!method) return undefined
    const generics = [...constructor.generics, ...method.generics]
    const constraints = [...(constructor.genericConstraints ?? []), ...(method.genericConstraints ?? [])]
    const defaults = [...(constructor.genericDefaults ?? []), ...(method.genericDefaults ?? [])]
    const inferredCandidates = inferGenericArguments(generics, method.params, args, env)
    const inferred = generics.map((_name, index) => {
        const methodIndex = index - constructor.generics.length
        const explicit = methodIndex >= 0 ? explicitTypeArguments?.[methodIndex] : undefined
        return explicit ?? (!isNamedType(inferredCandidates[index], 'any') ? inferredCandidates[index] : undefined) ?? defaults[index] ?? named('any')
    })
    if (callee.object.name === 'Set' || callee.object.name === 'ValueSet') {
        for (let index = 0; index < constructor.generics.length; index++) inferred[index] = widenSetElementType(inferred[index])
    }
    if ((callee.object.name === 'Map' || callee.object.name === 'ValueMap') && method.name === 'from' && args[0]?.kind === 'Array') {
        const entries = args[0].elements.filter((item): item is Exclude<typeof item, { kind: 'Spread' }> => item.kind !== 'Spread')
        const [key, value] = inferMapArguments(entries, env)
        inferred[0] = key
        inferred[1] = value
    }
    if (callee.object.name === 'Array' && method.name === 'from' && constructor.generics[0] && method.generics[0]) {
        const targetIndex = generics.indexOf(constructor.generics[0])
        const sourceIndex = generics.indexOf(method.generics[0])
        if (args[1]) {
            const callback = args[1]
            if (callback.kind === 'Function') {
                const local = bindInferredParameters(callback.params, env)
                if (callback.params[0] && !callback.params[0].type) local.set(callback.params[0].name, { kind: 'var', mutable: true, type: inferred[sourceIndex] })
                if (callback.params[1] && !callback.params[1].type) local.set(callback.params[1].name, { kind: 'var', mutable: true, type: named('number') })
                inferred[targetIndex] = callback.returnType
                    ?? (callback.expressionBody ? inferExpression(callback.expressionBody, local) : inferFunctionReturnType(callback.body, local, callback.params))
            }
            else if (isNamedType(inferred[targetIndex], 'any')) inferred[targetIndex] = inferred[sourceIndex]
        } else inferred[targetIndex] = inferred[sourceIndex]
    }
    return {
        params: method.params.map(param => ({ ...param, type: param.type ? instantiate(param.type, generics, inferred) : undefined })),
        returnType: instantiate(method.returnType, generics, inferred),
        generics, constraints, typeArguments: inferred
    }
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
    if (resolved.kind === 'GenericType' && resolved.name === 'Tuple' && resolved.args[0]?.kind !== 'ObjectType') return unionOf(resolved.args)
    if (resolved.kind === 'ArrayType') return resolved.element
    if (resolved.kind === 'GenericType' && (resolved.name === 'Array' || resolved.name === 'ReadonlyArray')) {
        return resolved.args[0] ?? named('any')
    }
    if (resolved.kind === 'UnionType') return unionOf(resolved.types.map(part => iterableElementType(part, env)))
    if (isNamedType(resolved, 'string')) return named('string')

    const arrayElement = (candidate: TypeNode): TypeNode | undefined => {
        const result = resolveType(candidate, env)
        if (result.kind === 'ArrayType') return result.element
        if (result.kind === 'GenericType' && (result.name === 'Array' || result.name === 'ReadonlyArray')) return result.args[0] ?? named('any')
        if (isNamedType(result, 'Array') || isNamedType(result, 'ReadonlyArray')) return named('any')
        return undefined
    }
    const toArray = lookupMember(type, 'toArray', env)
    if (isFunctionSymbol(toArray)) {
        const element = arrayElement(toArray.returnType)
        if (element) return element
    }

    const iterator = lookupMember(type, 'iterator', env)
    if (isFunctionSymbol(iterator)) {
        const next = removeNull(resolveType(iterator.returnType, env))
        if (next.kind === 'FunctionType') {
            const yielded = removeNull(resolveType(next.result, env))
            const value = lookupMember(yielded, 'value', env)
            if (value && !isFunctionSymbol(value)) return value
        }
    }
    return named('any')
}

function spreadElementType(type: TypeNode, env: Env): TypeNode | undefined {
    if (type.kind === 'NamedType') {
        const symbol = env.get(type.name)
        if (symbol?.kind === 'type') {
            const constraint = resolveType(symbol.value, env)
            if (constraint.kind === 'ArrayType' || constraint.kind === 'GenericType' && (constraint.name === 'Array' || constraint.name === 'ReadonlyArray')) {
                return { kind: 'IndexedAccessType', object: type, index: named('number') }
            }
        }
    }
    const resolved = resolveType(type, env)
    if (isNamedType(resolved, 'any')) return named('any')
    if (isNamedType(resolved, 'string')) return named('string')
    if (resolved.kind === 'ArrayType') return resolved.element
    if (resolved.kind === 'GenericType' && (resolved.name === 'Array' || resolved.name === 'ReadonlyArray')) {
        return resolved.args[0] ?? named('any')
    }
    if (resolved.kind === 'UnionType' || resolved.kind === 'IntersectionType') {
        const elements = resolved.types.map(part => spreadElementType(part, env))
        if (resolved.kind === 'UnionType' && elements.some(element => !element)) return undefined
        const available = elements.filter((element): element is TypeNode => Boolean(element))
        if (available.length) return unionOf(available)
    }
    const toArray = lookupMember(resolved, 'toArray', env)
    if (isFunctionSymbol(toArray) && toArray.params.length === 0) {
        const result = resolveType(toArray.returnType, env)
        if (result.kind === 'ArrayType') return result.element
        if (result.kind === 'GenericType' && (result.name === 'Array' || result.name === 'ReadonlyArray')) {
            return result.args[0] ?? named('any')
        }
        if (isNamedType(result, 'Array') || isNamedType(result, 'ReadonlyArray')) return named('any')
    }
    return undefined
}

function isNullable(type: TypeNode, env: Env): boolean {
    const resolved = resolveType(type, env)
    return isNamedType(resolved, 'null') || (resolved.kind === 'UnionType' && resolved.types.some(part => isNamedType(resolveType(part, env), 'null')))
}

function numericFamily(type: TypeNode): 'number' | 'BigInt' | undefined {
    if (isNamedType(type, 'number') || type.kind === 'LiteralType' && typeof type.value === 'number') return 'number'
    if (isNamedType(type, 'BigInt') || type.kind === 'LiteralType' && typeof type.value === 'bigint') return 'BigInt'
    if (type.kind === 'UnionType') {
        const families = new Set(type.types.map(numericFamily))
        if (families.size === 1 && !families.has(undefined)) return [...families][0]
    }
    return undefined
}

function hasSameNumericType(left: TypeNode, right: TypeNode): boolean {
    const family = numericFamily(left)
    return family !== undefined && family === numericFamily(right)
}

function isStringType(type: TypeNode): boolean {
    return isNamedType(type, 'string')
        || type.kind === 'LiteralType' && typeof type.value === 'string'
        || type.kind === 'UnionType' && type.types.length > 0 && type.types.every(isStringType)
}

function binaryResultType(operator: string, left: TypeNode, right: TypeNode): TypeNode {
    if (operator === '??') {
        const remaining = left.kind === 'UnionType'
            ? left.types.filter(part => !isNamedType(part, 'null'))
            : isNamedType(left, 'null') ? [] : [left]
        return unionOf([...remaining, right])
    }
    if (operator === '+') {
        if (hasSameNumericType(left, right)) return named(numericFamily(left)!)
        if (isStringType(left) && isStringType(right)) return named('string')
        return errorType()
    }
    if (['-', '*', '/', '%'].includes(operator)) return hasSameNumericType(left, right) ? named(numericFamily(left)!) : errorType()
    if (['<', '<=', '>', '>='].includes(operator)) return hasSameNumericType(left, right) ? named('boolean') : errorType()
    if (['==', '!=', '&', '|'].includes(operator)) return named('boolean')
    return named('any')
}

function binaryErrorMessage(operator: string, left: TypeNode, right: TypeNode): string | undefined {
    if (isNamedType(left, '<Error-Type>') || isNamedType(right, '<Error-Type>')) return undefined
    const leftName = printType(left), rightName = printType(right)
    if (operator === '+' && !(hasSameNumericType(left, right) || (isStringType(left) && isStringType(right)))) {
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

function pickOmitResult(objectType: TypeNode, args: Expression[], omit: boolean, env: Env): TypeNode {
    const object = removeNull(resolveType(objectType, env))
    if (object.kind === 'ArrayType' || object.kind === 'GenericType' && (object.name === 'Array' || object.name === 'ReadonlyArray')) return object
    if (object.kind !== 'ObjectType') return named('any')
    const keys = new Set(args.flatMap(argument => {
        const type = inferGenericExpression(argument, env)
        const parts = type.kind === 'UnionType' ? type.types : [type]
        return parts.flatMap(part => part.kind === 'LiteralType' && (typeof part.value === 'string' || typeof part.value === 'number') ? [String(part.value)] : [])
    }))
    if (!keys.size) return omit ? object : { kind: 'ObjectType', members: [] }
    return { ...object, members: object.members.filter(member => member.indexType || (omit ? !keys.has(member.name) : keys.has(member.name))) }
}

function inferExpression(expression: Expression, env: Env): TypeNode {
    switch (expression.kind) {
        case 'RegEx': return named('RegEx')
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
            if (symbol.kind === 'constructor') return { kind: 'FunctionType', params: symbol.overloads[0]?.params.map(parameterType) ?? [], result: named(expression.name) }
            return named(expression.name)
        }
        case 'Array': {
            if (!expression.elements.length) return arrayOf(named('any'))
            const elements = expression.elements.map(item => item.kind === 'Spread'
                ? spreadElementType(inferExpression(item.value, env), env) ?? errorType()
                : inferExpression(item, env))
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
        case 'Spread': return spreadElementType(inferExpression(expression.value, env), env) ?? errorType()
        case 'Object': {
            // Build the object's shape before inferring methods so `this` inside a
            // method can resolve both fields and other methods on the object.
            const members: TypeMember[] = expression.properties.flatMap(property => {
                if (property.typeOnly && property.indexType && property.declaredType) return [{
                    name: property.key, loc: property.keyLoc, indexType: property.indexType, type: property.declaredType,
                    optional: false, readonly: Boolean(property.readonly), sealed: Boolean(property.sealed), constant: false
                }]
                if (property.spread) {
                    const spread = resolveType(inferExpression(property.value, env), env)
                    const members = (type: TypeNode): TypeMember[] => {
                        const resolved = resolveType(type, env)
                        if (resolved.kind === 'ObjectType') return resolved.members
                        if (resolved.kind === 'NamedType') {
                            const constructor = env.get(resolved.name)
                            if (constructor?.kind === 'constructor') return members(constructor.inheritedType)
                        }
                        if (resolved.kind === 'IntersectionType' || resolved.kind === 'UnionType') return resolved.types.flatMap(members)
                        return []
                    }
                    return members(spread)
                }
                if (property.accessor === 'get' && property.value.kind === 'Function') {
                    const result = property.value.returnType ?? inferFunctionReturnType(property.value.body, env, property.value.params)
                    return [{ ...field(property.key, result), sealed: Boolean(property.sealed), accessor: 'get' as const }]
                }
                if (property.accessor === 'set' && property.value.kind === 'Function') {
                    const setterType = property.value.params[0] ? parameterBodyType(property.value.params[0]) : named('any')
                    return [{ ...field(property.key, setterType), sealed: Boolean(property.sealed), accessor: 'set' as const, params: property.value.params }]
                }
                if (property.value.kind === 'Function') {
                    return [{
                        ...method(property.key, property.value.params, property.value.returnType ?? named('any')),
                        sealed: Boolean(property.sealed),
                        generics: property.value.generics,
                        genericLocs: property.value.genericLocs,
                        genericConstraints: property.value.genericConstraints,
                        genericDefaults: property.value.genericDefaults
                    }]
                }
                return [{ ...field(property.key, inferExpression(property.value, env), property.readonly), sealed: Boolean(property.sealed) }]
            })
            const objectType: Extract<TypeNode, { kind: 'ObjectType' }> = { kind: 'ObjectType', members }
            const methodEnv = new Map(env)
            methodEnv.set('this', { kind: 'var', mutable: false, type: objectType })
            for (const property of expression.properties) {
                if (property.accessor === 'set' || property.value.kind !== 'Function' || property.value.returnType) continue
                const index = members.findLastIndex(member => member.name === property.key)
                if (index >= 0) {
                    const inferred = inferFunctionReturnType(property.value.body, methodEnv, property.value.params)
                    members[index] = property.accessor === 'get'
                        ? { ...field(property.key, inferred), sealed: Boolean(property.sealed), accessor: 'get' }
                        : {
                            ...method(property.key, property.value.params, inferred),
                            sealed: Boolean(property.sealed),
                            generics: property.value.generics,
                            genericLocs: property.value.genericLocs,
                            genericConstraints: property.value.genericConstraints,
                            genericDefaults: property.value.genericDefaults
                        }
                }
            }
            objectType.members = members.filter((member, index) => {
                const key = `${member.name}:${member.accessor ?? ''}`
                return members.findLastIndex(item => `${item.name}:${item.accessor ?? ''}` === key) === index
            })
            return objectType
        }
        case 'Unary': return expression.operator === 'postfix!' ? removeNull(inferExpression(expression.operand, env)) : expression.operator.endsWith('++') || expression.operator.endsWith('--') ? inferExpression(expression.operand, env) : expression.operator === '-' ? named('number') : named('boolean')
        case 'Conditional':
            return unionOf([inferExpression(expression.consequent, env), inferExpression(expression.alternate, env)])
        case 'Is': return named('boolean')
        case 'Binary': {
            const left = inferExpression(expression.left, env)
            const right = inferExpression(expression.right, env)
            return binaryResultType(expression.operator, left, right)
        }
        case 'Member': {
            if (expression.object.kind === 'Identifier') {
                const constructor = env.get(expression.object.name)
                const method = constructor?.kind === 'constructor' ? constructor.methods.find(item => item.name === expression.property) : undefined
                if (method) return functionType(method.params, method.returnType)
            }
            const objectType = inferExpression(expression.object, env)
            const nonNullObjectType = removeNull(resolveType(objectType, env))
            const resolvedObjectType = resolveType(nonNullObjectType, env)
            const member = lookupMember(nonNullObjectType, expression.property, env)
            if (!member) return resolvedObjectType.kind === 'ObjectType' ? named('null') : named('any')
            const memberType = isFunctionSymbol(member)
                ? (() => {
                    const genericArguments = member.generics?.map((name, index) => member.genericConstraints?.[index] ?? named(name))
                    const parameters = genericArguments
                        ? member.params.map(param => instantiate(parameterType(param), member.generics!, genericArguments))
                        : member.params.map(parameterType)
                    const result = genericArguments
                        ? instantiate(member.returnType, member.generics!, genericArguments)
                        : member.returnType
                    return { kind: 'FunctionType', params: parameters, result } as TypeNode
                })()
                : member
            return expression.optional ? unionOf([memberType, named('null')]) : memberType
        }
        case 'Index': {
            const objectType = inferExpression(expression.object, env)
            return indexedAccessType(objectType, inferGenericExpression(expression.index, env), env) ?? named('any')
        }
        case 'Call': {
            if (expression.callee.kind === 'Member' && expression.callee.property === 'isType') return named('boolean')
            if (expression.callee.kind === 'Identifier' && expression.callee.name === 'isType') return named('boolean')
            if (expression.callee.kind === 'Identifier') {
                const functionSymbol = env.get(expression.callee.name)
                if (functionSymbol?.kind === 'fun' && functionSymbol.generics?.length) {
                    const typeArguments = functionGenericArguments(functionSymbol, expression, env)
                    return instantiate(functionSymbol.returnType, functionSymbol.generics, typeArguments)
                }
            }
            const constructorMethod = constructorMethodForCall(expression.callee, expression.args, env, expression.typeArguments)
            if (constructorMethod) return constructorMethod.returnType
            if (expression.callee.kind === 'Member') {
                if (expression.callee.property === 'pick' || expression.callee.property === 'omit') {
                    return pickOmitResult(inferExpression(expression.callee.object, env), expression.args, expression.callee.property === 'omit', env)
                }
                const member = lookupMember(inferExpression(expression.callee.object, env), expression.callee.property, env)
                if (isFunctionSymbol(member) && member.generics?.length) {
                    const symbol: Extract<SymbolInfo, { kind: 'fun' }> = { kind: 'fun', generics: member.generics, genericConstraints: member.genericConstraints, genericDefaults: member.genericDefaults, params: member.params, returnType: member.returnType }
                    return instantiate(member.returnType, member.generics, functionGenericArguments(symbol, expression, env))
                }
            }
            if (expression.callee.kind === 'Member' && expression.callee.property === 'as' && expression.typeArguments?.length) return expression.typeArguments[0]
            if (expression.callee.kind === 'Identifier') {
                const typeSymbol = env.get(expression.callee.name)
                if (typeSymbol?.kind === 'type') {
                    if (!typeSymbol.generics.length) return named(expression.callee.name)
                    const inferred = inferGenericArguments(typeSymbol.generics, [{ name: 'value', type: typeSymbol.value }], expression.args, env)
                    const args = typeSymbol.generics.map((_name, index) => expression.typeArguments?.[index]
                        ?? (!isNamedType(inferred[index], 'any') ? inferred[index] : undefined)
                        ?? typeSymbol.genericDefaults?.[index]
                        ?? named('any'))
                    return { kind: 'GenericType', name: expression.callee.name, args }
                }
            }
            if (expression.callee.kind === 'Identifier') {
                const symbol = env.get(expression.callee.name)
                if (symbol?.kind === 'constructor') {
                    if (!symbol.generics.length) return named(expression.callee.name)
                    const args = expression.typeArguments?.length
                        ? expression.typeArguments
                        : inferGenericArguments(symbol.generics, symbol.overloads[0]?.params ?? [], expression.args, env)
                    if (!expression.typeArguments?.length && (expression.callee.name === 'Set' || expression.callee.name === 'ValueSet')) {
                        for (let index = 0; index < args.length; index++) args[index] = widenSetElementType(args[index])
                    }
                    if (!expression.typeArguments?.length && (expression.callee.name === 'Map' || expression.callee.name === 'ValueMap')) {
                        const [key, value] = inferMapArguments(expression.args, env)
                        args[0] = key
                        args[1] = value
                    }
                    if (symbol.inheritedType.kind === 'ObjectType' && symbol.inheritedType.members.length === 0 && symbol.overloads[0]) {
                        return instantiate(symbol.overloads[0].returnType, symbol.generics, args, symbol.genericDefaults)
                    }
                    return { kind: 'GenericType', name: expression.callee.name, args }
                }
            }
            if (expression.callee.kind === 'Member' && expression.callee.property === 'map' && expression.args[0]?.kind === 'Function') {
                const objectType = inferExpression(expression.callee.object, env)
                const member = lookupMember(objectType, expression.callee.property, env)
                const callback = expression.args[0]
                if (isFunctionSymbol(member)) {
                    // `map` is generic in the callback result. Its declaration uses
                    // `any` as a placeholder because JunoScript does not have
                    // method-level type parameters yet.
                    const expected = member.params[0] ? resolveType(parameterType(member.params[0]), env) : undefined
                    const local = bindInferredParameters(callback.params, env)
                    if (expected?.kind === 'FunctionType') callback.params.forEach((param, index) => {
                        if (!param.type && expected.params[index]) {
                            local.set(param.name, { kind: 'var', mutable: true, type: expected.params[index] })
                        }
                    })
                    const result = callback.returnType
                        ?? (callback.expressionBody
                            ? inferExpression(callback.expressionBody, local)
                            : inferFunctionReturnType(callback.body, local, callback.params))
                    return arrayOf(result)
                }
            }
            const callee = inferExpression(expression.callee, env)
            const callable = callableType(callee, env)
            if (callable) return callable.result
            if (callee.kind === 'UnionType') {
                const results = callee.types.flatMap(part => {
                    const resolved = resolveType(part, env), callable = callableType(resolved, env)
                    if (callable) return [callable.result]
                    return isNamedType(resolved, 'null') && expression.callee.kind === 'Member' && expression.callee.optional ? [named('null')] : []
                })
                if (results.length) return unionOf(results)
            }
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
        case 'Match': {
            const results = expression.cases.map(item => inferFunctionReturnType(item.body, matchCaseEnv(expression, item.pattern, env)))
            if (!expression.cases.some(item => !item.pattern)) results.push(named('null'))
            return unionOf(results)
        }
        case 'Try': {
            const source = resolveType(expression.body
                ? inferFunctionReturnType(expression.body, env)
                : inferExpression(expression.value!, env), env)
            let success: TypeNode = named('any')
            const parts = (source.kind === 'UnionType' ? source.types : [source]).map(part => resolveType(part, env))
            const values = parts.flatMap(part => part.kind === 'ObjectType'
                ? part.members.filter(member => member.name === 'value').map(member => member.type)
                : [])
            if (values.length) success = unionOf(values)
            const errors = parts.flatMap(part => part.kind === 'ObjectType'
                ? part.members.filter(member => member.name === 'error').map(member => member.type)
                : [])
            const inferredError = errors.length ? unionOf(errors) : named('Error')
            const caught = expression.catches.map(clause => {
                const local = new Map(env)
                if (clause.binding) local.set(clause.binding, { kind: 'var', mutable: false, type: clause.type ?? inferredError })
                return inferFunctionReturnType(clause.body, local)
            })
            return unionOf([success, ...caught])
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
                collect(statement.consequent, narrowedConditionEnvironment(statement.condition, env, true))
                const falseEnv = narrowedConditionEnvironment(statement.condition, env, false)
                if (statement.alternate) collect(statement.alternate, falseEnv)
                else if (statementsDefinitelyReturn(statement.consequent)) {
                    for (const [name, symbol] of falseEnv) if (env.has(name)) env.set(name, symbol)
                }
                const guard = negatedMemberTypeGuard(statement.condition)
                if (!statement.alternate && guard && statement.consequent.some(item => item.kind === 'ExpressionStatement' && item.expression.kind === 'Assignment' && item.expression.name === guard.name)) {
                    const symbol = env.get(guard.name)
                    if (symbol?.kind === 'var') env.set(guard.name, { ...symbol, type: guard.type })
                }
            } else if (statement.kind === 'While' || statement.kind === 'ForOf') {
                collect(statement.body, new Map(env))
            } else if (statement.kind === 'Variable') {
                env.set(statement.name, { kind: 'var', mutable: statement.mutable, type: statement.type ?? (statement.initializer ? inferExpression(statement.initializer, env) : named('any')) })
            } else if (statement.kind === 'Destructure') {
                const source = inferExpression(statement.initializer, env)
                for (const binding of statement.bindings) {
                    const member = lookupMember(source, binding.name, env)
                    env.set(binding.name, { kind: 'var', mutable: statement.mutable, type: member && !isFunctionSymbol(member) ? member : named('any') })
                }
            }
        }
    }
    const local = bindInferredParameters(params, outer)
    collect(statements, local)
    return returns.length ? unionOf(returns) : named('null')
}

function statementsDefinitelyReturn(statements: Statement[]): boolean {
    return statements.some(statement => statement.kind === 'Return'
        || statement.kind === 'If' && Boolean(statement.alternate)
            && statementsDefinitelyReturn(statement.consequent)
            && statementsDefinitelyReturn(statement.alternate!))
}

function narrowedConditionEnvironment(condition: Expression, env: Env, whenTruthy: boolean): Env {
    const narrowed = new Map(env)
    if (condition.kind === 'Call' && condition.typeArguments?.[0]) {
        const identifier = condition.callee.kind === 'Member'
            && condition.callee.property === 'isType'
            && condition.callee.object.kind === 'Identifier'
                ? condition.callee.object
                : condition.callee.kind === 'Identifier'
                    && condition.callee.name === 'isType'
                    && condition.args[0]?.kind === 'Identifier'
                        ? condition.args[0]
                        : undefined
        const narrowedTo = condition.typeArguments[0]
        const symbol = identifier ? narrowed.get(identifier.name) : undefined
        if (identifier && symbol?.kind === 'var') {
            if (whenTruthy) narrowed.set(identifier.name, { ...symbol, type: narrowedTo })
            else {
                const flattenUnion = (type: TypeNode): TypeNode[] => type.kind === 'UnionType' ? type.types.flatMap(flattenUnion) : [type]
                const parts = flattenUnion(symbol.type)
                const remaining = parts.filter(part => !isAssignableTo(narrowedTo, part, env))
                narrowed.set(identifier.name, { ...symbol, type: remaining.length ? unionOf(remaining) : named('never') })
            }
        }
    }
    return narrowed
}

function negatedMemberTypeGuard(condition: Expression): { name: string; type: TypeNode } | undefined {
    if (condition.kind !== 'Unary' || condition.operator !== '!' || condition.operand.kind !== 'Call') return undefined
    const call = condition.operand
    if (call.callee.kind !== 'Member' || call.callee.property !== 'isType' || call.callee.object.kind !== 'Identifier' || !call.typeArguments?.[0]) return undefined
    return { name: call.callee.object.name, type: call.typeArguments[0] }
}

function unionOf(types: TypeNode[]): TypeNode {
    const flatten = (type: TypeNode): TypeNode[] => type.kind === 'UnionType' ? type.types.flatMap(flatten) : [type]
    const flattened = types.flatMap(flatten)
    if (!flattened.length) return named('any')
    const unique = flattened.filter((type, index) => flattened.findIndex(item => printType(item) === printType(type)) === index)
    return unique.length === 1 ? unique[0] : { kind: 'UnionType', types: unique }
}

function functionType(params: Parameter[], returnType?: TypeNode): TypeNode {
    return { kind: 'FunctionType', params: params.map(parameterType), result: returnType ?? named('any') }
}

function matchIdentifierType(name: string, nullable: boolean | undefined, env: Env): TypeNode {
    const symbol = env.get(name)
    const base = ['string', 'number', 'boolean', 'bigint', 'symbol', 'object', 'unknown', 'any', 'null'].includes(name)
        || symbol?.kind === 'type' || symbol?.kind === 'constructor'
            ? named(name)
            : symbol?.kind === 'var' ? symbol.type : named('any')
    return nullable ? unionOf([base, named('null')]) : base
}

function matchPatternType(pattern: MatchPattern, env: Env): TypeNode {
    if (pattern.kind === 'PatternLiteral') return pattern.value === null ? named('null') : typeof pattern.value === 'bigint' ? named('bigint') : { kind: 'LiteralType', value: pattern.value }
    if (pattern.kind === 'PatternIdentifier') return pattern.name === '_' ? named('any') : matchIdentifierType(pattern.name, pattern.nullable, env)
    if (pattern.kind === 'PatternUnion') return unionOf(pattern.patterns.map(part => matchPatternType(part, env)))
    return { kind: 'ObjectType', members: pattern.properties.map(property => field(property.name, property.pattern ? matchPatternType(property.pattern, env) : named('any'))) }
}

function matchPatternBindings(pattern: MatchPattern, subject: TypeNode, env: Env): Map<string, TypeNode> {
    if (pattern.kind === 'PatternUnion') {
        const parts = pattern.patterns.map(part => matchPatternBindings(part, subject, env))
        const names = new Set(parts.flatMap(part => [...part.keys()]))
        return new Map([...names].map(name => [name, unionOf(parts.map(part => part.get(name) ?? named('null')))]))
    }
    if (pattern.kind !== 'PatternObject') return new Map()
    const bindings = new Map<string, TypeNode>()
    for (const property of pattern.properties) {
        const member = lookupMember(subject, property.name, env)
        const contextual = member && !isFunctionSymbol(member) ? member : named('null')
        bindings.set(property.name, property.pattern ? matchPatternType(property.pattern, env) : contextual)
    }
    return bindings
}

function matchCaseEnv(expression: Extract<Expression, { kind: 'Match' }>, pattern: MatchPattern | undefined, env: Env): Env {
    const local = new Map(env)
    if (!pattern) return local
    const subject = inferExpression(expression.value, env)
    if (expression.value.kind === 'Identifier') {
        const symbol = local.get(expression.value.name)
        if (symbol?.kind === 'var') local.set(expression.value.name, { ...symbol, type: matchPatternType(pattern, env) })
    }
    for (const [name, type] of matchPatternBindings(pattern, subject, env)) local.set(name, { kind: 'var', mutable: false, type })
    return local
}

function expandedHoverType(type: TypeNode, env: Env): TypeNode {
    if (type.kind === 'NamedType') {
        const symbol = env.get(type.name)
        if (symbol?.kind === 'constructor') {
            return resolveType(symbol.inheritedType, env)
        }
    }
    return resolveType(type, env)
}

function compactType(type: TypeNode, depth = 0): string {
    const indent = '  '.repeat(depth)
    const childIndent = '  '.repeat(depth + 1)
    switch (type.kind) {
        case 'NamedType': return type.name
        case 'LiteralType': return typeof type.value === 'string' ? JSON.stringify(type.value) : String(type.value)
        case 'GenericType': return `${type.name}<${type.args.map(argument => compactType(argument, depth)).join(', ')}>`
        case 'ArrayType': {
            const element = compactType(type.element, depth)
            return `${type.element.kind === 'UnionType' || type.element.kind === 'IntersectionType' || type.element.kind === 'FunctionType' ? `(${element})` : element}[]`
        }
        case 'IndexedAccessType': return `${compactType(type.object, depth)}[${compactType(type.index, depth)}]`
        case 'TypeOfType': return 'typeof<…>'
        case 'ConditionalType': return `${compactType(type.check, depth)} extends ${compactType(type.target, depth)} ? ${compactType(type.consequent, depth)} : ${compactType(type.alternate, depth)}`
        case 'UnionType': return type.types.map(part => compactType(part, depth)).join(' | ')
        case 'IntersectionType': return type.types.map(part => compactType(part, depth)).join(' & ')
        case 'FunctionType': return `(${type.params.map((parameter, index) => `arg${index}: ${compactType(parameter, depth)}`).join(', ')}) => ${compactType(type.result, depth)}`
        case 'ObjectType': {
            if (!type.members.length) return '{}'
            const members = type.members.map(member => {
                const modifier = `${member.readonly ? 'readonly ' : ''}${member.sealed ? 'sealed ' : ''}${member.constant ? 'const ' : ''}`
                const optional = member.optional ? '?' : ''
                const params = (member.params ?? []).map(param => `${param.rest ? '...' : ''}${param.name}${param.defaultValue !== undefined ? '?' : ''}: ${compactType(parameterType(param), depth + 1)}`).join(', ')
                if (member.indexType) return `${childIndent}[${member.name}: ${compactType(member.indexType, depth + 1)}]: ${compactType(member.type, depth + 1)};`
                if (member.accessor === 'get') return `${childIndent}${member.sealed ? 'sealed ' : ''}get ${member.name}(): ${compactType(member.type, depth + 1)};`
                if (member.accessor === 'set') return `${childIndent}${member.sealed ? 'sealed ' : ''}set ${member.name}(${params}): void;`
                if (member.method) return `${childIndent}${modifier}${member.name}${optional}(${params}): ${compactType(member.type, depth + 1)};`
                return `${childIndent}${modifier}${member.name}${optional}: ${compactType(member.type, depth + 1)};`
            })
            return `{\n${members.join('\n')}\n${indent}}`
        }
    }
}

function typeDescription(type: TypeNode, env: Env): string {
    return compactType(expandedHoverType(type, env))
}

function symbolTypeDescription(name: string, symbol: SymbolInfo, env: Env): string | undefined {
    if (symbol.kind === 'constructor') return typeDescription(named(name), env)
    if (symbol.kind === 'var') return typeDescription(symbol.type, env)
    if (symbol.kind === 'type') return typeDescription(symbol.value, env)
    if (symbol.kind === 'fun') {
        const generics = symbol.generics?.length
            ? `<${symbol.generics.map((generic, index) => `${generic}${symbol.genericConstraints?.[index] ? ` extends ${compactType(symbol.genericConstraints[index]!)}` : ''}`).join(', ')}>`
            : ''
        const params = symbol.params.map((param, index) => `${param.rest ? '...' : ''}${param.name || `arg${index}`}: ${compactType(parameterType(param))}`).join(', ')
        return `${generics}(${params}) => ${compactType(symbol.returnType)}`
    }
    return undefined
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
    semanticTokens: SemanticTokenInfo[] = []

    analyze(statements: Statement[], builtins: Map<string, ImportedSymbol> = new Map()): void {
        const env = globals()
        for (const [name, symbol] of builtins) if (symbol.kind === 'type') {
            env.set(name, { kind: 'type', generics: symbol.generics, genericConstraints: symbol.genericConstraints, genericDefaults: symbol.genericDefaults, value: symbol.value })
        }
        for (const statement of statements) if (statement.kind === 'Import') {
            for (const [name, symbol] of Object.entries(statement.importedSymbols ?? {})) {
                if (symbol.kind === 'type' && symbol.value) env.set(name, { kind: 'type', generics: symbol.generics ?? [], genericConstraints: symbol.genericConstraints, genericDefaults: symbol.genericDefaults, value: symbol.value })
                else if (symbol.kind === 'fun') env.set(name, { kind: 'fun', generics: symbol.generics, genericConstraints: symbol.genericConstraints, genericDefaults: symbol.genericDefaults, params: symbol.params ?? [], returnType: symbol.returnType ?? named('any') })
                else if (symbol.kind === 'var') env.set(name, { kind: 'var', mutable: false, type: symbol.type ?? named('any') })
            }
            for (const [name, value] of Object.entries(statement.importedTypes ?? {})) {
                env.set(name, { kind: 'type', generics: [], value })
            }
        }
        for (const statement of statements) if (statement.kind === 'Import') this.statement(statement, env)
        this.statements(statements, env)
    }

    private addHover(name: string, loc: Loc | undefined, code: string, docs?: string, typeDescription?: string): void {
        if (!loc) return
        this.hovers.push({ line: loc.line, column: loc.column, length: lengthOf(name, loc), code, docs, typeDescription })
    }

    private addTypeHint(loc: Loc | undefined, name: string, hasType: boolean, type: TypeNode, kind: 'type' | 'callbackType' = 'type'): void {
        if (!loc || hasType) return
        const printed = printType(type)
        this.hints.push({
            line: loc.line,
            column: loc.column + name.length,
            label: `: ${printed}`,
            tooltip: printed,
            kind
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
            else if (symbol?.kind === 'constructor') params = symbol.overloads[0]?.params
        } else if (callee.kind === 'Member') {
            const member = lookupMember(inferExpression(callee.object, env), callee.property, env)
            if (isFunctionSymbol(member)) params = member.params
        }
        params ??= (() => {
            const callable = callableType(inferExpression(callee, env), env)
            if (!callable) return undefined
            const call = lookupMember(inferExpression(callee, env), '', env)
            return isFunctionSymbol(call) ? call.params : callable.params.map((type, index) => ({ name: `arg${index}`, type }))
        })()
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
        const narrowed = narrowedConditionEnvironment(condition, env, whenTruthy)
        if (condition.kind === 'Call'
            && condition.callee.kind === 'Member'
            && condition.callee.property === 'has'
            && condition.callee.object.kind === 'Identifier'
            && whenTruthy) {
            const argument = condition.args[0]
            const argumentSymbol = argument?.kind === 'Identifier' ? env.get(argument.name) : undefined
            const property = argument?.kind === 'Literal' && typeof argument.value === 'string'
                ? argument.value
                : argumentSymbol?.kind === 'var' && argumentSymbol.type.kind === 'LiteralType' && typeof argumentSymbol.type.value === 'string'
                    ? argumentSymbol.type.value
                    : undefined
            if (property) {
                const objectName = condition.callee.object.name
                const object = narrowed.get(objectName)
                if (object?.kind === 'var') narrowed.set(objectName, { ...object, type: narrowHasProperty(object.type, property, env) })
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
            const declarationName = candidate.kind === 'Variable' || candidate.kind === 'FunctionDeclaration' || candidate.kind === 'TypeDeclaration' || candidate.kind === 'ConstructorDeclaration'
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
                    : statement.module === 'juno:types' || statement.module === 'types' ? 'Runtime type utilities for transforming Juno type declarations.' : 'Standard JunoScript module. `console` mirrors the host console.'
                if (statement.defaultImport) {
                    const symbol: SymbolInfo = { kind: 'module', module: statement.module, docs: imported }
                    this.bind(env, statement.defaultImport, symbol)
                    const printed = printSymbol(statement.defaultImport, symbol)
                    this.addHover(statement.defaultImport, statement.defaultImportLoc, printed.code, printed.docs)
                }
                statement.namedImports.forEach((name, index) => {
                    const importedAlias = statement.importedTypes?.[name]
                    const importedSymbol = statement.importedSymbols?.[name]
                    const itemsImport = name === 'Items' && (statement.module === 'juno:types' || statement.module === 'types')
                    const type = importedAlias ? resolveType(importedAlias, env) : importedSymbol?.kind === 'var' ? importedSymbol.type ?? named('any') : name === 'console' ? consoleType()
                        : name === 'Math' && statement.module === 'juno' ? mathType()
                        : name === 'types' && statement.module === 'juno' ? typeUtilitiesType()
                        : (statement.module === 'juno:types' || statement.module === 'types') && ['Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'KeyOf', 'Exclude'].includes(name) ? typeUtilitiesType().kind === 'ObjectType' ? typeUtilitiesType().members.find(member => member.name === name)?.type ?? named('any') : named('any')
                        : named('any')
                    const symbol: SymbolInfo = itemsImport
                        ? { kind: 'fun', generics: ['T'], genericConstraints: [{ kind: 'UnionType', types: [named('string'), named('number')] }], params: [], returnType: arrayOf(named('T')), docs: 'Creates an array from a union of string or number literal types.' }
                        : importedSymbol?.kind === 'fun'
                        ? { kind: 'fun', generics: importedSymbol.generics, genericConstraints: importedSymbol.genericConstraints, genericDefaults: importedSymbol.genericDefaults, params: importedSymbol.params ?? [], returnType: importedSymbol.returnType ?? named('any'), docs: imported }
                        : importedSymbol?.kind === 'constructor' && importedSymbol.inheritedType && importedSymbol.overloads
                            ? { kind: 'constructor', generics: importedSymbol.generics ?? [], genericConstraints: importedSymbol.genericConstraints, genericDefaults: importedSymbol.genericDefaults, inheritedType: importedSymbol.inheritedType, overloads: importedSymbol.overloads, methods: (importedSymbol.methods ?? []).map(method => ({ ...method, generics: method.generics ?? [] })), docs: imported }
                        : {
                        kind: importedAlias || importedSymbol?.kind === 'type' ? 'type' : 'var',
                        mutable: false,
                        ...(importedAlias || importedSymbol?.kind === 'type' ? { generics: importedSymbol?.generics ?? [], genericConstraints: importedSymbol?.genericConstraints, genericDefaults: importedSymbol?.genericDefaults, value: importedAlias ?? importedSymbol?.value ?? named('any') } : { type }),
                        docs: name === 'console'
                            ? (statement.module === 'juno:node' ? 'Console with `log`, `args`, `read`, and `readLines`.' : 'Host console (`log`, `error`, `warn`).')
                            : name === 'Math' && statement.module === 'juno' ? 'Standard JavaScript Math constants and functions.'
                            : name === 'types' && statement.module === 'juno' ? 'Runtime type transformation utilities.' : imported
                    }
                    this.bind(env, name, symbol)
                    const printed = printSymbol(name, symbol)
                    this.addHover(name, statement.namedImportLocs?.[index], printed.code, printed.docs, symbolTypeDescription(name, symbol, env))
                })
                return
            }
            case 'Export': this.statement(statement.declaration, env); return
            case 'TypeDeclaration': {
                const symbol: SymbolInfo = { kind: 'type', generics: statement.generics, genericConstraints: statement.genericConstraints, genericDefaults: statement.genericDefaults, value: statement.value }
                this.bind(env, statement.name, symbol)
                const genericEnv = new Map(env)
                statement.generics.forEach((name, index) => genericEnv.set(name, {
                    kind: 'type', generics: [], value: statement.genericConstraints?.[index] ?? statement.genericDefaults?.[index] ?? named('any'), typeParameter: true
                }))
                this.walkType(statement.value, genericEnv)
                const resolved = resolveType(statement.value, genericEnv)
                const printed = {
                    code: `type ${statement.name}${printGenerics(statement.generics, statement.genericConstraints, statement.genericDefaults)} = ${printType(statement.value)}${statement.generics.length ? '' : `\n(infer) ${printType(resolved)}`}`
                }
                this.addHover(statement.name, statement.loc, printed.code, undefined, statement.generics.length ? compactType(statement.value) : typeDescription(resolved, genericEnv))
                statement.generics.forEach((name, index) => {
                    this.addHover(name, statement.genericLocs?.[index], `(type parameter) ${name}`)
                    const constraint = statement.genericConstraints?.[index]
                    const defaultType = statement.genericDefaults?.[index]
                    if (constraint) this.walkType(constraint, env)
                    if (defaultType) {
                        this.walkType(defaultType, env)
                        if (constraint && !isAssignableTo(constraint, defaultType, env)) this.addDiagnostic(statement.genericLocs?.[index], `Default type '${printType(defaultType)}' does not satisfy constraint '${printType(constraint)}'.`)
                    }
                })
                return
            }
            case 'Variable': {
                this.walkExpression(statement.initializer, env, statement.type ? resolveType(statement.type, env) : undefined)
                const type = statement.type ? resolveType(statement.type, env) : statement.initializer ? inferExpression(statement.initializer, env) : named('any')
                if (statement.type && statement.initializer?.kind === 'Object') {
                    const expected = resolveType(statement.type, env)
                    if (expected.kind === 'ObjectType') {
                        const properties = statement.initializer.properties
                        const actual = inferExpression(statement.initializer, env)
                        const actualMembers = actual.kind === 'ObjectType' ? actual.members : []
                        for (const property of properties) {
                            if (property.spread) continue
                            const numericKey = Number(property.key)
                            const keyType: TypeNode = { kind: 'LiteralType', value: property.key !== '' && Number.isFinite(numericKey) && String(numericKey) === property.key ? numericKey : property.key }
                            const member = expected.members.find(item => !item.indexType && item.name === property.key)
                                ?? expected.members.find(item => item.indexType && isAssignableTo(item.indexType, keyType, env))
                            if (!member) continue
                            const propertyType = inferExpression(property.value, env)
                            const expectedType = member.method
                                ? { kind: 'FunctionType', params: (member.params ?? []).map(parameterType), result: member.type } as TypeNode
                                : member.type
                            if (!isAssignableTo(expectedType, propertyType, env)) {
                                const label = property.key || '<call signature>'
                                if (property.keyLoc) this.diagnostics.push({ line: property.keyLoc.line, column: property.keyLoc.column, length: Math.max(1, property.key.length), message: `Type '${printType(propertyType)}' is not assignable to type '${printType(expectedType)}' for '${label}'.` })
                            }
                        }
                        const missing = expected.members.filter(member => !member.indexType && !member.optional && (!member.method || member.accessor === 'get') && member.accessor !== 'set' && !member.defaultValue && !isNullable(member.type, env) && !actualMembers.some(item => item.name === member.name))
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
                const keyConstraint = statement.initializer?.kind === 'Member' && (statement.initializer.property === 'pick' || statement.initializer.property === 'omit')
                    ? resolveType({ kind: 'GenericType', name: 'KeyOf', args: [inferExpression(statement.initializer.object, env)] }, env)
                    : undefined
                const symbol: SymbolInfo = { kind: 'var', mutable: statement.mutable, type: statement.type ?? type, keyConstraint }
                this.bind(env, statement.name, symbol)
                const printed = printSymbol(statement.name, symbol)
                let description = symbolTypeDescription(statement.name, symbol, env)
                if (statement.initializer?.kind === 'Member' && (statement.initializer.property === 'pick' || statement.initializer.property === 'omit')) {
                    const owner = expressionReference(statement.initializer.object)
                    const key = statement.initializer.property === 'pick'
                        ? 'T'
                        : `Exclude<KeyOf<typeof<${owner}>>, T>`
                    printed.code = `const ${statement.name}: <T is KeyOf<typeof<${owner}>>>(T[]) -> {\n    [key: ${key}]: typeof<${owner}[key]>\n}`
                    description = `<T extends KeyOf<typeof<${owner}>>>(arg0: T[]) => {\n  [key: ${key}]: typeof<${owner}[key]>;\n}`
                }
                if (statement.type && isNamedType(resolveType(statement.type, env), 'any') && statement.initializer) {
                    printed.code += `\n(infer) ${printType(inferExpression(statement.initializer, env))}`
                }
                this.addHover(statement.name, statement.loc, printed.code, undefined, description)
                this.addTypeHint(statement.loc, statement.name, Boolean(statement.type), type)
                if (statement.type) this.walkType(statement.type, env)
                return
            }
            case 'Destructure': {
                this.walkExpression(statement.initializer, env)
                const source = inferExpression(statement.initializer, env)
                for (const binding of statement.bindings) {
                    const member = lookupMember(source, binding.name, env)
                    const type = member && !isFunctionSymbol(member) ? member : named('any')
                    const symbol: SymbolInfo = { kind: 'var', mutable: statement.mutable, type }
                    this.bind(env, binding.name, symbol)
                    this.addHover(binding.name, binding.loc, printSymbol(binding.name, symbol).code)
                    this.addTypeHint(binding.loc, binding.name, false, type)
                    if (!member) this.addDiagnostic(binding.loc, `Property '${binding.name}' does not exist on type '${printType(source)}'.`)
                }
                return
            }
            case 'ArrayDestructure': {
                this.walkExpression(statement.initializer, env)
                const source = inferExpression(statement.initializer, env)
                for (const binding of statement.bindings) {
                    if (!binding.name || binding.name === '_') continue
                    const type = binding.rest
                        ? arrayDestructureRestType(source, binding.index, env)
                        : indexedAccessType(source, { kind: 'LiteralType', value: binding.index }, env) ?? named('any')
                    const symbol: SymbolInfo = { kind: 'var', mutable: statement.mutable, type }
                    this.bind(env, binding.name, symbol)
                    this.addHover(binding.name, binding.loc, `${statement.mutable ? 'let' : 'const'} ${binding.name}: ${printType(type)}`, undefined, typeDescription(type, env))
                    this.addTypeHint(binding.loc, binding.name, false, type)
                }
                return
            }
            case 'FunctionDeclaration': {
                const genericEnv = new Map(env)
                ;(statement.generics ?? []).forEach((name, index) => genericEnv.set(name, {
                    kind: 'type', generics: [], value: statement.genericConstraints?.[index] ?? statement.genericDefaults?.[index] ?? named('any'), typeParameter: true
                }))
                const inferenceEnv = bindInferredParameters(statement.params, genericEnv)
                const returnType = statement.returnType ?? inferFunctionReturnType(statement.body, inferenceEnv, statement.params)
                const symbol: SymbolInfo = {
                    kind: 'fun', generics: statement.generics, genericConstraints: statement.genericConstraints,
                    genericDefaults: statement.genericDefaults, params: statement.params, returnType
                }
                statement.params.forEach((param, index) => {
                    if (!param.type && param.defaultValue !== undefined) symbol.params[index] = { ...param, type: (inferenceEnv.get(param.name) as Extract<SymbolInfo, { kind: 'var' }>).type }
                })
                this.bind(env, statement.name, symbol)
                const printed = printSymbol(statement.name, symbol)
                this.addHover(statement.name, statement.loc, printed.code, undefined, symbolTypeDescription(statement.name, symbol, env))
                ;(statement.generics ?? []).forEach((name, index) => {
                    this.addHover(name, statement.genericLocs?.[index], `(type parameter) ${name}`)
                    const constraint = statement.genericConstraints?.[index]
                    const defaultType = statement.genericDefaults?.[index]
                    if (constraint) this.walkType(constraint, env)
                    if (defaultType) {
                        this.walkType(defaultType, env)
                        if (constraint && !isAssignableTo(constraint, defaultType, env)) {
                            this.addDiagnostic(statement.genericLocs?.[index], `Default type '${printType(defaultType)}' does not satisfy constraint '${printType(constraint)}'.`)
                        }
                    }
                })
                const local = bindInferredParameters(statement.params, genericEnv)
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
            case 'ConstructorDeclaration': {
                this.walkType(statement.inheritedType, env)
                const constructorEnv = (params: Parameter[]): Env => {
                    const genericEnv = new Map(env)
                    statement.generics.forEach((name, index) => genericEnv.set(name, {
                        kind: 'type', generics: [], value: statement.genericConstraints?.[index] ?? statement.genericDefaults?.[index] ?? named('any'), typeParameter: true
                    }))
                    genericEnv.set(statement.name, { kind: 'type', generics: statement.generics, value: statement.inheritedType })
                    const local = bindInferredParameters(params, genericEnv)
                    if (statement.inheritedType.kind === 'GenericType') {
                        local.set(statement.inheritedType.name, { kind: 'type', generics: [], value: resolveType(statement.inheritedType, env) })
                    }
                    return local
                }
                const overloads = statement.overloads.map(overload => {
                    const local = constructorEnv(overload.params)
                    const returnType = overload.returnType ?? inferFunctionReturnType(overload.body, local, overload.params)
                    return { params: overload.params, returnType }
                })
                const methods = statement.methods.map(method => ({ name: method.name, generics: method.generics ?? [], genericConstraints: method.genericConstraints, genericDefaults: method.genericDefaults, params: method.params, returnType: method.returnType ?? inferFunctionReturnType(method.body, env, method.params) }))
                const symbol: SymbolInfo = { kind: 'constructor', generics: statement.generics, genericConstraints: statement.genericConstraints, genericDefaults: statement.genericDefaults, inheritedType: statement.inheritedType, overloads, methods }
                this.bind(env, statement.name, symbol)
                this.addHover(statement.name, statement.loc, printSymbol(statement.name, symbol).code, undefined, symbolTypeDescription(statement.name, symbol, env))
                statement.overloads.forEach((overload, index) => {
                    const local = constructorEnv(overload.params)
                    for (const param of overload.params) {
                        const type = (local.get(param.name) as Extract<SymbolInfo, { kind: 'var' }>).type
                        this.addHover(param.name, param.loc, parameterHover(param, type))
                        this.addTypeHint(param.loc, param.name, Boolean(param.type), type)
                        if (param.type) this.walkType(param.type, env)
                        if (param.defaultValue) this.walkExpression(param.defaultValue, local)
                    }
                    this.statements(overload.body, local)
                    const actual = overloads[index].returnType
                    const returnsSelf = actual.kind === 'NamedType' && actual.name === statement.name || actual.kind === 'GenericType' && actual.name === statement.name
                    if (statement.name !== 'Array' && !returnsSelf && !isAssignableTo(statement.inheritedType, actual, env)) {
                        this.addDiagnostic(statement.loc, `Constructor overload returns '${printType(actual)}', which is not assignable to inherited type '${printType(statement.inheritedType)}'.`)
                    }
                })
                statement.methods.forEach((method, index) => {
                    const methodInfo = methods[index]
                    const generics = printGenerics(methodInfo.generics, methodInfo.genericConstraints, methodInfo.genericDefaults)
                    this.addHover(method.name, method.loc, `(method) ${statement.name}.${method.name}${generics}(${method.params.map(printParam).join(', ')}): ${printType(methodInfo.returnType)}`, arrayMethodDescriptions[method.name])
                    const methodEnv = new Map(env)
                    methodInfo.generics.forEach((name, genericIndex) => methodEnv.set(name, { kind: 'type', generics: [], value: methodInfo.genericConstraints?.[genericIndex] ?? methodInfo.genericDefaults?.[genericIndex] ?? named('any'), typeParameter: true }))
                    const local = bindInferredParameters(method.params, methodEnv)
                    method.params.forEach(param => {
                        const type = (local.get(param.name) as Extract<SymbolInfo, { kind: 'var' }> | undefined)?.type ?? parameterType(param)
                        this.addHover(param.name, param.loc, param.name === '_' ? `(ignored parameter) _: ${printType(type)}` : parameterHover(param, type))
                        if (param.name !== '_') this.addTypeHint(param.loc, param.name, Boolean(param.type), type)
                    })
                    this.statements(method.body, local)
                })
                return
            }
            case 'Return':
                this.walkExpression(statement.value, env)
                return
            case 'Break':
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
                else if (statementsDefinitelyReturn(statement.consequent)) {
                    const continuation = this.narrowedConditionEnv(statement.condition, env, false)
                    for (const [name, symbol] of continuation) if (env.has(name)) env.set(name, symbol)
                }
                const guard = negatedMemberTypeGuard(statement.condition)
                if (!statement.alternate && guard && statement.consequent.some(item => item.kind === 'ExpressionStatement' && item.expression.kind === 'Assignment' && item.expression.name === guard.name)) {
                    const symbol = env.get(guard.name)
                    if (symbol?.kind === 'var') env.set(guard.name, { ...symbol, type: guard.type })
                }
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
                    if (symbol.kind === 'type' && symbol.generics.length === 0) printed.code += `\n(infer) ${printType(resolveType(type, env))}`
                    this.addHover(type.name, type.loc, printed.code, printed.docs, symbolTypeDescription(type.name, symbol, env))
                } else this.addHover(type.name, type.loc, `(type) ${type.name}`)
                return
            }
            case 'LiteralType':
                return
            case 'GenericType': {
                const symbol = env.get(type.name)
                if (['Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'KeyOf', 'Exclude'].includes(type.name)) {
                    const parameters = type.name === 'Pick' || type.name === 'Omit' || type.name === 'Exclude' ? '<T, U>' : type.name === 'KeyOf' ? '<T is object>' : '<T>'
                    const inferred = resolveType(type, env)
                    this.addHover(type.name, type.loc, `type ${type.name}${parameters}\n(infer) ${printType(inferred)}`, undefined, typeDescription(inferred, env))
                    if (type.name === 'KeyOf' && type.args[0]) {
                        const source = resolveType(type.args[0], env)
                        const objectLike = isNamedType(source, 'object') || source.kind === 'ObjectType' || source.kind === 'ArrayType' || source.kind === 'GenericType' && (source.name === 'Array' || source.name === 'ReadonlyArray')
                        if (!objectLike) this.addDiagnostic(type.args[0].loc, `Type '${printType(type.args[0])}' does not satisfy constraint 'object'.`)
                    }
                } else if (symbol && symbol.kind !== 'type') {
                    const printed = printSymbol(type.name, symbol)
                    this.addHover(type.name, type.loc, printed.code, printed.docs, symbolTypeDescription(type.name, symbol, env))
                } else {
                    const resolved = resolveType(type, env)
                    const short = `(type) ${printType(type)}`
                    this.addHover(type.name, type.loc, short, undefined, typeDescription(resolved, env))
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
            case 'IndexedAccessType': {
                this.walkType(type.object, env)
                this.walkType(type.index, env)
                const inferred = resolveType(type, env)
                this.addHover('[', type.loc, `(indexed access) ${printType(type)}\n(infer) ${printType(inferred)}`, undefined, typeDescription(inferred, env))
                return
            }
            case 'TypeOfType': {
                this.walkExpression(type.expression, env)
                const inferred = resolveType(type, env)
                this.addHover('typeof', type.loc, `type typeof<…>\n(infer) ${printType(inferred)}`, undefined, typeDescription(inferred, env))
                return
            }
            case 'ConditionalType':
                this.walkType(type.check, env)
                this.walkType(type.target, env)
                this.walkType(type.consequent, env)
                this.walkType(type.alternate, env)
                return
            case 'FunctionType':
                type.params.forEach(param => this.walkType(param, env))
                this.walkType(type.result, env)
                return
            case 'ObjectType':
                for (const member of type.members) {
                    if (!member.method || !member.body) continue
                    const local = new Map(env)
                    ;(member.generics ?? []).forEach((name, index) => local.set(name, { kind: 'type', generics: [], value: member.genericConstraints?.[index] ?? member.genericDefaults?.[index] ?? named('any'), typeParameter: true }))
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
                    const signature = member.indexType
                        ? `(index signature) [${member.name}: ${printType(member.indexType)}]: ${printType(member.type)}\n(infer) typeof<obj[${member.name}]> = ${printType(member.type)}`
                        : member.accessor === 'get'
                        ? `(getter) ${member.name}: ${printType(member.type)}`
                        : member.accessor === 'set'
                            ? `(setter) ${member.name}(${(member.params ?? []).map(printParam).join(', ')})`
                            : member.method
                                ? `(method) ${member.sealed ? 'sealed ' : ''}${member.name}${printGenerics(member.generics ?? [], member.genericConstraints, member.genericDefaults)}(${(member.params ?? []).map(printParam).join(', ')}): ${printType(member.type)}`
                                : `(property) ${member.readonly ? 'readonly ' : ''}${member.sealed ? 'sealed ' : ''}${member.name}${member.optional ? '?' : ''}: ${printType(member.type)}`
                    this.addHover(member.name, member.loc, signature)
                    const memberEnv = member.indexType ? new Map(env) : env
                    if (member.indexType) memberEnv.set(member.name, { kind: 'type', generics: [], value: resolveType(member.indexType, env) })
                    this.walkType(member.type, memberEnv)
                    if (member.method) {
                        ;(member.generics ?? []).forEach((name, index) => {
                            this.addHover(name, member.genericLocs?.[index], `(type parameter) ${name}`)
                            const constraint = member.genericConstraints?.[index]
                            const defaultType = member.genericDefaults?.[index]
                            if (constraint) this.walkType(constraint, env)
                            if (defaultType) {
                                this.walkType(defaultType, env)
                                if (constraint && !isAssignableTo(constraint, defaultType, env)) this.addDiagnostic(member.genericLocs?.[index], `Default type '${printType(defaultType)}' does not satisfy constraint '${printType(constraint)}'.`)
                            }
                        })
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
            case 'RegEx':
                this.addHover(`/${expression.source}/${expression.flags}`, expression.loc, `(RegEx) /${expression.source}/${expression.flags}`)
                return
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
                    this.addHover(expression.name, expression.loc, printed.code, printed.docs, symbolTypeDescription(expression.name, symbol, env))
                } else if (expression.loc) {
                    this.diagnostics.push({
                        line: expression.loc.line,
                        column: expression.loc.column,
                        length: expression.name.length,
                        message: `Cannot find name '${expression.name}'.`
                    })
                }
                return
            }
            case 'Array':
                expression.elements.forEach(item => this.walkExpression(item, env, thisType))
                if (expression.loc) this.hovers.push({
                    line: expression.loc.line,
                    column: expression.loc.column,
                    length: 1,
                    code: `(infer) ${printType(inferExpression(expression, env))}`
                })
                return
            case 'Spread': {
                this.walkExpression(expression.value, env, thisType)
                const source = inferExpression(expression.value, env)
                const element = spreadElementType(source, env)
                if (expression.loc) {
                    this.hovers.push({
                        line: expression.loc.line,
                        column: expression.loc.column,
                        length: 3,
                        code: element
                            ? `(spread) ${printType(source)}\n(infer) ${printType(element)}`
                            : `(spread) ${printType(source)}`
                    })
                    if (!element) this.diagnostics.push({
                        line: expression.loc.line,
                        column: expression.loc.column,
                        length: 3,
                        message: `Type '${printType(source)}' cannot be spread. Expected string, an array, or an object with toArray(): Array.`
                    })
                }
                return
            }
            case 'Assignment':
                if (!env.has(expression.name) && expression.loc) this.diagnostics.push({
                    line: expression.loc.line,
                    column: expression.loc.column,
                    length: expression.name.length,
                    message: `Cannot find name '${expression.name}'.`
                })
                this.walkExpression(expression.value, env, thisType)
                return
            case 'MemberAssignment':
                this.walkExpression(expression.object, env, thisType)
                if (expression.index?.kind === 'Literal') {
                    const objectType = inferExpression(expression.object, env)
                    const readonlyArray = objectType.kind === 'GenericType' && objectType.name === 'ReadonlyArray'
                    const resolved = objectType.kind === 'GenericType' && env.get(objectType.name)?.kind === 'constructor'
                        ? resolveType(instantiate((env.get(objectType.name) as Extract<SymbolInfo, { kind: 'constructor' }>).inheritedType, (env.get(objectType.name) as Extract<SymbolInfo, { kind: 'constructor' }>).generics, objectType.args), env)
                        : resolveType(objectType, env)
                    const readonlyMember = resolved.kind === 'ObjectType'
                        ? resolved.members.find(member => member.name === String(expression.index!.value) && member.readonly)
                        : resolved.kind === 'IntersectionType'
                            ? resolved.types.flatMap(part => part.kind === 'ObjectType' ? part.members : []).find(member => member.name === String(expression.index!.value) && member.readonly)
                            : undefined
                    if (readonlyArray || readonlyMember) this.addDiagnostic(expression.loc, `Cannot assign to readonly index '${String(expression.index.value)}'.`)
                    const sealedMember = resolved.kind === 'ObjectType'
                        ? resolved.members.find(member => member.name === String(expression.index!.value) && member.sealed)
                        : undefined
                    if (sealedMember) this.addDiagnostic(expression.loc, `Cannot override sealed member '${String(expression.index.value)}'.`)
                }
                if (expression.property) {
                    const objectType = inferExpression(expression.object, env)
                    const resolvedObject = resolveType(objectType, env)
                    const readonlyProperty = resolvedObject.kind === 'ObjectType'
                        ? resolvedObject.members.find(item => item.name === expression.property && item.readonly)
                        : undefined
                    if (readonlyProperty) this.addDiagnostic(expression.propertyLoc ?? expression.loc, `Cannot assign to readonly property '${expression.property}'.`)
                    const sealedProperty = resolvedObject.kind === 'ObjectType'
                        ? resolvedObject.members.find(item => item.name === expression.property && item.sealed)
                        : undefined
                    if (sealedProperty) this.addDiagnostic(expression.propertyLoc ?? expression.loc, `Cannot override sealed member '${expression.property}'.`)
                    const setter = lookupAccessor(objectType, expression.property, 'set', env)
                    const member = setter ?? lookupMember(objectType, expression.property, env)
                    const code = setter
                        ? `(setter) ${setter.name}(${(setter.params ?? []).map(printParam).join(', ')})`
                        : isFunctionSymbol(member)
                            ? `(method) ${expression.property}(${member.params.map(printParam).join(', ')}): ${printType(member.returnType)}`
                            : `(property) ${expression.property}: ${printType(member && !isFunctionSymbol(member) ? member : named('any'))}`
                    this.addHover(expression.property, expression.propertyLoc, code)
                }
                this.walkExpression(expression.value, env, thisType)
                return
            case 'Object': {
                const objectType = thisType ? resolveType(thisType, env) : inferExpression(expression, env)
                const methodEnv = new Map(env)
                const sealedMembers = new Set<string>()
                this.bind(methodEnv, 'this', { kind: 'var', mutable: false, type: objectType })
                for (const property of expression.properties) {
                    if (property.typeOnly) {
                        this.walkType(property.indexType!, env)
                        this.walkType(property.declaredType!, env)
                        continue
                    }
                    if (property.spread) {
                        const spreadType = resolveType(inferExpression(property.value, env), env)
                        const spreadMembers = spreadType.kind === 'ObjectType' ? spreadType.members : []
                        for (const member of spreadMembers) {
                            if (sealedMembers.has(member.name)) this.addDiagnostic(property.keyLoc, `Cannot override sealed member '${member.name}'.`)
                            if (member.sealed) sealedMembers.add(member.name)
                        }
                        this.walkExpression(property.value, env, thisType)
                        continue
                    }
                    if (sealedMembers.has(property.key)) this.addDiagnostic(property.keyLoc, `Cannot override sealed member '${property.key}'.`)
                    if (property.sealed) sealedMembers.add(property.key)
                    const member = lookupMember(objectType, property.key, env)
                    const code = isFunctionSymbol(member)
                        ? property.key === ''
                            ? `(call) ${printGenerics(member.generics ?? [], member.genericConstraints, member.genericDefaults)}(${member.params.map(printParam).join(', ')}): ${printType(member.returnType)}`
                            : `(method) ${property.sealed ? 'sealed ' : ''}${property.key}${printGenerics(member.generics ?? [], member.genericConstraints, member.genericDefaults)}(${member.params.map(printParam).join(', ')}): ${printType(member.returnType)}`
                        : `(property) ${property.key}: ${printType(member && !isFunctionSymbol(member) ? member : named('any'))}`
                    this.addHover(property.key, property.keyLoc, code)
                    if (property.key && property.keyLoc && isFunctionSymbol(member)) {
                        this.semanticTokens.push({
                            line: property.keyLoc.line,
                            column: property.keyLoc.column,
                            length: property.key.length,
                            type: 'method'
                        })
                    }
                    if (property.value.kind === 'Identifier' && property.key === property.value.name) {
                        const symbol = env.get(property.value.name)
                        if (symbol) {
                            const printed = printSymbol(property.value.name, symbol)
                            this.addHover(property.value.name, property.value.loc, printed.code, printed.docs)
                        } else this.walkExpression(property.value, env, thisType)
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
                const objectType = inferExpression(expression.object, env)
                const keyType = inferGenericExpression(expression.index, env)
                if (isNullable(objectType, env)) this.addDiagnostic(expression.loc, 'Cannot index a nullable value; use ! or ?? to handle null.')
                const resultType = indexedAccessType(objectType, keyType, env)
                // A mapped/generic index is validated through its type
                // constraint; it does not have a concrete key yet.
                const dependentKey = expression.index.kind === 'Identifier' && env.get(expression.index.name)?.kind === 'type'
                if (!resultType && !dependentKey) this.addDiagnostic(expressionStart(expression.index) ?? expression.loc, `Type '${printType(keyType)}' cannot be used to index type '${printType(objectType)}'.`)
                if (expression.loc) {
                    this.hovers.push({
                        line: expression.loc.line,
                        column: expression.loc.column,
                        length: 1,
                        code: `(index) ${printType(objectType)}[${printType(keyType)}]\n(infer) ${printType(resultType ?? named('any'))}`
                    })
                }
                return
            }
            case 'Member': {
                this.walkExpression(expression.object, env, thisType)
                if (expression.object.kind === 'Identifier') {
                    const constructor = env.get(expression.object.name)
                    const method = constructor?.kind === 'constructor' ? constructor.methods.find(item => item.name === expression.property) : undefined
                    if (method) {
                        const generics = printGenerics(method.generics, method.genericConstraints, method.genericDefaults)
                        this.addHover(expression.property, expression.loc, `(method) ${expression.object.name}.${method.name}${generics}(${method.params.map(printParam).join(', ')}): ${printType(method.returnType)}`, arrayMethodDescriptions[method.name])
                        return
                    }
                }
                const objectType = inferExpression(expression.object, env)
                const nullableObject = isNullable(objectType, env)
                const nonNullObjectType = removeNull(resolveType(objectType, env))
                const resolvedObjectType = resolveType(nonNullObjectType, env)
                const member = lookupMember(nonNullObjectType, expression.property, env)
                const assertedUniversalMember = expression.object.kind === 'Unary'
                    && expression.object.operator === 'postfix!'
                    && expression.property === 'toString'
                if (isNamedType(resolvedObjectType, 'any') && !['isType', 'has'].includes(expression.property) && !assertedUniversalMember) {
                    this.diagnostics.push({
                        line: expression.loc?.line ?? 1,
                        column: expression.loc?.column ?? 1,
                        length: expression.property.length,
                        message: `Cannot access '${expression.property}' on type 'any'; check the value with isType<T>() or has() first.`
                    })
                }
                if (nullableObject && !expression.optional && expression.property !== 'isType') this.diagnostics.push({ line: expression.loc?.line ?? 1, column: expression.loc?.column ?? 1, length: expression.property.length, message: `Cannot access '${expression.property}' on a nullable value; use ! or ?., or ?? to handle null.` })
                if (isFunctionSymbol(member)) {
                    const signature = expression.property === 'as'
                        ? '(method) as<T>(): T'
                        : `(method) ${expression.property}${printGenerics(member.generics ?? [], member.genericConstraints, member.genericDefaults)}(${member.params.map(printParam).join(', ')}): ${printType(member.returnType)}`
                    this.addHover(expression.property, expression.loc, signature, arrayMethodDescription(nonNullObjectType, expression.property, env))
                } else if (member) {
                    this.addHover(expression.property, expression.loc, `(property) ${expression.property}: ${printType(member)}`)
                } else if (nonNullObjectType.kind === 'GenericType' && (env.get(nonNullObjectType.name)?.kind === 'constructor' || nonNullObjectType.name === 'ReadonlyArray')) {
                    if (expression.loc) this.diagnostics.push({
                        line: expression.loc.line,
                        column: expression.loc.column,
                        length: expression.property.length,
                        message: `Property '${expression.property}' does not exist on type '${printType(nonNullObjectType)}'.`
                    })
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
                const directCallable = callableType(calleeType, env)
                const directFunction = expression.callee.kind === 'Identifier' ? env.get(expression.callee.name) : undefined
                const genericArguments = directFunction?.kind === 'fun' && directFunction.generics?.length
                    ? functionGenericArguments(directFunction, expression, env)
                    : undefined
                if (directFunction?.kind === 'fun' && genericArguments) {
                    directFunction.generics!.forEach((_name, index) => {
                        const constraint = directFunction.genericConstraints?.[index]
                        const argument = genericArguments[index]
                        if (constraint && argument && !isAssignableTo(constraint, argument, env)) {
                            const loc = expression.typeArguments?.[index]?.loc ?? expressionStart(expression.args[index] ?? expression.callee)
                            this.addDiagnostic(loc, `Type '${printType(argument)}' does not satisfy constraint '${printType(constraint)}'.`)
                        }
                    })
                    if (expression.callee.kind === 'Identifier' && expression.callee.loc) {
                        const hover = this.hovers.find(item => item.line === expression.callee.loc?.line && item.column === expression.callee.loc?.column)
                        if (hover) hover.code += `\n(infer) ${printGenericInference(directFunction.generics!, genericArguments)}\n(infer) return ${printType(inferExpression(expression, env))}`
                    }
                }
                const directType = expression.callee.kind === 'Identifier' ? env.get(expression.callee.name) : undefined
                if (directType?.kind === 'var' && directType.keyConstraint) {
                    for (const argument of expression.args) {
                        const argumentType = inferGenericExpression(argument.kind === 'Spread' ? argument.value : argument, env)
                        if (!isAssignableTo(directType.keyConstraint, argumentType, env)) {
                            const loc = expressionStart(argument)
                            if (loc) this.diagnostics.push({
                                line: loc.line,
                                column: loc.column,
                                length: argument.kind === 'Literal' && typeof argument.value === 'string' ? argument.value.length + 2 : 1,
                                message: `Type '${printType(argumentType)}' does not satisfy constraint '${printType(directType.keyConstraint)}'.`
                            })
                        }
                    }
                }
                if (directType?.kind === 'type' && directType.generics.length) {
                    const inferredType = inferExpression(expression, env)
                    const typeArguments = inferredType.kind === 'GenericType' ? inferredType.args : []
                    directType.generics.forEach((_name, index) => {
                        const constraint = directType.genericConstraints?.[index]
                        const argument = typeArguments[index]
                        if (constraint && argument && !isAssignableTo(constraint, argument, env)) this.addDiagnostic(expression.typeArguments?.[index]?.loc ?? expressionStart(expression.args[0] ?? expression.callee), `Type '${printType(argument)}' does not satisfy constraint '${printType(constraint)}'.`)
                    })
                    if (expression.callee.loc) {
                        const hover = this.hovers.find(item => item.line === expression.callee.loc?.line && item.column === expression.callee.loc?.column)
                        if (hover) hover.code += `\n(infer) ${printGenericInference(directType.generics, typeArguments)}\n(infer) return ${printType(inferredType)}`
                    }
                }
                if (directType?.kind === 'constructor' && directType.generics.length && expression.callee.kind === 'Identifier') {
                    const inferredType = inferExpression(expression, env)
                    const typeArguments = inferredType.kind === 'GenericType' ? inferredType.args : []
                    const hover = expression.callee.loc
                        ? this.hovers.find(item => item.line === expression.callee.loc?.line && item.column === expression.callee.loc?.column)
                        : undefined
                    if (hover) hover.code += `\n(infer) ${printGenericInference(directType.generics, typeArguments)}\n(infer) return ${printType(inferredType)}`
                }
                if (isNullable(calleeType, env) && !(expression.callee.kind === 'Member' && expression.callee.optional)) {
                    this.addDiagnostic(expressionStart(expression.callee), 'Cannot call a nullable value; use ! or ?? to handle null.')
                }
                if (calleeType.kind === 'UnionType') {
                    const optionalCall = expression.callee.kind === 'Member' && expression.callee.optional
                    const nonCallable = calleeType.types.find(part => {
                        const resolved = resolveType(part, env)
                        if (optionalCall && isNamedType(resolved, 'null')) return false
                        return !isNamedType(resolved, 'any') && !callableType(resolved, env)
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
                const constructorMethod = constructorMethodForCall(expression.callee, expression.args, env, expression.typeArguments)
                constructorMethod?.constraints.forEach((constraint, index) => {
                    const argument = constructorMethod.typeArguments[index]
                    if (constraint && argument && !isAssignableTo(constraint, argument, env)) {
                        this.addDiagnostic(expression.typeArguments?.[index]?.loc ?? expressionStart(expression.callee), `Type '${printType(argument)}' does not satisfy constraint '${printType(constraint)}'.`)
                    }
                })
                const genericMember = expression.callee.kind === 'Member'
                    ? lookupMember(inferExpression(expression.callee.object, env), expression.callee.property, env)
                    : undefined
                const genericMemberArguments = isFunctionSymbol(genericMember) && genericMember.generics?.length
                    ? functionGenericArguments({ kind: 'fun', generics: genericMember.generics, genericConstraints: genericMember.genericConstraints, genericDefaults: genericMember.genericDefaults, params: genericMember.params, returnType: genericMember.returnType }, expression, env)
                    : undefined
                if (isFunctionSymbol(genericMember) && genericMemberArguments) genericMember.generics!.forEach((_name, index) => {
                    const constraint = genericMember.genericConstraints?.[index]
                    const argument = genericMemberArguments[index]
                    if (constraint && argument && !isAssignableTo(constraint, argument, env)) this.addDiagnostic(expression.typeArguments?.[index]?.loc ?? expressionStart(expression.callee), `Type '${printType(argument)}' does not satisfy constraint '${printType(constraint)}'.`)
                })
                if (expression.callee.kind === 'Member' && expression.callee.loc) {
                    const hover = this.hovers.find(item => item.line === expression.callee.loc?.line && item.column === expression.callee.loc?.column && item.code.startsWith('(method)'))
                    if (hover) {
                        const inference = constructorMethod
                            ? printGenericInference(constructorMethod.generics, constructorMethod.typeArguments)
                            : isFunctionSymbol(genericMember) && genericMemberArguments
                                ? printGenericInference(genericMember.generics!, genericMemberArguments)
                                : undefined
                        if (inference) hover.code += `\n(infer) ${inference}`
                        hover.code += `\n(infer) return ${printType(inferExpression(expression, env))}`
                    }
                }
                const genericFunctionParameters = directFunction?.kind === 'fun' && genericArguments
                    ? directFunction.params.map(param => ({ ...param, type: param.type ? instantiate(param.type, directFunction.generics!, genericArguments) : undefined }))
                    : undefined
                const genericMemberParameters = isFunctionSymbol(genericMember) && genericMemberArguments
                    ? genericMember.params.map(param => ({ ...param, type: param.type ? instantiate(param.type, genericMember.generics!, genericMemberArguments) : undefined }))
                    : undefined
                const methodParameters = genericFunctionParameters ?? constructorMethod?.params ?? genericMemberParameters ?? (expression.callee.kind === 'Member'
                    ? (() => {
                        const member = lookupMember(inferExpression(expression.callee.object, env), expression.callee.property, env)
                        return isFunctionSymbol(member) ? member.params : undefined
                    })()
                    : undefined)
                expression.args.forEach((arg, index) => {
                    const contextualType = methodParameters?.[index]
                        ? parameterType(methodParameters[index])
                        : directCallable?.params[index]
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
        case 'Match':
            this.walkExpression(expression.value, env, thisType)
            for (const item of expression.cases) {
                const local = matchCaseEnv(expression, item.pattern, env)
                if (item.guard) this.walkExpression(item.guard, local, thisType)
                this.statements(item.body, local)
                for (const [name, symbol] of local) if (!env.has(name) && symbol.kind === 'var') {
                    const property = item.pattern?.kind === 'PatternObject'
                        ? item.pattern.properties.find(candidate => candidate.name === name)
                        : undefined
                    this.addHover(name, property?.loc, `const ${name}: ${printType(symbol.type)}`, undefined, typeDescription(symbol.type, local))
                }
            }
            return
        case 'Try':
            if (expression.body) this.statements(expression.body, new Map(env))
            else this.walkExpression(expression.value, env, thisType)
            const trySource = resolveType(expression.body
                ? inferFunctionReturnType(expression.body, env)
                : inferExpression(expression.value!, env), env)
            const tryParts = (trySource.kind === 'UnionType' ? trySource.types : [trySource]).map(part => resolveType(part, env))
            const errorTypes = tryParts.flatMap(part => part.kind === 'ObjectType'
                ? part.members.filter(member => member.name === 'error').map(member => member.type)
                : [])
            const inferredError = errorTypes.length ? unionOf(errorTypes) : named('Error')
            for (const clause of expression.catches) {
                const local = new Map(env)
                if (clause.binding) {
                    const type = clause.type ?? inferredError
                    local.set(clause.binding, { kind: 'var', mutable: false, type })
                    this.addHover(clause.binding, clause.bindingLoc, `const ${clause.binding}: ${printType(type)}`)
                }
                if (clause.type) this.walkType(clause.type, env)
                this.statements(clause.body, local)
            }
            if (expression.finallyBody) this.statements(expression.finallyBody, new Map(env))
            this.addHover('try', expression.loc, `(try expression) ${printType(inferExpression(expression, env))}`)
            return
        case 'Is':
            this.walkExpression(expression.value, env, thisType)
            this.walkType(expression.type, env)
            return
        }
    }

    private walkFunction(expression: Extract<Expression, { kind: 'Function' }>, env: Env, contextualType?: TypeNode): void {
        const genericEnv = new Map(env)
        ;(expression.generics ?? []).forEach((name, index) => {
            const constraint = expression.genericConstraints?.[index]
            const defaultType = expression.genericDefaults?.[index]
            genericEnv.set(name, { kind: 'type', generics: [], value: constraint ?? defaultType ?? named('any'), typeParameter: true })
            this.addHover(name, expression.genericLocs?.[index], `(type parameter) ${name}${constraint ? ` is ${printType(constraint)}` : ''}${defaultType ? ` = ${printType(defaultType)}` : ''}`)
            if (constraint) this.walkType(constraint, env)
            if (defaultType) {
                this.walkType(defaultType, env)
                if (constraint && !isAssignableTo(constraint, defaultType, env)) this.addDiagnostic(expression.genericLocs?.[index], `Default type '${printType(defaultType)}' does not satisfy constraint '${printType(constraint)}'.`)
            }
        })
        const local = bindInferredParameters(expression.params, genericEnv)
        const contextual = contextualType ? removeNull(resolveType(contextualType, env)) : undefined
        if (contextual?.kind === 'FunctionType') expression.params.forEach((param, index) => {
            if (!param.type && contextual.params[index]) local.set(param.name, { kind: 'var', mutable: true, type: contextual.params[index] })
        })
        for (const [index, param] of expression.params.entries()) {
            const contextualParameter = contextual?.kind === 'FunctionType' ? contextual.params[index] : undefined
            const type = contextualParameter ?? (local.get(param.name) as Extract<SymbolInfo, { kind: 'var' }>).type
            if (!param.type && param.defaultValue !== undefined) {
                const index = expression.params.indexOf(param)
                expression.params[index] = { ...param, type }
            }
            this.addHover(param.name, param.loc, param.name === '_' ? `(ignored parameter) _: ${printType(type)}` : parameterHover(param, type))
            if (param.name !== '_') this.addTypeHint(param.loc, param.name, Boolean(param.type), type, 'callbackType')
            if (param.type) this.walkType(param.type, local)
            if (param.defaultValue) this.walkExpression(param.defaultValue, local)
        }
        if (expression.returnType) this.walkType(expression.returnType, local)
        if (expression.expressionBody) this.walkExpression(expression.expressionBody, local)
        else this.statements(expression.body, local)
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
        case 'RegEx':
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

function expressionReference(expression: Expression): string {
    if (expression.kind === 'Identifier') return expression.name
    if (expression.kind === 'Member') return `${expressionReference(expression.object)}${expression.optional ? '?.' : '.'}${expression.property}`
    if (expression.kind === 'Index') {
        const index = expression.index.kind === 'Identifier'
            ? expression.index.name
            : expression.index.kind === 'Literal'
                ? JSON.stringify(expression.index.value)
                : '…'
        return `${expressionReference(expression.object)}[${index}]`
    }
    return 'object'
}

export function analyze(source: string, filePath?: string): { hovers: HoverInfo[]; hints: InlayHintInfo[]; diagnostics: DiagnosticInfo[]; semanticTokens: SemanticTokenInfo[] } | undefined {
    try {
        const analyzer = new Analyzer()
        const statements = parse(source, { validate: false, filePath })
        const imported = importedDeclarations(statements, filePath)
        const stringifyForTypeSearch = (value: unknown): string => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? `${item}n` : item)
        const needsIterable = stringifyForTypeSearch(statements).includes('Iterable')
            || stringifyForTypeSearch([...imported]).includes('Iterable')
        if (needsIterable) {
            const fs = require('node:fs') as typeof import('node:fs')
            const path = require('node:path') as typeof import('node:path')
            let directory = path.dirname(path.resolve(filePath ?? process.cwd()))
            let iterablePath: string | undefined
            while (true) {
                const candidate = path.join(directory, 'types', 'iterable.jn')
                if (fs.existsSync(candidate)) { iterablePath = candidate; break }
                const parent = path.dirname(directory)
                if (parent === directory) break
                directory = parent
            }
            iterablePath ??= path.resolve(__dirname, '../../types/iterable.jn')
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
        return { hovers: analyzer.hovers, hints: analyzer.hints, diagnostics: analyzer.diagnostics, semanticTokens: analyzer.semanticTokens }
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

export function exportsForFile(filePath: string): { name: string; detail: string }[] {
    try {
        const fs = require('node:fs') as typeof import('node:fs')
        const source = fs.readFileSync(filePath, 'utf8')
        const declarations = /\.jn$/i.test(filePath)
            ? importedDeclarations(parse(source, { validate: false, filePath }), filePath)
            : hostDeclarations(source)
        return [...declarations].map(([name, symbol]) => ({
            name,
            detail: printSymbol(name, symbol as SymbolInfo).code
        })).sort((left, right) => left.name.localeCompare(right.name))
    } catch { return [] }
}

