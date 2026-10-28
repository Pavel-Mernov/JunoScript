import juno from './juno'
import junoNode from './juno-node'

/** Runtime module table used to resolve JunoScript import specifiers. */
export const modules = {
    juno,
    'juno:node': junoNode
} as const

export type ModuleName = keyof typeof modules

export function resolveModule(name: string): (typeof modules)[ModuleName] {
    if (name !== 'juno' && name !== 'juno:node') {
        throw new Error(`Unknown JunoScript module '${name}'`)
    }
    return modules[name]
}
