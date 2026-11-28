import { statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, resolve } from 'node:path'

export function resolveImport(specifier: string, importer: string): string | undefined {
    const absoluteImporter = resolve(importer)
    if (!specifier.startsWith('.') && !isAbsolute(specifier)) {
        try {
            const entry = createRequire(absoluteImporter).resolve(specifier)
            return isAbsolute(entry) ? entry : undefined
        } catch {
            return undefined
        }
    }

    const base = resolve(dirname(absoluteImporter), specifier)
    const extensions = ['.jn', '.js', '.ts', '.cjs', '.mjs']
    const candidates = /\.(?:jn|[cm]?[jt]s)$/i.test(base) ? [base] : [
        ...extensions.map(extension => base + extension),
        ...extensions.map(extension => resolve(base, 'index' + extension))
    ]
    return candidates.find(candidate => statSync(candidate, { throwIfNoEntry: false })?.isFile())
}

export function siblingDeclaration(file: string): string | undefined {
    const declaration = file.replace(/\.(?:js|cjs|mjs)$/i, extension => extension === '.cjs' ? '.d.cts' : extension === '.mjs' ? '.d.mts' : '.d.ts')
    return declaration !== file && statSync(declaration, { throwIfNoEntry: false })?.isFile() ? declaration : undefined
}
