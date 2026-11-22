import { exportsForFile, analyze } from './vscode-junoscript/src/language'
import { readFileSync } from 'node:fs'
const objectFile = 'E:/VSCodeProjects/JunoScript/types/object.jn'
const testFile = 'E:/VSCodeProjects/JunoScript/Tests/testObject.jn'
console.log(exportsForFile(objectFile))
console.log(analyze(readFileSync(testFile, 'utf8'), testFile)?.hovers.slice(0, 8))
