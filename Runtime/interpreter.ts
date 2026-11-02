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
                const adaptedModule = this.adaptModule(module, env)
                if (statement.defaultImport) this.declare(env, statement.defaultImport, adaptedModule, false)
                for (const name of statement.namedImports) {
                    if (!(name in module)) throw new Error(`Module '${statement.module}' has no export '${name}'`)
                    this.declare(env, name, name === 'console' ? this.adaptConsole(module[name] as Record<string, any>) : module[name], false)
                }
                return
            }
            case 'Variable': {
                let value = statement.initializer ? this.evaluate(statement.initializer, env) : null
                if (statement.type && value && typeof value === 'object' && !Array.isArray(value)) value = this.applyTypeDefaults(value, statement.type, env)
                const declaredType = statement.type ?? (statement.initializer ? this.inferValueType(statement.initializer, env) : undefined)
                this.declare(env, statement.name, value, statement.mutable, declaredType)
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
            case 'If': this.executeStatements(this.requireCondition(this.evaluate(statement.condition, env)) ? statement.consequent : (statement.alternate ?? []), this.childEnvironment(env)); return
            case 'While': while (this.requireCondition(this.evaluate(statement.condition, env))) this.executeStatements(statement.body, this.childEnvironment(env)); return
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
            case 'Template': return expression.parts.map(part => typeof part === 'string' ? part : this.toJunoString(this.evaluate(part, env))).join('')
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
            case 'Array': {
                const array = expression.elements.map(item => this.evaluate(item, env))
                Object.defineProperty(array, 'toString', { enumerable: false, value: function(this: object) { return stringifyJunoObject(this) } })
                return array
            }
            case 'Object': {
                const object: Record<string, any> = {}
                Object.defineProperty(object, 'keys', { enumerable: false, value: function(this: object) { return Object.keys(this) } })
                object.toString = this.defaultToString()
                for (const property of expression.properties) {
                    if (property.value.kind === 'Function') {
                        const fn = property.value
                        object[property.key] = { __junoFunction: true, params: fn.params, body: fn.body, closure: env, thisValue: object } satisfies RuntimeFunction
                    } else object[property.key] = this.evaluate(property.value, env)
                }
                return object
            }
            case 'Unary': {
                const value = this.evaluate(expression.operand, env)
                if (expression.operator === 'postfix!') {
                    if (value == null) throw new TypeError('Non-null assertion failed: value is null')
                    return value
                }
                if (value == null) throw new TypeError(`Cannot apply '${expression.operator}' to null`)
                return expression.operator === '-' ? -value : !value
            }
            case 'Binary': {
                const left = this.evaluate(expression.left, env)
                if (expression.operator === '??') return left ?? this.evaluate(expression.right, env)
                const right = this.evaluate(expression.right, env)
                if ((left == null || right == null) && expression.operator !== '==' && expression.operator !== '!=') {
                    throw new TypeError(`Cannot apply '${expression.operator}' to null; use ! or ?? to handle null`)
                }
            
                const bothNumbers = typeof left === 'number' && typeof right === 'number'
                const bothBigInts = typeof left === 'bigint' && typeof right === 'bigint'
                const bothStrings = typeof left === 'string' && typeof right === 'string'
                const typeName = (value: unknown) => value === null ? 'null' : typeof value
            
                switch (expression.operator) {
                    case '+':
                        if (bothNumbers || bothBigInts || bothStrings) return left + (right as any)
                        throw new TypeError(
                            `Invalid operands for '+': ${typeName(left)} and ${typeName(right)}`
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
            case 'Conditional':
                return this.requireCondition(this.evaluate(expression.condition, env))
                    ? this.evaluate(expression.consequent, env)
                    : this.evaluate(expression.alternate, env)
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
                if (expression.callee.kind === 'Member' && expression.callee.property === 'as' && expression.typeArguments?.length) {
                    const value = this.evaluate(expression.callee.object, env)
                    if (value === null || value === undefined) throw new TypeError('Cannot cast null with as<T>()')
                    const targetType = expression.typeArguments[0]
                    if (!this.matchesTypeNode(value, targetType, env)) {
                        throw new TypeError(`Value does not match type '${typeName(targetType)}'`)
                    }
                    return value
                }
                const staticCalleeType = this.typeOf(expression.callee, env) ?? this.inferValueType(expression.callee, env)
                if (staticCalleeType.kind === 'UnionType') {
                    const nonCallable = staticCalleeType.types.find(part => !this.isCallableType(part))
                    if (nonCallable) throw new TypeError(`This expression is not callable. Type '${typeName(nonCallable)}' has no call signatures.`)
                }
                if (expression.callee.kind === 'Identifier' && expression.callee.name === 'isType' && expression.typeArguments?.length) {
                    const value = expression.args[0] ? this.evaluate(expression.args[0], env) : null
                    return this.matchesTypeNode(value, expression.typeArguments[0], env)
                }
                let thisValue: unknown
                let callee: any
                if (expression.callee.kind === 'Member') {
                    thisValue = this.evaluate(expression.callee.object, env)
                    if (thisValue == null && expression.callee.optional) return null
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
        let argumentIndex = 0
        for (const param of fn.params) {
            if (param.rest) {
                this.declare(local, param.name, args.slice(argumentIndex), true)
                argumentIndex = args.length
            } else {
                const value = argumentIndex < args.length ? args[argumentIndex] : param.defaultValue ? this.evaluate(param.defaultValue, local) : null
                argumentIndex++
                this.declare(local, param.name, value, true)
            }
        }
        return this.executeStatements(fn.body, local) ?? null
    }

    private declare(env: Environment, name: string, value: unknown, mutable: boolean, declaredType?: TypeNode): void {
        if (env.bindings.has(name)) throw new SyntaxError(`Duplicate declaration '${name}' in the same scope`)
        env.bindings.set(name, { value, mutable, declaredType })
    }

    private childEnvironment(parent: Environment): Environment { return { bindings: new Map(), types: new Map(), parent } }

    private adaptModule(module: Record<string, any>, env: Environment): Record<string, any> {
        if (!('console' in module)) return module
        return { ...module, console: this.adaptConsole(module.console) }
    }

    private adaptConsole(consoleObject: Record<string, any>): Record<string, any> {
        const convert = (args: unknown[]) => args.map(value => value !== null && (typeof value === 'object' || typeof value === 'function') ? this.toJunoString(value) : value)
        return {
            ...consoleObject,
            log: (...args: unknown[]) => consoleObject.log(...convert(args)),
            error: (...args: unknown[]) => consoleObject.error(...convert(args)),
            warn: (...args: unknown[]) => consoleObject.warn(...convert(args))
        }
    }

    private toJunoString(value: unknown): string {
        if (value === null || value === undefined) return String(value)
        if ((typeof value === 'object' || typeof value === 'function') && value !== null) {
            const method = (value as any).toString
            if (typeof method === 'function') return String(method.call(value))
            if (method?.__junoFunction) return String(this.callFunction(method, [], value))
        }
        return String(value)
    }

    private defaultToString(): (this: object) => string {
        const method = function(this: object) { return stringifyJunoObject(this) }
        Object.defineProperty(method, '__junoDefaultToString', { value: true })
        return method
    }

    private requireCondition(value: unknown): boolean {
        if (value == null) throw new TypeError('Cannot use null as a condition; use ! or ?? to handle null')
        return Boolean(value)
    }
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
        if (expression.kind === 'Index') {
            const parentType = this.typeOf(expression.object, env) ?? this.inferValueType(expression.object, env)
            const resolved = this.resolveAliasType(parentType, env)
            if (resolved.kind === 'ArrayType') return resolved.element
            if (resolved.kind === 'GenericType' && (resolved.name === 'Array' || resolved.name === 'ReadonlyArray')) return resolved.args[0] ?? { kind: 'NamedType', name: 'any' }
        }
        return null
    }

    private inferValueType(expression: Expression, env: Environment): TypeNode {
        switch (expression.kind) {
            case 'Literal':
                return { kind: 'NamedType', name: expression.value === null ? 'null' : typeof expression.value === 'bigint' ? 'BigInt' : typeof expression.value }
            case 'Template': return { kind: 'NamedType', name: 'string' }
            case 'Identifier': return this.lookup(env, expression.name)?.declaredType ?? { kind: 'NamedType', name: 'any' }
            case 'Array': {
                const elements = expression.elements.map(item => this.inferValueType(item, env))
                const flattened = elements.flatMap(type => type.kind === 'UnionType' ? type.types : [type])
                return { kind: 'ArrayType', element: flattened.length === 0 ? { kind: 'NamedType', name: 'any' } : flattened.length === 1 ? flattened[0] : { kind: 'UnionType', types: flattened } }
            }
            case 'Object':
                return { kind: 'ObjectType', members: expression.properties.map(property => property.value.kind === 'Function'
                    ? { name: property.key, type: this.inferValueType(property.value, env), optional: false, readonly: false, constant: false }
                    : { name: property.key, type: this.inferValueType(property.value, env), optional: false, readonly: false, constant: false }) }
            case 'Function':
                return {
                    kind: 'FunctionType',
                    params: expression.params.map(param => param.type ?? { kind: 'NamedType', name: 'any' }),
                    result: expression.returnType ?? { kind: 'NamedType', name: 'any' }
                }
            case 'Index': return this.typeOf(expression, env) ?? { kind: 'NamedType', name: 'any' }
            case 'Call':
                if (expression.callee.kind === 'Member' && expression.callee.property === 'as' && expression.typeArguments?.length) return expression.typeArguments[0]
                return { kind: 'NamedType', name: 'any' }
            default: return { kind: 'NamedType', name: 'any' }
        }
    }

    private resolveAliasType(type: TypeNode, env: Environment, resolving = new Set<string>()): TypeNode {
        if (type.kind === 'NamedType') {
            if (resolving.has(type.name)) return type
            for (let current: Environment | undefined = env; current; current = current.parent) {
                const alias = current.types.get(type.name)
                if (alias) return this.resolveAliasType(alias, env, new Set([...resolving, type.name]))
            }
            return type
        }
        if (type.kind === 'UnionType' || type.kind === 'IntersectionType') return { ...type, types: type.types.map(part => this.resolveAliasType(part, env, resolving)) }
        if (type.kind === 'ArrayType') return { ...type, element: this.resolveAliasType(type.element, env, resolving) }
        return type
    }

    private isCallableType(type: TypeNode): boolean {
        return type.kind === 'FunctionType' || (type.kind === 'NamedType' && type.name === 'any')
    }

    private matchesTypeNode(value: unknown, type: TypeNode, env: Environment, resolving = new Set<string>()): boolean {
        if (type.kind === 'NamedType') {
            if (type.name === 'any' || type.name === 'unknown') return true
            if (type.name === 'null') return value === null
            if (type.name === 'Array' || type.name === 'ReadonlyArray') return Array.isArray(value)
            for (let current: Environment | undefined = env; current; current = current.parent) {
                const alias = current.types.get(type.name)
                if (alias) {
                    if (resolving.has(type.name)) return false
                    return this.matchesTypeNode(value, alias, env, new Set([...resolving, type.name]))
                }
            }
            switch (type.name) {
                case 'string': return typeof value === 'string'
                case 'number': return typeof value === 'number'
                case 'boolean': return typeof value === 'boolean'
                case 'BigInt': return typeof value === 'bigint'
                case 'object': return value !== null && typeof value === 'object'
                case 'Function': return typeof value === 'function' || Boolean((value as any)?.__junoFunction)
                default: return false
            }
        }
        if (type.kind === 'LiteralType') return value === type.value
        if (type.kind === 'ArrayType') return Array.isArray(value) && value.every(item => this.matchesTypeNode(item, type.element, env, resolving))
        if (type.kind === 'GenericType') {
            if ((type.name === 'Array' || type.name === 'ReadonlyArray') && type.args[0]) {
                return Array.isArray(value) && value.every(item => this.matchesTypeNode(item, type.args[0], env, resolving))
            }
            return this.matchesTypeNode(value, { kind: 'NamedType', name: type.name }, env, resolving)
        }
        if (type.kind === 'UnionType') return type.types.some(part => this.matchesTypeNode(value, part, env, resolving))
        if (type.kind === 'IntersectionType') return type.types.every(part => this.matchesTypeNode(value, part, env, resolving))
        if (type.kind === 'FunctionType') return typeof value === 'function' || Boolean((value as any)?.__junoFunction)
        if (type.kind === 'ObjectType') {
            if (value === null || typeof value !== 'object') return false
            const object = value as Record<string, any>
            return type.members.every(member => {
                if (!Object.prototype.hasOwnProperty.call(object, member.name)) return member.optional || member.defaultValue !== undefined
                const memberValue = object[member.name]
                if (member.method) return typeof memberValue === 'function' || Boolean(memberValue?.__junoFunction)
                return this.matchesTypeNode(memberValue, member.type, env, resolving)
            })
        }
        return false
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
        if (type.kind === 'UnionType') {
            for (const part of type.types) {
                if (part.kind === 'NamedType' && part.name === 'null') continue
                this.applyTypeDefaults(value, part, env, resolving)
            }
            return value
        }
        if (type.kind !== 'ObjectType') return value
        const runtimeValue = value as Record<string, any>
        if (typeof runtimeValue.toString !== 'function' && !(runtimeValue.toString as any)?.__junoFunction) {
            runtimeValue.toString = this.defaultToString()
        }
        for (const member of type.members) {
            if (member.method) {
                const isDefaultToString = member.name === 'toString' && runtimeValue[member.name]?.__junoDefaultToString
                if (member.body && (isDefaultToString || (typeof runtimeValue[member.name] !== 'function' && !runtimeValue[member.name]?.__junoFunction))) {
                    ;(value as Record<string, any>)[member.name] = { __junoFunction: true, params: member.params ?? [], body: member.body, closure: env, thisValue: value } satisfies RuntimeFunction
                }
                continue
            }
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
            if (name === 'toString' && type.name !== 'null') return { type: { kind: 'NamedType', name: 'string' }, optional: false }
            return null
        }
        if (type.kind === 'IntersectionType') {
            for (const part of type.types) {
                const member = this.findTypeMember(part, name, env, resolving)
                if (member) return member
            }
            return null
        }
        if (type.kind === 'UnionType') {
            let commonMember: { type: TypeNode; optional: boolean } | null = null
            for (const part of type.types) {
                const member = this.findTypeMember(part, name, env, resolving)
                if (!member) return null
                commonMember ??= member
            }
            return commonMember
        }
        if (type.kind === 'ObjectType') {
            const member = type.members.find(item => item.name === name)
            if (member) return { type: member.type, optional: member.optional }
        }
        if (name === 'toString' && !(type.kind === 'LiteralType' && type.value === null)) {
            return { type: { kind: 'NamedType', name: 'string' }, optional: false }
        }
        return null
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
        if (!(property in Object(object))) throw new TypeError(`Property '${property}' does not exist on value`)
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

function stringifyJunoObject(value: object): string {
    return JSON.stringify(value, (_key, item) => {
        if (item && typeof item === 'object' && item.__junoFunction) return undefined
        if (typeof item === 'bigint') return String(item)
        return item
    }) ?? 'null'
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

function typeName(type: TypeNode): string {
    switch (type.kind) {
        case 'NamedType': return type.name
        case 'LiteralType': return String(type.value)
        case 'GenericType': return `${type.name}<${type.args.map(typeName).join(', ')}>`
        case 'ArrayType': return `${typeName(type.element)}[]`
        case 'UnionType': return type.types.map(typeName).join(' | ')
        case 'IntersectionType': return type.types.map(typeName).join(' & ')
        case 'FunctionType': return 'function'
        case 'ObjectType': return 'object'
    }
}

export function runFile(file: string): void {
    const path = resolve(file)
    const source = readFileSync(path, 'utf8')
    new Interpreter().run(source)
}
