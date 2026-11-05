import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Lexer } from '../Lexer/lexer'
import { Parser, TypeNode } from '../Lexer/parser'

const root = resolve(__dirname, '../..')
const source = readFileSync(resolve(root, 'iterable.jn'), 'utf8')
const declaration = new Parser(Lexer(source).tokenize()).parse().find(statement =>
    statement.kind === 'Export' && statement.declaration.kind === 'TypeDeclaration' && statement.declaration.name === 'Iterable'
)

if (!declaration || declaration.kind !== 'Export' || declaration.declaration.kind !== 'TypeDeclaration') {
    throw new Error("iterable.jn must export type 'Iterable'")
}

function printType(type: TypeNode, generics: Set<string>): string {
    switch (type.kind) {
        case 'NamedType':
            if (type.name === 'string' || type.name === 'number' || type.name === 'boolean' || type.name === 'bigint' || type.name === 'symbol' || type.name === 'unknown' || type.name === 'never' || type.name === 'any' || type.name === 'null') return type.name
            if (type.name === 'void' || type.name === 'object') return type.name
            return generics.has(type.name) ? type.name : type.name
        case 'LiteralType': return typeof type.value === 'string' ? JSON.stringify(type.value) : String(type.value)
        case 'GenericType': return `${type.name}<${type.args.map(argument => printType(argument, generics)).join(', ')}>`
        case 'ArrayType': return `Array<${printType(type.element, generics)}>`
        case 'UnionType': return `(${type.types.map(part => printType(part, generics)).join(' | ')})`
        case 'IntersectionType': return `(${type.types.map(part => printType(part, generics)).join(' & ')})`
        case 'FunctionType': return `(${type.params.map((param, index) => `arg${index}: ${printType(param, generics)}`).join(', ')}) => ${printType(type.result, generics)}`
        case 'ObjectType': return `{ ${type.members.map(member => {
            const prefix = `${member.readonly ? 'readonly ' : ''}${member.name}${member.optional ? '?' : ''}`
            if (member.accessor === 'get') return `get ${member.name}(): ${printType(member.type, generics)}`
            if (member.accessor === 'set') {
                const params = (member.params ?? []).map(param => `${param.name}: ${param.type ? printType(param.type, generics) : 'any'}`).join(', ')
                return `set ${member.name}(${params})`
            }
            if (!member.method) return `${prefix}: ${printType(member.type, generics)}`
            const params = (member.params ?? []).map((param, index) => `${param.name || `arg${index}`}${param.defaultValue ? '?' : ''}: ${param.type ? printType(param.type, generics) : 'any'}`).join(', ')
            return `${prefix}(${params}): ${printType(member.type, generics)}`
        }).join('; ')} }`
    }
}

const genericNames = declaration.declaration.generics
const genericText = genericNames.length ? `<${genericNames.join(', ')}>` : ''
const typeText = printType(declaration.declaration.value, new Set(genericNames))
const output = `/** Generated from iterable.jn. Edit the JunoScript source instead. */\nexport type Iterable${genericText} = ${typeText}\n`
writeFileSync(resolve(root, 'Modules/juno-types.ts'), output)
