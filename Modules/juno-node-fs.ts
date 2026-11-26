import * as nodeFs from 'node:fs'
import * as promises from 'node:fs/promises'

/** A serializable subset of Node's fs.Stats. */
export type FileStat = {
    size: number
    createdAt: number
    modifiedAt: number
    isFile: boolean
    isDirectory: boolean
    isSymbolicLink: boolean
}

export function readFileSync(path: string, encoding = 'utf8'): string {
    return nodeFs.readFileSync(path, { encoding: encoding as BufferEncoding })
}

export function writeFileSync(path: string, data: string, encoding = 'utf8'): void {
    nodeFs.writeFileSync(path, data, { encoding: encoding as BufferEncoding })
}

export function appendFileSync(path: string, data: string, encoding = 'utf8'): void {
    nodeFs.appendFileSync(path, data, { encoding: encoding as BufferEncoding })
}

export function existsSync(path: string): boolean { return nodeFs.existsSync(path) }

export function mkdirSync(path: string, recursive = false): void {
    nodeFs.mkdirSync(path, { recursive })
}

export function readdirSync(path: string): string[] { return nodeFs.readdirSync(path) }

export function removeSync(path: string, recursive = false, force = false): void {
    nodeFs.rmSync(path, { recursive, force })
}

export function renameSync(oldPath: string, newPath: string): void { nodeFs.renameSync(oldPath, newPath) }
export function copyFileSync(source: string, destination: string): void { nodeFs.copyFileSync(source, destination) }

export function statSync(path: string): FileStat {
    return fileStat(nodeFs.statSync(path))
}

function fileStat(value: nodeFs.Stats): FileStat {
    return {
        size: value.size,
        createdAt: value.birthtimeMs,
        modifiedAt: value.mtimeMs,
        isFile: value.isFile(),
        isDirectory: value.isDirectory(),
        isSymbolicLink: value.isSymbolicLink()
    }
}

export function readFile(path: string, encoding = 'utf8'): Promise<string> {
    return promises.readFile(path, { encoding: encoding as BufferEncoding })
}

export async function writeFile(path: string, data: string, encoding = 'utf8'): Promise<null> {
    await promises.writeFile(path, data, { encoding: encoding as BufferEncoding })
    return null
}

export async function appendFile(path: string, data: string, encoding = 'utf8'): Promise<null> {
    await promises.appendFile(path, data, { encoding: encoding as BufferEncoding })
    return null
}

export function exists(path: string): Promise<boolean> {
    return promises.access(path).then(() => true, () => false)
}

export async function mkdir(path: string, recursive = false): Promise<null> {
    await promises.mkdir(path, { recursive })
    return null
}

export function readdir(path: string): Promise<string[]> {
    return promises.readdir(path)
}

export async function remove(path: string, recursive = false, force = false): Promise<null> {
    await promises.rm(path, { recursive, force })
    return null
}

export async function rename(oldPath: string, newPath: string): Promise<null> {
    await promises.rename(oldPath, newPath)
    return null
}

export async function copyFile(source: string, destination: string): Promise<null> {
    await promises.copyFile(source, destination)
    return null
}

export async function stat(path: string): Promise<FileStat> {
    return fileStat(await promises.stat(path))
}

export default {
    readFile, writeFile, appendFile, exists, mkdir, readdir, remove, rename, copyFile, stat,
    readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, removeSync, renameSync, copyFileSync, statSync
}
