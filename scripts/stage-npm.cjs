const { cpSync, mkdirSync } = require('node:fs')
const { dirname, join, resolve } = require('node:path')

const root = resolve(__dirname, '..')
const name = process.argv[2]
const files = {
    juno: [
        'dist/CLI', 'dist/Lexer', 'dist/Modules', 'dist/Runtime',
        'dist/vscode-junoscript/src/language.js', 'dist/vscode-junoscript/src/language.d.ts',
        'types', 'Modules/async.ts', 'Modules/juno-node-fs.ts', 'Modules/juno-test.jn'
    ].map(file => [file, file]),
    'juno-node': ['juno-node', 'juno-node-fs'].flatMap(module => ['js', 'd.ts'].map(extension =>
        [`dist/Modules/${module}.${extension}`, `dist/${module}.${extension}`]
    )),
    'juno-express': ['expressServer.jn', 'express-native.cjs'].map(file => [`JunoExpress/${file}`, `dist/${file}`])
}

if (name && !Object.hasOwn(files, name)) throw new Error(`Unknown npm workspace: ${name}`)
for (const workspace of name ? [name] : Object.keys(files)) {
    for (const [source, destination] of files[workspace]) {
        const target = join(root, 'packages', workspace, destination)
        mkdirSync(dirname(target), { recursive: true })
        cpSync(join(root, source), target, { recursive: true })
    }
}
