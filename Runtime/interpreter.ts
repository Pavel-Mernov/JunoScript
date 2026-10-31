import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Expression, Parameter, Statement, TypeNode, parse } from '../Lexer/parser'
import { resolveModule } from '../Modules'

type Binding = { value: unknown; mutable: boolean; declaredType?: TypeNode }
type Environment = { bindings: Map<string, Binding>; types: Map<string, TypeNode>; parent?: Environment }
type RuntimeFunction = { __junoFunction: true; params: Parameter[]; body: Statement[]; closure: Environment; thisValue?: unknown }
class ReturnValue { constructor(readonly value: unknown) {} }

export class Interpreter {
    private readonly globals: Environment = { bindings: new Map(), types: new Map() }
    constructor() { this.globals.bindings.set('isType', { value: (value: unknown, type: unknown) => matchesType(value, type), mutable: false }) }

    run(source: string): void { this.executeStatements(parse(source), this.globals) }

    private executeStatements(statements: Statement[], env: Environment): unknown {
        for (const statement of statements) {
            try { this.execute(statement, env) }
            catch (error) { if (error instanceof ReturnValue) return error.value; throw error }
        }
        return null
    }

    private execute(statement: Statement, env: Environment): void {
        switch (statement.kind) {
            case 'Import': {
                const module = resolveModule(statement.module) as Record<string, unknown>
                if (statement.defaultImport) this.declare(env, statement.defaultImport, module, false)
                for (const name of statement.namedImports) {
                    if (!(name in module)) throw new Error(`Module '${statement.module}' has no export '${name}'`)
                    this.declare(env, name, module[name], false)
                }
                return
            }
            case 'Variable': {
                let value = statement.initializer ? this.evaluate(statement.initializer, env) : null
                if (statement.type && value && typeof value === 'object' && !Array.isArray(value)) value = this.applyTypeDefaults(value, statement.type, env)
                this.declare(env, statement.name, value, statement.mutable, statement.type)
                return
            }
            case 'TypeDeclaration': {
                env.types.set(statement.name, statement.value)
                this.declare(env, statement.name, { __junoTypeConstructor: true, typeName: statement.name }, false)
                return
            }
            case 'FunctionDeclaration': this.declare(env, statement.name, { __junoFunction: true, params: statement.params, body: statement.body, closure: env } satisfies RuntimeFunction, false); return
            case 'Return': throw new ReturnValue(statement.value ? this.evaluate(statement.value, env) : null)
            case 'ExpressionStatement': this.evaluate(statement.expression, env); return
            case 'If': this.executeStatements(this.evaluate(statement.condition, env) ? statement.consequent : (statement.alternate ?? []), this.childEnvironment(env)); return
            case 'While': while (this.evaluate(statement.condition, env)) this.executeStatements(statement.body, this.childEnvironment(env)); return
            case 'ForOf': {
                const values = this.evaluate(statement.iterable, env) as any
                for (const value of values) { const local = this.childEnvironment(env); this.declare(local, statement.binding, value, statement.mutable); this.executeStatements(statement.body, local) }
                return
            }
        }
    }

    private evaluate(expression: Expression, env: Environment): any {
        switch (expression.kind) {
            case 'Literal': return expression.value
            case 'Identifier':
                if (expression.name === 'this') return this.lookup(env, 'this')?.value ?? null
                const binding = this.lookup(env, expression.name)
                if (!binding) throw new ReferenceError(`${expression.name} is not defined`)
                return binding.value
            case 'Assignment': {
                const binding = this.lookup(env, expression.name)
                if (!binding) throw new ReferenceError(`${expression.name} is not defined`)
                if (!binding.mutable) throw new TypeError(`Cannot assign to constant '${expression.name}'`)
                binding.value = this.evaluate(expression.value, env)
                return binding.value
            }
            case 'Array': return expression.elements.map(item => this.evaluate(item, env))
            case 'Object': {
                const object: Record<string, any> = {}
                Object.defineProperty(object, 'keys', { enumerable: false, value: function(this: object) { return Object.keys(this) } })
                for (const property of expression.properties) {
                    if (property.value.kind === 'Function') {
                        const fn = property.value
                        object[property.key] = { __junoFunction: true, params: fn.params, body: fn.body, closure: env, thisValue: object } satisfies RuntimeFunction
                    } else object[property.key] = this.evaluate(property.value, env)
                }
                return object
            }
            case 'Unary': { const value = this.evaluate(expression.operand, env); return expression.operator === '-' ? -value : !value }
            case 'Binary': {
                const left = this.evaluate(expression.left, env)
                const right = this.evaluate(expression.right, env)
            
                const bothNumbers = typeof left === 'number' && typeof right === 'number'
                const bothBigInts = typeof left === 'bigint' && typeof right === 'bigint'
                const bothStrings = typeof left === 'string' && typeof right === 'string'
            
                switch (expression.operator) {
                    case '+':
                        if (bothNumbers || bothBigInts || bothStrings) return left + (right as any)
                        throw new TypeError(
                            `Invalid operands for '+': ${typeof left} and ${typeof right}`
                        )
            
                    case '-':
                        if (bothNumbers || bothBigInts) return (left as any) - (right as any)
                        throw new TypeError(
                            `Invalid operands for '-': ${typeof left} and ${typeof right}`
                        )
            
                    case '*':
                        if (bothNumbers || bothBigInts) return (left as any) * (right as any)
                        throw new TypeError(
                            `Invalid operands for '*': ${typeof left} and ${typeof right}`
                        )
            
                    case '/':
                        if (bothNumbers || bothBigInts) return (left as any) / (right as any)
                        throw new TypeError(
                            `Invalid operands for '/': ${typeof left} and ${typeof right}`
                        )
            
                    case '%':
                        if (bothNumbers || bothBigInts) return (left as any) % (right as any)
                        throw new TypeError(
                            `Invalid operands for '%': ${typeof left} and ${typeof right}`
                        )
            
                    case '==':
                        return deepEqual(left, right)
            
                    case '!=':
                        return !deepEqual(left, right)
            
                    case '<':
                        if (bothNumbers || bothBigInts) return (left as any) < (right as any)
                        throw new TypeError(
                            `Invalid operands for '<': ${typeof left} and ${typeof right}`
                        )
            
                    case '<=':
                        if (bothNumbers || bothBigInts) return (left as any) <= (right as any)
                        throw new TypeError(
                            `Invalid operands for '<=': ${typeof left} and ${typeof right}`
                        )            
                    case '>':
                        if (bothNumbers || bothBigInts) return (left as any) > (right as any)
                        throw new TypeError(
                            `Invalid operands for '>': ${typeof left} and ${typeof right}`
                        )
            
                    case '>=':
                        if (bothNumbers || bothBigInts) return (left as any) >= (right as any)
                        throw new TypeError(
                            `Invalid operands for '>=': ${typeof left} and ${typeof right}`
                        )
            
                    case '|':
                        return Boolean(left) || Boolean(right)
            
                    case '&':
                        return Boolean(left) && Boolean(right)
            
                    default:
                        throw new Error(`Unsupported operator '${expression.operator}'`)
                }
            }
            case 'Member': {
                const object = this.evaluate(expression.object, env)
                return this.readMember(object, expression.property, expression.optional, expression.object, env)
            }
            case 'Index': {
                const object = this.evaluate(expression.object, env)
                const index = this.evaluate(expression.index, env)
                if (object == null) throw new TypeError('Cannot index null')
                if (Array.isArray(object)) {
                    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= object.length) {
                        throw new TypeError(`Array index must be an integer in [0, ${object.length}); received ${String(index)}`)
                    }
                } else if (typeof object === 'object' || typeof object === 'function') {
                    if (typeof index !== 'string' && typeof index !== 'number') {
                        throw new TypeError(`Object index must be a string or number; received ${typeof index}`)
                    }
                } else {
                    throw new TypeError(`Cannot index value of type ${typeof object}`)
                }
                return (object as any)[index as any] ?? null
            }
            case 'Call': {
                let thisValue: unknown
                let callee: any
                if (expression.callee.kind === 'Member') {
                    thisValue = this.evaluate(expression.callee.object, env)
                    callee = this.readMember(thisValue, expression.callee.property, expression.callee.optional, expression.callee.object, env)
                }
                else callee = this.evaluate(expression.callee, env)
                const args = expression.args.map(arg => this.evaluate(arg, env))
                if (expression.typeArguments?.length) args.push(expression.typeArguments[0].kind === 'NamedType' ? expression.typeArguments[0].name : 'object')
                if (typeof callee === 'function') return callee.apply(thisValue, args) ?? null
                if (callee?.__junoTypeConstructor) {
                    const input = args[0]
                    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`Constructor '${callee.typeName}' expects an object`)
                    return this.applyTypeDefaults(input, { kind: 'NamedType', name: callee.typeName }, env)
                }
                if (callee?.__junoFunction) return this.callFunction(callee, args, thisValue ?? callee.thisValue)
                throw new TypeError('Value is not callable')
            }
            case 'Function': {
                const body = expression.expressionBody
                    ? [{ kind: 'Return', value: expression.expressionBody } as Statement]
                    : expression.body
                return { __junoFunction: true, params: expression.params, body, closure: env } satisfies RuntimeFunction
            }
        }
    }

    private callFunction(fn: RuntimeFunction, args: unknown[], thisValue?: unknown): unknown {
        const local = this.childEnvironment(fn.closure)
        if (thisValue !== undefined) local.bindings.set('this', { value: thisValue, mutable: false })
        fn.params.forEach((param, index) => this.declare(local, param.name, args[index] ?? (param.defaultValue ? this.evaluate(param.defaultValue, local) : null), true))
        return this.executeStatements(fn.body, local) ?? null
    }

    private declare(env: Environment, name: string, value: unknown, mutable: boolean, declaredType?: TypeNode): void {
        if (env.bindings.has(name)) throw new SyntaxError(`Duplicate declaration '${name}' in the same scope`)
        env.bindings.set(name, { value, mutable, declaredType })
    }

    private childEnvironment(parent: Environment): Environment { return { bindings: new Map(), types: new Map(), parent } }
    private lookup(env: Environment, name: string): Binding | undefined {
        for (let current: Environment | undefined = env; current; current = current.parent) {
            const binding = current.bindings.get(name)
            if (binding) return binding
        }
        return undefined
    }

    private typeOf(expression: Expression, env: Environment): TypeNode | null {
        if (expression.kind === 'Identifier') return this.lookup(env, expression.name)?.declaredType ?? null
        if (expression.kind === 'Member') {
            const parentType = this.typeOf(expression.object, env)
            return parentType ? this.findTypeMember(parentType, expression.property, env)?.type ?? null : null
        }
        return null
    }

    private applyTypeDefaults<T extends Record<string, any>>(value: T, type: TypeNode, env: Environment, resolving = new Set<string>()): T {
        if (type.kind === 'NamedType') {
            if (resolving.has(type.name)) return value
            for (let current: Environment | undefined = env; current; current = current.parent) {
                const alias = current.types.get(type.name)
                if (alias) return this.applyTypeDefaults(value, alias, env, new Set([...resolving, type.name]))
            }
            return value
        }
        if (type.kind === 'IntersectionType') {
            for (const part of type.types) this.applyTypeDefaults(value, part, env, resolving)
            return value
        }
        if (type.kind !== 'ObjectType') return value
        for (const member of type.members) {
            if (member.method) continue
            if (!Object.prototype.hasOwnProperty.call(value, member.name) && member.defaultValue) {
                ;(value as Record<string, any>)[member.name] = this.evaluate(member.defaultValue, env)
            }
            const fieldValue = value[member.name]
            if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
                this.applyTypeDefaults(fieldValue, member.type, env, resolving)
            }
        }
        return value
    }

    private findTypeMember(type: TypeNode, name: string, env: Environment, resolving = new Set<string>()): { type: TypeNode; optional: boolean } | null {
        if (type.kind === 'NamedType') {
            if (resolving.has(type.name)) return null
            for (let current: Environment | undefined = env; current; current = current.parent) {
                const alias = current.types.get(type.name)
                if (alias) return this.findTypeMember(alias, name, env, new Set([...resolving, type.name]))
            }
            return null
        }
        if (type.kind === 'IntersectionType') {
            for (const part of type.types) {
                const member = this.findTypeMember(part, name, env, resolving)
                if (member) return member
            }
            return null
        }
        if (type.kind !== 'ObjectType') return null
        const member = type.members.find(item => item.name === name)
        return member ? { type: member.type, optional: member.optional } : null
    }

    private readMember(object: unknown, property: string, optional: boolean, owner: Expression, env: Environment): unknown {
        if (object === null || object === undefined) {
            if (optional) return null
            throw new TypeError(`Cannot read property '${property}' of null`)
        }
        const declaredType = this.typeOf(owner, env)
        if (declaredType && !this.findTypeMember(declaredType, property, env)) {
            throw new TypeError(`Property '${property}' does not exist on declared type`)
        }
        const value = (object as any)[property]
        return value === undefined ? null : value
    }
}

function deepEqual(a: any, b: any): boolean {
    if (Object.is(a, b)) return true
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
    if (Array.isArray(a) !== Array.isArray(b)) return false
    const keysA = Object.keys(a), keysB = Object.keys(b)
    return keysA.length === keysB.length && keysA.every(key => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]))
}

function matchesType(value: unknown, type: unknown): boolean {
    if (typeof type !== 'string') return false
    switch (type) {
        case 'string': return typeof value === 'string'
        case 'number': return typeof value === 'number'
        case 'boolean': return typeof value === 'boolean'
        case 'null': return value === null
        case 'Array': return Array.isArray(value)
        case 'object': return value !== null && typeof value === 'object'
        default: return false
    }
}

export function runFile(file: string): void {
    const path = resolve(file)
    const source = readFileSync(path, 'utf8')
    new Interpreter().run(source)
}
