/** Standard JunoScript console module; mirrors the JavaScript/TypeScript console. */
import { types } from './types'
import type { TypeNode } from '../Lexer/parser'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Lexer } from '../Lexer/lexer'
import { Parser } from '../Lexer/parser'

export const console = globalThis.console
export { types }
export type { Iterable } from './juno-types'

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
    Error
}

// Parse the JunoScript declaration so runtime JN imports use the same type AST.
const iterableSource = readFileSync(resolve(__dirname, '../../iterable.jn'), 'utf8')
const iterableDeclaration = new Parser(Lexer(iterableSource).tokenize()).parse().find(statement =>
    statement.kind === 'Export' && statement.declaration.kind === 'TypeDeclaration' && statement.declaration.name === 'Iterable'
)
if (!iterableDeclaration || iterableDeclaration.kind !== 'Export' || iterableDeclaration.declaration.kind !== 'TypeDeclaration') {
    throw new Error("iterable.jn must export type 'Iterable'")
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
