import jestExpect from 'expect'
import { ModernFakeTimers } from '@jest/fake-timers'
import { ModuleMocker } from 'jest-mock'

type AnyFunction = (...args: any[]) => any
type TestCallback = () => unknown | Promise<unknown>

export type JunoExpectMatchers = {
    that(actual: unknown): any
    toBe<T>(actual: T, expected: T): void
    toBeEqual<T>(actual: T, expected: T): void
    toEqual<T>(actual: T, expected: T): void
    toStrictEqual<T>(actual: T, expected: T): void
    toBeTrue(actual: boolean): void
    toBeTruthy(actual: unknown): void
    toBeFalse(actual: boolean): void
    toBeFalsy(actual: unknown): void
    toBeDefined<T>(actual: T): void
    toBeUndefined(actual: unknown): void
    toBeNull<T>(actual: T): void
    toBeNaN(actual: number): void
    toBeCloseTo(actual: number, expected: number, precision?: number): void
    toBeGreaterThan(actual: number, expected: number): void
    toBeGreaterThanOrEqual(actual: number, expected: number): void
    toBeLessThan(actual: number, expected: number): void
    toBeLessThanOrEqual(actual: number, expected: number): void
    toContain(actual: unknown, expected: unknown): void
    toContainEqual(actual: unknown, expected: unknown): void
    toHaveLength(actual: unknown, expected: number): void
    toHaveProperty(actual: object, path: string, expected?: unknown): void
    toMatch(actual: string, expected: string | RegExp): void
    toMatchObject(actual: object, expected: object): void
    toThrow(actual: AnyFunction, expected?: unknown): void
    toBeInstanceOf(actual: unknown, expected: unknown): void
    toHaveBeenCalled(actual: AnyFunction): void
    toHaveBeenCalledTimes(actual: AnyFunction, count: number): void
    toHaveBeenCalledWith(actual: AnyFunction, ...args: unknown[]): void
    toHaveBeenLastCalledWith(actual: AnyFunction, ...args: unknown[]): void
    toHaveBeenNthCalledWith(actual: AnyFunction, nth: number, ...args: unknown[]): void
    toHaveReturned(actual: AnyFunction): void
    toHaveReturnedTimes(actual: AnyFunction, count: number): void
    toHaveReturnedWith(actual: AnyFunction, value: unknown): void
    toHaveLastReturnedWith(actual: AnyFunction, value: unknown): void
    toHaveNthReturnedWith(actual: AnyFunction, nth: number, value: unknown): void
    any(type: unknown): unknown
    anything(): unknown
    arrayContaining(value: unknown[]): unknown
    arrayOf(value: unknown): unknown
    closeTo(value: number, precision?: number): unknown
    objectContaining(value: object): unknown
    stringContaining(value: string): unknown
    stringMatching(value: string | RegExp): unknown
    assertions(count: number): void
    hasAssertions(): void
    extend(matchers: object): void
    addEqualityTesters(testers: AnyFunction[]): void
}

export type JunoExpect = JunoExpectMatchers & { not: JunoExpectMatchers }

const moduleMocker = new ModuleMocker(globalThis)
const timers = new ModernFakeTimers({
    global: globalThis,
    config: { fakeTimers: { enableGlobally: false } } as any
})

/** Jest's regular `expect(value)` entry point. */
const that = jestExpect

function assertion(jestName: string, actual: unknown, expected: unknown[], inverse: boolean): void {
    const matchers = inverse ? jestExpect(actual).not : jestExpect(actual)
    const candidate = (matchers as unknown as Record<string, AnyFunction>)[jestName]
    if (typeof candidate !== 'function') throw new TypeError(`Unknown Jest matcher '${jestName}'`)
    candidate.apply(matchers, expected)
}

const matcherNames: Record<string, string> = {
    toBe: 'toBe', toBeEqual: 'toEqual', toEqual: 'toEqual', toStrictEqual: 'toStrictEqual',
    toBeTrue: 'toBeTruthy', toBeTruthy: 'toBeTruthy', toBeFalse: 'toBeFalsy', toBeFalsy: 'toBeFalsy',
    toBeDefined: 'toBeDefined', toBeUndefined: 'toBeUndefined', toBeNull: 'toBeNull', toBeNaN: 'toBeNaN',
    toBeCloseTo: 'toBeCloseTo', toBeGreaterThan: 'toBeGreaterThan', toBeGreaterThanOrEqual: 'toBeGreaterThanOrEqual',
    toBeLessThan: 'toBeLessThan', toBeLessThanOrEqual: 'toBeLessThanOrEqual', toContain: 'toContain',
    toContainEqual: 'toContainEqual', toHaveLength: 'toHaveLength', toHaveProperty: 'toHaveProperty',
    toMatch: 'toMatch', toMatchObject: 'toMatchObject', toThrow: 'toThrow', toBeInstanceOf: 'toBeInstanceOf',
    toHaveBeenCalled: 'toHaveBeenCalled', toHaveBeenCalledTimes: 'toHaveBeenCalledTimes',
    toHaveBeenCalledWith: 'toHaveBeenCalledWith', toHaveBeenLastCalledWith: 'toHaveBeenLastCalledWith',
    toHaveBeenNthCalledWith: 'toHaveBeenNthCalledWith', toHaveReturned: 'toHaveReturned',
    toHaveReturnedTimes: 'toHaveReturnedTimes', toHaveReturnedWith: 'toHaveReturnedWith',
    toHaveLastReturnedWith: 'toHaveLastReturnedWith', toHaveNthReturnedWith: 'toHaveNthReturnedWith'
}

function createExpect(inverse: boolean): Record<string, any> {
    const api: Record<string, any> = {
        that, any: jestExpect.any, anything: jestExpect.anything,
        arrayContaining: jestExpect.arrayContaining, arrayOf: jestExpect.arrayOf,
        closeTo: jestExpect.closeTo, objectContaining: jestExpect.objectContaining,
        stringContaining: jestExpect.stringContaining, stringMatching: jestExpect.stringMatching,
        assertions: jestExpect.assertions, hasAssertions: jestExpect.hasAssertions,
        extend: jestExpect.extend, addEqualityTesters: jestExpect.addEqualityTesters
    }
    for (const [name, jestName] of Object.entries(matcherNames)) {
        api[name] = (actual: unknown, ...expected: unknown[]) => {
            if (name === 'toBeDefined') return assertion('toBeNull', actual, [], !inverse)
            if (name === 'toBeTrue') return assertion('toBe', actual, [true], inverse)
            if (name === 'toBeFalse') return assertion('toBe', actual, [false], inverse)
            return assertion(jestName, actual, expected, inverse)
        }
    }
    return api
}

/** Juno-friendly two-argument matchers. `expect.not` contains their inverse. */
export const expect: JunoExpect = createExpect(false) as JunoExpect
expect.not = createExpect(true) as JunoExpectMatchers

/** Creates a real Jest mock function, including `.mock`, `mockReturnValue`, etc. */
export function Mock(implementation?: AnyFunction): ReturnType<ModuleMocker['fn']> {
    return moduleMocker.fn(implementation)
}

export const spyOn = moduleMocker.spyOn.bind(moduleMocker) as ModuleMocker['spyOn']
export const replaceProperty = moduleMocker.replaceProperty.bind(moduleMocker) as ModuleMocker['replaceProperty']
export const isMockFunction = moduleMocker.isMockFunction.bind(moduleMocker)
export const clearAllMocks = moduleMocker.clearAllMocks.bind(moduleMocker)
export const resetAllMocks = moduleMocker.resetAllMocks.bind(moduleMocker)
export const restoreAllMocks = moduleMocker.restoreAllMocks.bind(moduleMocker)

export const useFakeTimers = timers.useFakeTimers.bind(timers)
export const useRealTimers = timers.useRealTimers.bind(timers)
export const clearAllTimers = timers.clearAllTimers.bind(timers)
export const runAllTimers = timers.runAllTimers.bind(timers)
export const runAllTimersAsync = timers.runAllTimersAsync.bind(timers)
export const runOnlyPendingTimers = timers.runOnlyPendingTimers.bind(timers)
export const advanceTimersByTime = timers.advanceTimersByTime.bind(timers)
export const advanceTimersByTimeAsync = timers.advanceTimersByTimeAsync.bind(timers)
export const advanceTimersToNextTimer = timers.advanceTimersToNextTimer.bind(timers)
export const setSystemTime = timers.setSystemTime.bind(timers)
export const getTimerCount = timers.getTimerCount.bind(timers)

let suiteNames: string[] = []
let beforeEachCallbacks: TestCallback[] = []
let afterEachCallbacks: TestCallback[] = []

/** A lightweight in-process Jest-style suite for executable `.jn` files. */
export function describe(name: string, body: TestCallback): unknown {
    suiteNames.push(name)
    try { return body() } finally { suiteNames.pop() }
}

export function beforeEach(callback: TestCallback): void { beforeEachCallbacks.push(callback) }
export function afterEach(callback: TestCallback): void { afterEachCallbacks.push(callback) }

export function test(name: string, body: TestCallback): unknown {
    const fullName = [...suiteNames, name].join(' > ')
    const execute = async (): Promise<void> => {
        try {
            for (const callback of beforeEachCallbacks) await callback()
            await body()
            console.log(`\u2713 ${fullName}`)
        } catch (error) {
            console.error(`\u2717 ${fullName}`)
            throw error
        } finally {
            for (const callback of afterEachCallbacks) await callback()
        }
    }
    return execute()
}

test.only = test
test.skip = (_name: string, _body: TestCallback): void => undefined
export const it = test

export default {
    expect, Mock, spyOn, replaceProperty, isMockFunction,
    clearAllMocks, resetAllMocks, restoreAllMocks,
    describe, test, it, beforeEach, afterEach,
    useFakeTimers, useRealTimers, clearAllTimers, runAllTimers, runAllTimersAsync,
    runOnlyPendingTimers, advanceTimersByTime, advanceTimersByTimeAsync,
    advanceTimersToNextTimer, setSystemTime, getTimerCount
}
