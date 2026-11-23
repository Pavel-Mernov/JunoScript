#!/usr/bin/env node
import { runFile } from '../Runtime/interpreter.js'
import { buildJunoFile } from './build-juno.js'

const args = process.argv.slice(2)
const build = args[0] === '--build'
const file = args[build ? 1 : 0]
if (!file || file === '--help' || file === '-h') {
    console.log('Usage:\n  junode <file.jn> [args...]\n  junode --build <file.jn> [--out <file.js|file.ts>] [--target js|ts]')
    process.exit(file ? 0 : 2)
}

try {
    if (build) {
        const outIndex = args.indexOf('--out')
        const targetIndex = args.indexOf('--target')
        const target = targetIndex >= 0 ? args[targetIndex + 1] : undefined
        if (target !== undefined && target !== 'js' && target !== 'ts') throw new Error("--target must be 'js' or 'ts'")
        const output = buildJunoFile(file, {
            outFile: outIndex >= 0 ? args[outIndex + 1] : undefined,
            target: target as 'js' | 'ts' | undefined
        })
        console.log(output)
    } else runFile(file)
} catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error)
    process.exitCode = 1
}
