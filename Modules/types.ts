/** TypeScript utility types re-exported as a module for project consumers. */
import type { TypeMember, TypeNode } from '../Lexer/parser'

export type Partial<T> = { [P in keyof T]?: T[P] }
export type Required<T> = { [P in keyof T]-?: T[P] }
export type Readonly<T> = { readonly [P in keyof T]: T[P] }
export type KeyOf<T extends object> = keyof T

export type Pick<T, K extends keyof T> = { [P in K]: T[P] }
export type Record<K extends keyof any, T> = { [P in K]: T }
export type Exclude<T, U> = T extends U ? never : T
export type Extract<T, U> = T extends U ? T : never
export type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>

export type NonNullable<T> = Exclude<T, null | undefined>

export type Parameters<T extends (...args: any[]) => any> = T extends (...args: infer P) => any ? P : never
export type ConstructorParameters<T extends abstract new (...args: any[]) => any> =
    T extends abstract new (...args: infer P) => any ? P : never
export type ReturnType<T extends (...args: any[]) => any> = T extends (...args: any[]) => infer R ? R : any
export type InstanceType<T extends abstract new (...args: any[]) => any> =
    T extends abstract new (...args: any[]) => infer R ? R : any

export type ThisParameterType<T> = T extends (this: infer U, ...args: any[]) => any ? U : unknown
export type OmitThisParameter<T> = unknown extends ThisParameterType<T>
    ? T
    : T extends (this: any, ...args: infer A) => infer R
        ? (...args: A) => R
        : T
export type ThisType<T> = {}

export type Awaited<T> = T extends null | undefined
    ? T
    : T extends object & { then(onfulfilled: infer F, ...args: any[]): any }
        ? F extends (value: infer V, ...args: any[]) => any
            ? Awaited<V>
            : never
        : T

type RuntimeTypeInput = {
    __junoTypeConstructor?: true
    __junoTypeDescriptor?: true
    typeNode?: TypeNode
}

function typeNodeOf(input: unknown): TypeNode {
    const node = (input as RuntimeTypeInput | null)?.typeNode
    if (node && typeof node === 'object' && 'kind' in node) return node
    throw new TypeError('Expected a Juno type declaration or a runtime type descriptor')
}

function descriptor(typeNode: TypeNode): RuntimeTypeInput {
    return { __junoTypeDescriptor: true, typeNode }
}

function transformMembers(typeNode: TypeNode, transform: (members: TypeMember[]) => TypeMember[]): TypeNode {
    if (typeNode.kind === 'ObjectType') return { ...typeNode, members: transform(typeNode.members) }
    if (typeNode.kind === 'UnionType' || typeNode.kind === 'IntersectionType') {
        return { ...typeNode, types: typeNode.types.map(part => transformMembers(part, transform)) }
    }
    throw new TypeError(`Utility type requires an object type; received ${typeNode.kind}`)
}

function keyLiteral(name: string): TypeNode {
    const numeric = Number(name)
    return { kind: 'LiteralType', value: name !== '' && Number.isFinite(numeric) && String(numeric) === name ? numeric : name }
}

function keyType(typeNode: TypeNode): TypeNode {
    if (typeNode.kind === 'ArrayType' || typeNode.kind === 'GenericType' && (typeNode.name === 'Array' || typeNode.name === 'ReadonlyArray')) {
        const names = ['length', 'indices', 'has', 'pick', 'omit', 'at', 'concat', 'copy', 'copyWithin', 'entries', 'enumerate', 'every', 'fill', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flat', 'flatMap', 'forEach', 'includes', 'indexOf', 'iterator', 'join', 'lastIndexOf', 'map', 'pop', 'push', 'reduce', 'reduceRight', 'reverse', 'shift', 'slice', 'some', 'sort', 'splice', 'toArray', 'toReversed', 'toSorted', 'toSpliced', 'toString', 'unshift', 'with']
        return { kind: 'UnionType', types: [{ kind: 'NamedType', name: 'number' }, ...names.map(name => ({ kind: 'LiteralType', value: name } as TypeNode))] }
    }
    if (typeNode.kind === 'ObjectType') {
        const keys = typeNode.members.flatMap(member => member.indexType ? [member.indexType] : [keyLiteral(member.name)])
        return keys.length === 1 ? keys[0] : { kind: 'UnionType', types: keys }
    }
    if (typeNode.kind === 'UnionType' || typeNode.kind === 'IntersectionType') {
        const keys = typeNode.types.map(keyType)
        return keys.length === 1 ? keys[0] : { kind: 'UnionType', types: keys }
    }
    throw new TypeError(`KeyOf requires an object or array type; received ${typeNode.kind}`)
}

function excludeType(source: TypeNode, excluded: TypeNode): TypeNode {
    const excludedParts = excluded.kind === 'UnionType' ? excluded.types : [excluded]
    const parts = source.kind === 'UnionType' ? source.types : [source]
    const remaining = parts.filter(part => !excludedParts.some(item => JSON.stringify(item) === JSON.stringify(part)))
    return remaining.length === 1 ? remaining[0] : remaining.length ? { kind: 'UnionType', types: remaining } : { kind: 'NamedType', name: 'never' }
}

function keysFrom(value: unknown): Set<string> {
    if (Array.isArray(value) && value.every(key => typeof key === 'string')) return new Set(value)
    const node = (value as RuntimeTypeInput | null)?.typeNode
    if (node?.kind === 'LiteralType' && typeof node.value === 'string') return new Set([node.value])
    if (node?.kind === 'UnionType') {
        const keys = new Set<string>()
        for (const part of node.types) {
            if (part.kind !== 'LiteralType' || typeof part.value !== 'string') throw new TypeError('Utility type keys must be string literal types')
            keys.add(part.value)
        }
        return keys
    }
    throw new TypeError('Utility type keys must be string literals or an array of strings')
}

export const Partial = (input: unknown) => descriptor(transformMembers(typeNodeOf(input), members => members.map(member => ({ ...member, optional: true }))))
export const Required = (input: unknown) => descriptor(transformMembers(typeNodeOf(input), members => members.map(member => ({ ...member, optional: false }))))
export const Readonly = (input: unknown) => descriptor(transformMembers(typeNodeOf(input), members => members.map(member => ({ ...member, readonly: true }))))
export const KeyOf = (input: unknown) => descriptor(keyType(typeNodeOf(input)))
export const Exclude = (input: unknown, excluded: unknown) => descriptor(excludeType(typeNodeOf(input), typeNodeOf(excluded)))
export const Pick = (input: unknown, keys: unknown) => {
    const selected = keysFrom(keys)
    return descriptor(transformMembers(typeNodeOf(input), members => members.filter(member => selected.has(member.name))))
}
export const Omit = (input: unknown, keys: unknown) => {
    const removed = keysFrom(keys)
    return descriptor(transformMembers(typeNodeOf(input), members => members.filter(member => !removed.has(member.name))))
}

export const types = { Partial, Required, Readonly, Pick, Omit, KeyOf, Exclude }
export default types
