'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')

const generated = path.join(__dirname, '.generated')
const basic = require(path.join(generated, 'basic.js'))
const imports = require(path.join(generated, 'imports.js'))
const runtimeTypes = require(path.join(generated, 'runtimeTypes.js'))
const classInterop = require(path.join(generated, 'classInterop.js'))

assert.equal(basic.answer, 42)
assert.equal(basic.greet('Build'), 'Hello, Build')
const counter = basic.Counter(10)
assert.equal(counter.increment(5), 15)
assert.equal(basic.Counter.zero().value, 0)

assert.equal(imports.importedName, 'math-dependency')
assert.equal(imports.boxed.value, 5)
assert.equal(imports.calculate(6), 30)

const settings = runtimeTypes.createSettings('compiler')
assert.equal(settings.enabled, true)
assert.equal(settings.describe(), 'compiler:true')
const disabled = runtimeTypes.toggle(settings)
assert.equal(disabled.enabled, false)
assert.equal(disabled.describe(), 'compiler:false')

assert.equal(classInterop.sampleAccumulator.value, 1)
const accumulator = classInterop.createAccumulator(7)
assert.equal(accumulator.add(3), 10)
assert.equal(classInterop.createZero().value, 0)
