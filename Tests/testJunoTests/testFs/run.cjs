'use strict'

const { spawnSync } = require('node:child_process')
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs')
const assert = require('node:assert/strict')
const { analyze } = require('../../../dist/vscode-junoscript/src/language.js')
const path = require('node:path')

const root = path.resolve(__dirname, '../../..')
const testDirectory = mkdtempSync(path.join(__dirname, '.fs-test-'))
const sandbox = path.join(testDirectory, 'sandbox')
const source = path.join(sandbox, 'nested', 'source.txt')
const renamed = path.join(sandbox, 'renamed.txt')

try {
    const scenarios = [
        ['testFs.jn', [': null', ': string']],
        ['testCopyRename.jn', [': string']],
        ['testDirectory.jn', [
            ': { size: number, createdAt: number, modifiedAt: number, isFile: boolean, isDirectory: boolean, isSymbolicLink: boolean }',
            ': string[]'
        ]],
        ['testAsyncFs.jn', [': null', ': string', ': string[]']]
    ]
    for (const [name, expectedTypes] of scenarios) {
        const file = path.join(__dirname, name)
        const analysis = analyze(readFileSync(file, 'utf8'), file)
        assert.ok(analysis, name)
        assert.deepEqual(analysis.diagnostics, [], name)
        assert.deepEqual(analysis.hints.filter(hint => hint.kind === 'type').map(hint => hint.label), expectedTypes, name)

        const result = spawnSync(process.execPath, [path.join(root, 'dist/CLI/junode.js'), file], {
            cwd: testDirectory,
            encoding: 'utf8'
        })
        if (result.error) throw result.error
        assert.equal(result.status, 0, result.stderr)
        assert.deepEqual(result.stdout.trim(), '', name)
        if (name === 'testFs.jn') {
            assert.equal(readFileSync(source, 'utf8'), 'JunoScript')
        } else if (name === 'testCopyRename.jn') {
            assert.equal(readFileSync(renamed, 'utf8'), 'JunoScript')
            assert.equal(existsSync(path.join(sandbox, 'copy.txt')), false)
        } else {
            assert.equal(existsSync(sandbox), false, name)
        }
    }

} finally {
    rmSync(testDirectory, { recursive: true, force: true })
}
