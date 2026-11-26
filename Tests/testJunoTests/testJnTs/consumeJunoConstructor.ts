import type {
    Profile,
    TsProfileConstructor
} from './interop.jn'

type JunoModule = typeof import('./interop.jn')
type ExportedConstructor = JunoModule['TsProfile']
type ExportedInstance = ReturnType<ExportedConstructor>

const acceptsJunoConstructor = (constructor: TsProfileConstructor): Profile =>
    constructor('TypeScript', 10, 20, 30)

declare const TsProfile: ExportedConstructor

const profile: ExportedInstance = acceptsJunoConstructor(TsProfile)
const name: string = profile.name
const scores: number[] = profile.scores
const active: boolean = profile.active
const source: string = profile.metadata.source
const version: number = profile.metadata.version

export type {
    ExportedConstructor,
    ExportedInstance
}

export {
    profile,
    name,
    scores,
    active,
    source,
    version
}
