export const stringify = JSON.stringify

export const parse = JSON.parse

export const nativeKeys = (value: object): (string | number)[] => Object.keys(value).filter(key =>
    !(key === 'toString'
        && typeof (value as any)[key] === 'function'
        && (value as any)[key].__junoDefaultToString)
)

export const readValue = (value: object, key: string | number): any =>
    (value as Record<string | number, any>)[key]

export function clone<T>(value: T, seen = new WeakMap<object, any>()): T {
    if (value === null || typeof value !== 'object' || (value as any).__junoFunction || (value as any).__junoConstructor) return value
    const existing = seen.get(value)
    if (existing) return existing
    if (value instanceof Set) {
        const copy = new Set()
        seen.set(value, copy)
        for (const item of value) copy.add(clone(item, seen))
        return copy as T
    }
    if (value instanceof Map) {
        const copy = new Map()
        seen.set(value, copy)
        for (const [key, item] of value) copy.set(clone(key, seen), clone(item, seen))
        return copy as T
    }
    const copy: any = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value))
    seen.set(value, copy)
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor) continue
        if ('value' in descriptor) descriptor.value = clone(descriptor.value, seen)
        Object.defineProperty(copy, key, descriptor)
    }
    return copy
}

export function freeze<T>(value: T, seen = new WeakSet<object>()): T {
    if (value === null || typeof value !== 'object' || (value as any).__junoFunction || (value as any).__junoConstructor || seen.has(value)) return value
    seen.add(value)
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (descriptor && 'value' in descriptor) freeze(descriptor.value, seen)
    }
    return Object.freeze(value)
}
