/** JavaScript asynchronous primitives exposed to JunoScript. */
export type TimerHandle = object
export type ImmediateHandle = object
export type AsyncCallback = (...args: unknown[]) => void
export type FetchInput = string | URL | Request
export type FetchOptions = RequestInit
export type FetchResponse = Response
export type RejectedResult<E = unknown> = { ok: false; error: E }

const PromiseFactory = function<T>(
    executor: (resolve: (value: T | PromiseLike<T> | RejectedResult) => void) => void
): Promise<T> {
    if (arguments.length !== 1) throw new TypeError('Promise() accepts exactly one executor callback')
    return new globalThis.Promise<T>((resolve, reject) => executor(value => {
        if (isRejectedResult(value)) reject(value.error)
        else resolve(value)
    }))
} as unknown as PromiseConstructor

Object.setPrototypeOf(PromiseFactory, globalThis.Promise)
for (const name of ['all', 'allSettled', 'any', 'race', 'reject', 'resolve', 'withResolvers'] as const) {
    const member = (globalThis.Promise as unknown as Record<string, Function | undefined>)[name]
    if (!member) continue
    const value = name === 'resolve'
        ? <T>(input: T | PromiseLike<T>): Promise<Awaited<T>> => isRejectedResult(input)
            ? globalThis.Promise.reject(input.error)
            : globalThis.Promise.resolve(input) as Promise<Awaited<T>>
        : name === 'withResolvers'
        ? <T>() => {
            const controls = (globalThis.Promise as unknown as {
                withResolvers<U>(): { promise: Promise<U>; resolve(value: U | PromiseLike<U>): void; reject(reason?: unknown): void }
            }).withResolvers<T>()
            return {
                promise: controls.promise,
                resolve: (input: T | PromiseLike<T> | RejectedResult): void => {
                    if (isRejectedResult(input)) controls.reject(input.error)
                    else controls.resolve(input)
                },
                reject: controls.reject
            }
        }
        : member.bind(globalThis.Promise)
    Object.defineProperty(PromiseFactory, name, { value, enumerable: true })
}

function isRejectedResult(value: unknown): value is { ok: false; error: unknown } {
    return value !== null && typeof value === 'object' && 'ok' in value && value.ok === false && 'error' in value
}

export { PromiseFactory as Promise }

export function setTimeout<T, TArgs extends any[]>(callback: (...args: TArgs) => T, delay: number, ...args: TArgs): T {
    return globalThis.setTimeout(callback, delay, ...args) as unknown as T
}

export function setInterval<T, TArgs extends any[]>(callback: (...args: TArgs) => T, delay?: number, ...args: TArgs): TimerHandle {
    return globalThis.setInterval(callback, delay ?? 0, ...args)
}

export function clearTimeout(handle: TimerHandle): void { globalThis.clearTimeout(handle as NodeJS.Timeout) }
export function clearInterval(handle: TimerHandle): void { globalThis.clearInterval(handle as NodeJS.Timeout) }

export function setImmediate(callback: AsyncCallback, ...args: unknown[]): ImmediateHandle {
    return globalThis.setImmediate(callback, ...args)
}

export function clearImmediate(handle: ImmediateHandle): void { globalThis.clearImmediate(handle as NodeJS.Immediate) }
export function queueMicrotask(callback: AsyncCallback): void { globalThis.queueMicrotask(callback) }
export function fetch(input: FetchInput, init?: FetchOptions): Promise<FetchResponse> { return globalThis.fetch(input, init) }

export default {
    Promise: PromiseFactory,
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    setImmediate,
    clearImmediate,
    queueMicrotask,
    fetch
}
