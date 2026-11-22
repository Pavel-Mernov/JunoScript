import { immutableSnapshot, junoEqual, structuralHash } from './set.ts'

export type JunoMap<K, V> = {
    readonly length: number
    set(key: K, value: V): JunoMap<K, V>
    get(key: K): V | null
    hasKey(key: K): boolean
    delete(key: K): boolean
    clear(): void
    mapKeys(): K[]
    values(): V[]
    iterator(): () => ({ value: [K, V] } | null)
}

export function globalMap<K, V>(...initialEntries: [K, V][]): JunoMap<K, V> {
    type Entry = { key: K; value: V; hash: string; active: boolean }
    const order: Entry[] = []
    const buckets = new globalThis.Map<string, globalThis.Set<Entry>>()
    const identities = new WeakMap<object, Entry>()
    let activeLength = 0

    const addToBucket = (entry: Entry): void => {
        let bucket = buckets.get(entry.hash)
        if (!bucket) buckets.set(entry.hash, bucket = new globalThis.Set<Entry>())
        bucket.add(entry)
    }
    const removeFromBucket = (entry: Entry): void => {
        const bucket = buckets.get(entry.hash)
        bucket?.delete(entry)
        if (bucket?.size === 0) buckets.delete(entry.hash)
    }
    const refreshIdentity = (key: K): Entry | undefined => {
        if ((typeof key !== 'object' || key === null) && typeof key !== 'function') return undefined
        const entry = identities.get(key as object)
        if (!entry?.active) return undefined
        const hash = structuralHash(key)
        if (hash !== entry.hash) {
            removeFromBucket(entry)
            entry.hash = hash
            addToBucket(entry)
        }
        return entry
    }
    const find = (key: K): Entry | undefined => {
        const identical = refreshIdentity(key)
        if (identical) return identical
        const bucket = buckets.get(structuralHash(key))
        if (!bucket) return undefined
        for (const entry of bucket) if (entry.active && junoEqual(entry.key, key)) return entry
        return undefined
    }

    const result: JunoMap<K, V> = {
        get length(): number { return activeLength },
        set(key: K, value: V): JunoMap<K, V> {
            const existing = find(key)
            if (existing) {
                existing.value = value
                return result
            }
            const entry: Entry = { key, value, hash: structuralHash(key), active: true }
            order.push(entry)
            addToBucket(entry)
            if ((typeof key === 'object' && key !== null) || typeof key === 'function') identities.set(key as object, entry)
            activeLength++
            return result
        },
        get(key: K): V | null { return find(key)?.value ?? null },
        hasKey(key: K): boolean { return find(key) !== undefined },
        delete(key: K): boolean {
            const entry = find(key)
            if (!entry) return false
            entry.active = false
            removeFromBucket(entry)
            if ((typeof entry.key === 'object' && entry.key !== null) || typeof entry.key === 'function') identities.delete(entry.key as object)
            activeLength--
            return true
        },
        clear(): void {
            for (const entry of order) entry.active = false
            order.length = 0
            buckets.clear()
            activeLength = 0
        },
        mapKeys(): K[] { return order.filter(entry => entry.active).map(entry => entry.key) },
        values(): V[] { return order.filter(entry => entry.active).map(entry => entry.value) },
        iterator(): () => ({ value: [K, V] } | null) {
            let index = 0
            return () => {
                while (index < order.length) {
                    const entry = order[index++]
                    if (entry.active) return { value: [entry.key, entry.value] }
                }
                return null
            }
        }
    }
    for (const [key, value] of initialEntries) result.set(key, value)
    return result
}

export function globalMapToObject(map: JunoMap<string | number, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = Object.create(null)
    const next = map.iterator()
    for (let entry = next(); entry !== null; entry = next()) {
        const [key, value] = entry.value
        Object.defineProperty(result, String(key), { value, enumerable: true, configurable: true, writable: true })
    }
    return result
}

/** A structural map that stores immutable key snapshots, keeping hashes stable. */
export function globalValueMap<K, V>(...initialEntries: [K, V][]): JunoMap<K, V> {
    const storage = globalMap<K, V>()
    const result: JunoMap<K, V> = {
        get length(): number { return storage.length },
        set(key: K, value: V): JunoMap<K, V> {
            if (storage.hasKey(key)) storage.set(key, value)
            else storage.set(immutableSnapshot(key), value)
            return result
        },
        get(key: K): V | null { return storage.get(key) },
        hasKey(key: K): boolean { return storage.hasKey(key) },
        delete(key: K): boolean { return storage.delete(key) },
        clear(): void { storage.clear() },
        mapKeys(): K[] { return storage.mapKeys() },
        values(): V[] { return storage.values() },
        iterator(): () => ({ value: [K, V] } | null) { return storage.iterator() }
    }
    for (const [key, value] of initialEntries) result.set(key, value)
    return result
}
