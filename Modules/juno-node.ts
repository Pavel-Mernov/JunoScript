import { readSync } from 'node:fs'

/** Node.js console module with synchronous stdin helpers. */
export const console = {
    ...globalThis.console,

    /** Arguments passed after the JunoScript file: junode <file> [args...]. */
    get args(): string[] {
        return process.argv.slice(3)
    },

    read(encoding = 'utf8'): string {
        return readLine(encoding)
    },

    readLines(encoding = 'utf8'): string[] {
        const input = readInput(encoding, true) as string[]
        return input
    }
}

function readInput(encoding: string, lines: true): string[]
function readInput(encoding: string, lines: false): string
function readInput(encoding: string, lines: boolean): string | string[] {
    const chunks: Buffer[] = []
    const buffer = Buffer.alloc(1024)
    let bytesRead: number

    // Read until EOF. This API is intentionally synchronous to match juno:node.
    while ((bytesRead = readSync(0, buffer, 0, buffer.length, null)) > 0) {
        chunks.push(Buffer.from(buffer.subarray(0, bytesRead)))
    }

    const value = Buffer.concat(chunks).toString(encoding as BufferEncoding)
    if (!lines) return value
    return value.length === 0 ? [] : value.split(/\r?\n/).filter((line, index, all) => !(line === '' && index === all.length - 1))
}

function readLine(encoding: string): string {
    const bytes: number[] = []
    const buffer = Buffer.alloc(1)
    while (readSync(0, buffer, 0, 1, null) > 0) {
        if (buffer[0] === 10) break
        if (buffer[0] !== 13) bytes.push(buffer[0])
    }
    return Buffer.from(bytes).toString(encoding as BufferEncoding)
}

const junoNode = { console }
export default junoNode
