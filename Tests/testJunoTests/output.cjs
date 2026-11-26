'use strict'

const { inspect } = require('node:util')
const path = require('node:path')
const { expect } = require('../../dist/Modules/juno-test.js')
const snapshots = require('./output.json')
const projectPath = path.resolve(__dirname, '../..') + path.sep
const inspectedProjectPath = projectPath.replaceAll('\\', '\\\\')

function outputFor(file) {
    const actual = []
    process.once('beforeExit', () => {
        if (process.exitCode) return
        try {
            expect.toBeEqual(actual, snapshots[file])
        } catch (error) {
            console.error(file, error.message)
            process.exitCode = 1
        }
    })
    return (...args) => {
        actual.push(args.map(value => inspect(value, {
            depth: 3, sorted: true, compact: true, breakLength: Infinity,
            maxArrayLength: 50, maxStringLength: 1000
        }).replaceAll(inspectedProjectPath, '<project>/')
            .replace(/(<project>\/[^']+\.jn:\d+:\d+)/g, frame => frame.replaceAll('\\\\', '/'))))
        return null
    }
}

exports.outputFor = outputFor
