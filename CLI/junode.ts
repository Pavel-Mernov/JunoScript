#!/usr/bin/env node
import { runFile } from '../Runtime/interpreter.js'

const [, , file] = process.argv
if (!file || file === '--help' || file === '-h') {
    console.log('Usage: junode <file.jn> [args...]')
    process.exit(file ? 0 : 2)
}

try {
    runFile(file)
} catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : error)
    process.exitCode = 1
}
