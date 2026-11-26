import juno from './juno'
import junoNode from './juno-node'
import types from './types'
import async from './async'
import fs from './juno-node-fs'
import test from './juno-test'

export type {
    Awaited,
    ConstructorParameters,
    Exclude,
    Extract,
    InstanceType,
    KeyOf,
    NonNullable,
    Omit,
    OmitThisParameter,
    Parameters,
    Partial,
    Pick,
    Readonly,
    Record,
    Required,
    ReturnType,
    ThisParameterType,
    ThisType
} from './types'
export { Range } from './juno'
export type { Error } from './juno'
export type { Iterable } from './juno-types'

/** Runtime module table used to resolve JunoScript import specifiers. */
export const modules = {
    juno,
    'juno:node': junoNode,
    'juno:types': types,
    'juno:async': async,
    'juno:node:fs': fs,
    'juno:test': test,
    types
} as const

export type ModuleName = keyof typeof modules

export function resolveModule(name: string): (typeof modules)[ModuleName] {
    if (name !== 'juno' && name !== 'juno:node' && name !== 'juno:types' && name !== 'juno:async' && name !== 'juno:node:fs' && name !== 'juno:test' && name !== 'types') {
        throw new Error(`Unknown JunoScript module '${name}'`)
    }
    return modules[name]
}
