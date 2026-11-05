import juno from './juno'
import junoNode from './juno-node'
import types from './types'

export type {
    Awaited,
    ConstructorParameters,
    Exclude,
    Extract,
    InstanceType,
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
export type { Error } from './juno'
export type { Iterable } from './juno-types'

/** Runtime module table used to resolve JunoScript import specifiers. */
export const modules = {
    juno,
    'juno:node': junoNode,
    types
} as const

export type ModuleName = keyof typeof modules

export function resolveModule(name: string): (typeof modules)[ModuleName] {
    if (name !== 'juno' && name !== 'juno:node' && name !== 'types') {
        throw new Error(`Unknown JunoScript module '${name}'`)
    }
    return modules[name]
}
