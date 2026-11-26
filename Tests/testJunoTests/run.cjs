'use strict'

const { spawnSync } = require('node:child_process')
const { readdirSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')
const cli = path.join(root, 'dist/CLI/junode.js')
const failures = []
let passed = 0

function printTestError(stderr) {
    const lines = stderr.split(/\r?\n/)
    const isStackFrame = line => /^\s+at /.test(line)
    const isJunoFrame = line => isStackFrame(line) && /\.jn:\d+:\d+\)?$/.test(line)
    const preferred = lines.some(isJunoFrame)
        ? lines.filter(line => !isStackFrame(line) || isJunoFrame(line))
        : lines
    process.stderr.write(preferred.join('\n'))
}

function run(name, args, { command = process.execPath, ...options } = {}) {
    const result = spawnSync(command, args, {
        cwd: root,
        encoding: 'utf8',
        ...options
    })
    if (result.status === 0 && !result.error) {
        passed++
        console.info('PASS', name)
        return
    }
    failures.push(name)
    console.error('FAIL', name)
    if (result.error) console.error(result.error.message)
    if (result.signal) console.error('Signal:', result.signal)
    if (result.stdout) process.stderr.write(result.stdout)
    if (result.stderr) printTestError(result.stderr)
}

function runJunoFiles(directory) {
    const entries = readdirSync(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const file = path.join(directory, entry.name)
        // The filesystem runner supplies the shared fixture directory.
        if (file === path.join(__dirname, 'testFs')) continue
        // The dependency is loaded by testBuild/imports.jn.
        if (file === path.join(__dirname, 'testBuild', 'dependency.jn')) continue
        if (entry.isDirectory()) {
            runJunoFiles(file)
        } else if (entry.name.endsWith('.jn') && !entry.name.endsWith('.d.jn')) {
            const name = path.relative(__dirname, file)
            run(name, [cli, file], name === 'test.jn' ? { input: 'Ada\nfirst\nsecond\n' } : {})
        }
    }
}

runJunoFiles(__dirname)
for (const script of [
    'testFs/run.cjs',
    'testBuild/run.cjs',
    'testBuild/testBuildOutput/testBuildOutput.js',
    'testBuild/testBuildOutput/testBuildLoop.js'
]) {
    run(script, [path.join(__dirname, script)])
}
run('testJnTs TypeScript declarations', ['-p', 'Tests/testJunoTests/testJnTs/tsconfig.json'], {
    command: 'tsc',
    shell: process.platform === 'win32'
})

console.info(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
    for (const name of failures) console.error(' -', name)
    process.exitCode = 1
}
