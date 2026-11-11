/** Standard JunoScript console module; mirrors the JavaScript/TypeScript console. */
import { types } from './types'
import type { TypeNode } from '../Lexer/parser'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Lexer } from '../Lexer/lexer'
import { Parser } from '../Lexer/parser'
import type { Iterable } from './juno-types'

export const console = globalThis.console
export { types }
export type { Iterable } from './juno-types'

export type Range = Iterable<number> & {
    readonly start: number
    readonly end: number
    readonly step: number
}

/** TypeScript entry point matching the JunoScript Range constructor. */
export function Range(start: number, end?: number, step = 1): Range {
    if (end === undefined) [start, end] = [0, start]
    const first = start
    const last = end
    const values = (): number[] => {
        const result: number[] = []
        if (step > 0) for (let value = first; value < last; value += step) result.push(value)
        else if (step < 0) for (let value = first; value > last; value += step) result.push(value)
        return result
    }
    return {
        start: first,
        end: last,
        step,
        iterator: () => {
            const items = values()
            let index = 0
            return () => index < items.length ? { value: items[index++] } : null
        },
        toArray: values
    } as Range
}

/** TypeScript-compatible error shape for values thrown or returned by Juno code. */
export type Error = {
    name: string
    message: string
    stack?: string
}

const juno: Record<string, any> = { 
    console,
    Math,
    types,
    Error,
    Range
}

// Parse the JunoScript declaration so runtime JN imports use the same type AST.
const iterableSource = readFileSync(resolve(__dirname, '../../types/iterable.jn'), 'utf8')
const iterableDeclaration = new Parser(Lexer(iterableSource).tokenize()).parse().find(statement =>
    statement.kind === 'Export' && statement.declaration.kind === 'TypeDeclaration' && statement.declaration.name === 'Iterable'
)
if (!iterableDeclaration || iterableDeclaration.kind !== 'Export' || iterableDeclaration.declaration.kind !== 'TypeDeclaration') {
    throw new Error("types/iterable.jn must export type 'Iterable'")
}
const iterableType: TypeNode = iterableDeclaration.declaration.value
const junoTypes: Record<string, { value: TypeNode; generics: string[] }> = {
    Error: { value: { kind: 'ObjectType', members: [
        { name: 'name', type: { kind: 'NamedType', name: 'string' }, optional: false, readonly: false, constant: false },
        { name: 'message', type: { kind: 'NamedType', name: 'string' }, optional: false, readonly: false, constant: false },
        { name: 'stack', type: { kind: 'NamedType', name: 'string' }, optional: true, readonly: false, constant: false }
    ] }, generics: [] },
    Iterable: { value: iterableType, generics: iterableDeclaration.declaration.generics }
}
for (const [name, alias] of Object.entries(junoTypes)) juno[name] = {
    __junoTypeConstructor: true,
    typeName: name,
    typeNode: alias.value,
    generics: alias.generics
}
Object.defineProperty(juno, '__junoTypes', { value: junoTypes, enumerable: false })
export default juno
