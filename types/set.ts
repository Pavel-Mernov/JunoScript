export type JunoSet<T> = {
    readonly length: number
    includes(value: T): boolean
    add(value: T): JunoSet<T>
    delete(value: T): boolean
    clear(): void
    iterator(): () => ({ value: T } | null)
}

/** SameValueZero for primitives and structural equality for Juno objects. */
export function junoEqual(left: unknown, right: unknown, seen = new WeakMap<object, WeakSet<object>>()): boolean {
    if (left === right) return true
    if (typeof left === 'number' && typeof right === 'number' && Number.isNaN(left) && Number.isNaN(right)) return true
    if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false
    if (Array.isArray(left) !== Array.isArray(right)) return false

    let compared = seen.get(left)
    if (compared?.has(right)) return true
    if (!compared) {
        compared = new WeakSet<object>()
        seen.set(left, compared)
    }
    compared.add(right)

    const leftRecord = left as Record<string, unknown>
    const rightRecord = right as Record<string, unknown>
    const structuralKeys = (record: Record<string, unknown>): string[] => Object.keys(record).filter(key =>
        !(key === 'toString' && typeof record[key] === 'function' && (record[key] as { __junoDefaultToString?: boolean }).__junoDefaultToString)
    )
    const leftKeys = structuralKeys(leftRecord)
    const rightKeys = structuralKeys(rightRecord)
    return leftKeys.length === rightKeys.length && leftKeys.every(key =>
        Object.prototype.hasOwnProperty.call(rightRecord, key) &&
        junoEqual(leftRecord[key], rightRecord[key], seen)
    )
}

const functionIds = new WeakMap<object, number>()
const symbolIds = new Map<symbol, number>()
let nextIdentityId = 1

function identityId(value: object | symbol): number {
    if (typeof value === 'symbol') {
        const current = symbolIds.get(value)
        if (current !== undefined) return current
        const created = nextIdentityId++
        symbolIds.set(value, created)
        return created
    }
    const current = functionIds.get(value)
    if (current !== undefined) return current
    const created = nextIdentityId++
    functionIds.set(value, created)
    return created
}

/** Equal Juno values always produce the same hash. */
export function structuralHash(value: unknown): string {
    const seen = new Map<object, number>()
    const visit = (item: unknown): string => {
        if (item === null) return 'null'
        switch (typeof item) {
            case 'undefined': return 'undefined'
            case 'boolean': return item ? 'boolean:1' : 'boolean:0'
            case 'number': return Number.isNaN(item) ? 'number:NaN' : `number:${item === 0 ? 0 : item}`
            case 'bigint': return `bigint:${item}`
            case 'string': return `string:${JSON.stringify(item)}`
            case 'symbol': return `symbol:${identityId(item)}`
            case 'function': return `function:${identityId(item)}`
        }

        const object = item as Record<string, unknown>
        const reference = seen.get(object)
        if (reference !== undefined) return `ref:${reference}`
        seen.set(object, seen.size)
        const keys = Object.keys(object).filter(key =>
            !(key === 'toString' && typeof object[key] === 'function' && (object[key] as { __junoDefaultToString?: boolean }).__junoDefaultToString)
        ).sort()
        return `${Array.isArray(object) ? 'array' : 'object'}:{${keys.map(key => `${JSON.stringify(key)}:${visit(object[key])}`).join(',')}}`
    }
    return visit(value)
}

export function globalSet<T>(...initialItems: T[]): JunoSet<T> {
    type Entry = { value: T; hash: string; active: boolean }
    const order: Entry[] = []
    const buckets = new Map<string, Set<Entry>>()
    const identities = new WeakMap<object, Entry>()
    let activeLength = 0

    const addToBucket = (entry: Entry): void => {
        let bucket = buckets.get(entry.hash)
        if (!bucket) buckets.set(entry.hash, bucket = new Set<Entry>())
        bucket.add(entry)
    }
    const removeFromBucket = (entry: Entry): void => {
        const bucket = buckets.get(entry.hash)
        bucket?.delete(entry)
        if (bucket?.size === 0) buckets.delete(entry.hash)
    }
    const refreshIdentity = (value: T): Entry | undefined => {
        if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return undefined
        const entry = identities.get(value as object)
        if (!entry?.active) return undefined
        const hash = structuralHash(value)
        if (hash !== entry.hash) {
            removeFromBucket(entry)
            entry.hash = hash
            addToBucket(entry)
        }
        return entry
    }
    const find = (value: T): Entry | undefined => {
        const identical = refreshIdentity(value)
        if (identical) return identical
        const bucket = buckets.get(structuralHash(value))
        if (!bucket) return undefined
        for (const entry of bucket) if (entry.active && junoEqual(entry.value, value)) return entry
        return undefined
    }

    const result: JunoSet<T> = {
        get length(): number { return activeLength },
        includes(value: T): boolean { return find(value) !== undefined },
        add(value: T): JunoSet<T> {
            if (find(value)) return result
            const entry: Entry = { value, hash: structuralHash(value), active: true }
            order.push(entry)
            addToBucket(entry)
            if ((typeof value === 'object' && value !== null) || typeof value === 'function') identities.set(value as object, entry)
            activeLength++
            return result
        },
        delete(value: T): boolean {
            const entry = find(value)
            if (!entry) return false
            entry.active = false
            removeFromBucket(entry)
            if ((typeof entry.value === 'object' && entry.value !== null) || typeof entry.value === 'function') identities.delete(entry.value as object)
            activeLength--
            return true
        },
        clear(): void {
            for (const entry of order) entry.active = false
            order.length = 0
            buckets.clear()
            activeLength = 0
        },
        iterator(): () => ({ value: T } | null) {
            let index = 0
            return () => {
                while (index < order.length) {
                    const entry = order[index++]
                    if (entry.active) return { value: entry.value }
                }
                return null
            }
        }
    }
    for (const item of initialItems) result.add(item)
    return result
}

export function immutableSnapshot<T>(value: T): T {
    const clones = new WeakMap<object, any>()
    const clone = (item: any): any => {
        if (item === null || typeof item !== 'object' || item.__junoFunction || item.__junoConstructor) return item
        const existing = clones.get(item)
        if (existing) return existing
        const copy: any = Array.isArray(item) ? [] : Object.create(Object.getPrototypeOf(item))
        clones.set(item, copy)
        for (const key of Reflect.ownKeys(item)) {
            const descriptor = Object.getOwnPropertyDescriptor(item, key)
            if (!descriptor) continue
            if ('value' in descriptor) descriptor.value = clone(descriptor.value)
            Object.defineProperty(copy, key, descriptor)
        }
        return copy
    }
    const seen = new WeakSet<object>()
    const freeze = (item: any): any => {
        if (item === null || typeof item !== 'object' || item.__junoFunction || item.__junoConstructor || seen.has(item)) return item
        seen.add(item)
        for (const key of Reflect.ownKeys(item)) {
            const descriptor = Object.getOwnPropertyDescriptor(item, key)
            if (descriptor && 'value' in descriptor) freeze(descriptor.value)
        }
        return Object.freeze(item)
    }
    return freeze(clone(value))
}

/** A structural set that stores immutable snapshots, keeping hashes stable. */
export function globalValueSet<T>(...initialItems: T[]): JunoSet<T> {
    const storage = globalSet<T>()
    const result: JunoSet<T> = {
        get length(): number { return storage.length },
        includes(value: T): boolean { return storage.includes(value) },
        add(value: T): JunoSet<T> {
            if (!storage.includes(value)) storage.add(immutableSnapshot(value))
            return result
        },
        delete(value: T): boolean { return storage.delete(value) },
        clear(): void { storage.clear() },
        iterator(): () => ({ value: T } | null) { return storage.iterator() }
    }
    for (const item of initialItems) result.add(item)
    return result
}
