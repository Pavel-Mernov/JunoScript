/** TypeScript declarations exported by interop.jn for arbitrary-extension imports. */

export type Profile = {
    name: string
    scores: number[]
    active: boolean
    metadata: {
        source: string
        version: number
    }
}

export interface TsProfileConstructor {
    (name: string, ...scores: number[]): Profile
}

export const TsProfile: TsProfileConstructor
