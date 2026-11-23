'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { analyze } = require('../../dist/vscode-junoscript/src/language.js')

const file = path.join(__dirname, 'classInterop.jn')
const result = analyze(readFileSync(file, 'utf8'), file)

assert.ok(result, 'classInterop.jn must be analyzable')
assert.deepEqual(result.diagnostics, [])

const importedClass = result.hovers.find(item =>
    item.line === 1 && item.code.startsWith('constructor NativeAccumulator(')
)
assert.ok(importedClass, 'NativeAccumulator import must retain its constructor type')
assert.match(importedClass.code, /constructor NativeAccumulator\(value: number\): NativeAccumulator/)
assert.match(importedClass.typeDescription ?? '', /value: number/)
assert.match(importedClass.typeDescription ?? '', /add\(amount: number\): number/)

const inferredInstance = result.hovers.find(item =>
    item.line === 3 && item.code.startsWith('const sampleAccumulator:')
)
assert.ok(inferredInstance, 'NativeAccumulator call must infer the exported class instance')
assert.equal(inferredInstance.code, 'const sampleAccumulator: NativeAccumulator')
assert.doesNotMatch(inferredInstance.code, /\bany\b/)

console.log('class import inference passed')
