type StackCapture = () => string[]

const captureStackTraceSymbol = Symbol.for('junoscript.captureStackTrace')

/** Returns the active JunoScript call stack supplied by the interpreter. */
export function captureStackTrace(): string[] {
    const capture = (globalThis as typeof globalThis & Record<PropertyKey, unknown>)[captureStackTraceSymbol]
    return typeof capture === 'function' ? [...(capture as StackCapture)()] : []
}
