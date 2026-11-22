export type NativeProfile = {
    name: string
    scores: number[]
    active: boolean
    metadata: { source: string; version: number }
}

export function createProfile(name: string, scores: number[]): NativeProfile {
    return {
        name,
        scores,
        active: scores.length > 0,
        metadata: { source: 'TypeScript', version: 1 }
    }
}

export function formatValue(value: string | number | null): string {
    return value === null ? 'null' : `[${String(value)}]`
}

export function scaleNumbers(values: number[], factor: number): number[] {
    return values.map(value => value * factor)
}

export function applyMapper(values: any[], mapper: any): any[] {
    return values.map((value, index) => mapper(value, index))
}

const moduleInfo = { label: 'JN/TS interop', version: 1 }
export const { label, version } = moduleInfo

export const nestedValue = {
    owner: { name: 'Juno' },
    flags: ['typed', 'native'],
    optional: null as string | null
}

export const nativeIterable = new Set([2, 4, 6])

export function createNativeIterable(): Iterable<number> {
    return nativeIterable
}

export function collectIterable(values: Iterable<unknown>): unknown[] {
    return [...values]
}
