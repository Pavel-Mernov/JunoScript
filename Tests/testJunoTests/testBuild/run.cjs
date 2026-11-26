'use strict'

const { spawnSync } = require('node:child_process')
const { mkdirSync, rmSync } = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const cli = path.join(root, 'dist/CLI/junode.js')
const generated = path.join(__dirname, '.generated')

const run = (command, args, shell = false) => {
    const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', shell })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
}

rmSync(generated, { recursive: true, force: true })
mkdirSync(generated, { recursive: true })

try {
    run(process.execPath, [path.join(__dirname, 'checkInference.cjs')])

    const build = (source, output, target = 'js') => run(process.execPath, [
        cli,
        '--build', path.join(__dirname, source),
        '--out', path.join(generated, output),
        '--target', target
    ])

    build('testBuild.jn', 'basic.js')
    build('imports.jn', 'imports.js')
    build('runtimeTypes.jn', 'runtimeTypes.js')
    build('classInterop.jn', 'classInterop.js')
    build('testBuild.jn', 'basic.ts', 'ts')

    run(process.execPath, [path.join(__dirname, 'consumeBuilt.cjs')])
    run('tsc', ['-p', path.join(__dirname, 'tsconfig.json')], process.platform === 'win32')

} finally {
    rmSync(generated, { recursive: true, force: true })
}
