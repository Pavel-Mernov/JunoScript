const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { once } = require('node:events')
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')

const root = resolve(__dirname, '..')
const temp = mkdtempSync(join(tmpdir(), 'juno-packages-'))
const npm = (args, cwd) => execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']
})

async function checkPackages() {
    const archives = JSON.parse(npm(['pack', '--workspaces', '--json', '--pack-destination', temp], root))
    assert.deepEqual(archives.map(archive => archive.name).sort(), [
        '@junoscript/juno', '@junoscript/juno-express', '@junoscript/juno-node'
    ])
    const project = join(temp, 'project')
    const routes = join(project, 'src')
    mkdirSync(routes, { recursive: true })
    writeFileSync(join(project, 'package.json'), '{"private":true}')
    npm(['install', '--ignore-scripts', '--no-audit', '--no-fund',
        ...archives.map(archive => join(temp, archive.filename))], project)

    const cli = join(project, 'node_modules/@junoscript/juno/dist/CLI/junode.js')
    const file = join(routes, 'server.jn')
    const envFile = join(project, '.env')
    writeFileSync(envFile, 'MESSAGE=installed packages work\n')
    writeFileSync(file, [
        "import { ExpressServer, HttpRequest } from '@junoscript/juno-express'",
        "import { Path, readEnv } from '@junoscript/juno-node'",
        "import { readFileSync } from '@junoscript/juno-node/fs'",
        "import { Promise } from 'juno:async'",
        "import { console } from 'juno:node'",
        `const path: Path = { path: ${JSON.stringify(envFile.replaceAll('\\', '/'))} }`,
        'export const env = readEnv(path)',
        'console.log(readFileSync(path.path).trim())',
        'type Payload = { field: number }',
        'let calls = 0',
        'const handle = (request: HttpRequest<Payload>) =>',
        '    calls += 1',
        "    return Promise.resolve({ body: { message: env['MESSAGE'], field: request.body!.field, calls } })",
        "export const app = ExpressServer({ json: true, handlers: { '/health': { POST: { validateBody: (body) => isType<Payload>(body), handle: handle } } } })"
    ].join('\n'))
    const run = args => execFileSync(process.execPath, [cli, ...args], {
        cwd: temp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']
    })
    assert.match(run([file]), /MESSAGE=installed packages work/)
    const output = join(routes, 'server.js')
    run(['--build', file, '--out', output])
    const { app, env } = require(output)
    assert.equal(env.MESSAGE, 'installed packages work')

    const server = app.listen(0)
    try {
        await once(server, 'listening')
        const post = body => fetch(`http://127.0.0.1:${server.address().port}/health`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        })
        for (const body of [{ field: 'a' }, {}]) {
            const invalid = await post(body)
            assert.equal(invalid.status, 400)
            assert.equal(await invalid.text(), 'Bad Request')
        }
        const response = await post({ field: 123 })
        assert.equal(response.status, 200)
        assert.deepEqual(await response.json(), { message: 'installed packages work', field: 123, calls: 1 })
    } finally {
        server.close()
    }
}

checkPackages().then(() => console.log('All three npm tarballs installed and verified.'), error => {
    console.error(error)
    process.exitCode = 1
}).finally(() => rmSync(temp, { recursive: true, force: true }))
