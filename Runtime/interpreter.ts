import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { Expression, Parameter, Statement, TypeNode, parse } from '../Lexer/parser'
import { resolveModule } from '../Modules'

type Binding = { value: unknown; mutable: boolean; declaredType?: TypeNode }
type TypeAlias = { value: TypeNode; generics: string[] }
type Environment = { bindings: Map<string, Binding>; types: Map<string, TypeAlias>; parent?: Environment }
type RuntimeFunction = { __junoFunction: true; params: Parameter[]; body: Statement[]; closure: Environment; thisValue?: unknown }
type RuntimeConstructor = { __junoConstructor: true; inheritedType: TypeNode; overloads: RuntimeFunction[]; [name: string]: unknown }
class ReturnValue { constructor(readonly value: unknown) {} }

export class Interpreter {
    private readonly globals: Environment = { bindings: new Map(), types: new Map() }
    private currentDirectory = process.cwd()
    constructor() {
        this.globals.bindings.set('isType', { value: (value: unknown, type: unknown) => matchesType(value, type), mutable: false })
        this.globals.bindings.set('RegEx', {
            value: (pattern: string | RegExp, flags?: string) => new RegExp(pattern, flags),
            mutable: false,
            declaredType: { kind: 'FunctionType', params: [{ kind: 'NamedType', name: 'string' }, { kind: 'NamedType', name: 'string' }], result: { kind: 'NamedType', name: 'RegEx' } }
        })
    }

    run(source: string, filePath?: string): void {
        const statements = parse(source, { filePath })
        for (const statement of statements) {
            if (statement.kind === 'TypeDeclaration') {
                this.globals.types.set(statement.name, { value: statement.value, generics: statement.generics })
                this.registerTypeDeclarations(statement.value, this.globals)
            } else if (statement.kind === 'Export' && statement.declaration.kind === 'TypeDeclaration') {
                this.globals.types.set(statement.declaration.name, { value: statement.declaration.value, generics: statement.declaration.generics })
                this.registerTypeDeclarations(statement.declaration.value, this.globals)
            }
        }
        this.executeStatements(statements, this.globals)
    }

    private executeStatements(statements: Statement[], env: Environment): unknown {
        for (const statement of statements) this.execute(statement, env)
        return null
    }

    private execute(statement: Statement, env: Environment): void {
        switch (statement.kind) {
            case 'Import': {
                const module = ['juno', 'juno:node', 'types'].includes(statement.module)
                    ? resolveModule(statement.module) as Record<string, unknown>
                    : this.loadLocalModule(statement.module, env)
                const adaptedModule = this.adaptModule(module, env)
                if (statement.defaultImport) this.declare(env, statement.defaultImport, adaptedModule, false)
                for (const name of statement.namedImports) {
                    if (!(name in module) && !(module as any).__junoTypes?.[name]) throw new Error(`Module '${statement.module}' has no export '${name}'`)
                    if (statement.module === 'juno' && name === 'Range') {
                        const rangeModule = this.loadLocalModule('juno/types/range', env)
                        this.declare(env, name, rangeModule.Range, false)
                        continue
                    }
                    if (!(name in module) && (module as any).__junoTypes?.[name]) {
                        const alias = (module as any).__junoTypes[name] as TypeAlias
                        ;(statement.importedTypes ??= {})[name] = alias.value
                        env.types.set(name, alias)
                        this.declare(env, name, { __junoTypeConstructor: true, typeName: name, typeNode: alias.value, generics: alias.generics }, false)
                        continue
                    }
                    const importedValue = name === 'console' ? this.adaptConsole(module[name] as Record<string, any>) : module[name]
                    if (importedValue && typeof importedValue === 'object') this.installDefaultHas(importedValue)
                    this.declare(env, name, importedValue, false)
                    const exportedType = (module as any).__junoTypes?.[name] as TypeAlias | undefined
                    if (exportedType) { env.types.set(name, exportedType); (statement.importedTypes ??= {})[name] = exportedType.value }
                }
                return
            }
            case 'Export': this.execute(statement.declaration, env); return
            case 'Variable': {
                if (statement.type) this.registerTypeDeclarations(statement.type, env)
                let value = statement.initializer ? this.evaluate(statement.initializer, env) : null
                if (statement.type && value && typeof value === 'object' && !Array.isArray(value)) value = this.applyTypeDefaults(value, statement.type, env)
                const declaredType = statement.type ?? (statement.initializer ? this.inferValueType(statement.initializer, env) : undefined)
                this.declare(env, statement.name, value, statement.mutable, declaredType)
                return
            }
            case 'Destructure': {
                const value = this.evaluate(statement.initializer, env)
                if (value === null || typeof value !== 'object') throw new TypeError('Object destructuring requires an object')
                for (const binding of statement.bindings) this.declare(env, binding.name, (value as any)[binding.name], statement.mutable)
                return
            }
            case 'TypeDeclaration': {
                env.types.set(statement.name, { value: statement.value, generics: statement.generics })
                this.registerTypeDeclarations(statement.value, env)
                this.declare(env, statement.name, { __junoTypeConstructor: true, typeName: statement.name, typeNode: statement.value, generics: statement.generics }, false)
                return
            }
            case 'FunctionDeclaration': this.declare(env, statement.name, { __junoFunction: true, params: statement.params, body: statement.body, closure: env } satisfies RuntimeFunction, false); return
            case 'ConstructorDeclaration': {
                if (!statement.overloads.length) throw new TypeError(`Constructor '${statement.name}' needs at least one anonymous function`)
                this.registerTypeDeclarations(statement.inheritedType, env)
                const overloads = statement.overloads.map(overload => ({ __junoFunction: true as const, params: overload.params, body: overload.body, closure: env }))
                const constructor: RuntimeConstructor = { __junoConstructor: true, inheritedType: statement.inheritedType, overloads }
                for (const method of statement.methods) constructor[method.name] = { __junoFunction: true, params: method.params, body: method.body, closure: env } satisfies RuntimeFunction
                this.declare(env, statement.name, constructor, false)
                return
            }
            case 'Return': throw new ReturnValue(statement.value ? this.evaluate(statement.value, env) : null)
            case 'ExpressionStatement': this.evaluate(statement.expression, env); return
            case 'If': this.executeStatements(this.requireCondition(this.evaluate(statement.condition, env)) ? statement.consequent : (statement.alternate ?? []), this.childEnvironment(env)); return
            case 'While': while (this.requireCondition(this.evaluate(statement.condition, env))) this.executeStatements(statement.body, this.childEnvironment(env)); return
            case 'ForOf': {
                const iterable = this.evaluate(statement.iterable, env) as any
                const values = Array.isArray(iterable) || iterable?.[Symbol.iterator]
                    ? iterable
                    : iterable?.toArray?.__junoFunction
                        ? this.callFunction(iterable.toArray, [], iterable)
                        : iterable && typeof iterable.toArray === 'function'
                            ? iterable.toArray()
                            : iterable
                for (const value of values) { const local = this.childEnvironment(env); this.declare(local, statement.binding, value, statement.mutable); this.executeStatements(statement.body, local) }
                return
            }
        }
    }

    private registerTypeDeclarations(type: TypeNode, env: Environment, seen = new Set<TypeNode>()): void {
        if (seen.has(type)) return
        seen.add(type)
        if (type.kind === 'NamedType') {
            if (type.name === 'Iterable') {
                const declarations = parse(readFileSync(resolve(__dirname, '../../types/iterable.jn'), 'utf8'))
                for (const declaration of declarations) if (declaration.kind === 'Export' && declaration.declaration.kind === 'TypeDeclaration') {
                    const alias = { value: declaration.declaration.value, generics: declaration.declaration.generics }
                    env.types.set(declaration.declaration.name, alias)
                    if (!env.bindings.has(declaration.declaration.name)) {
                        this.declare(env, declaration.declaration.name, { __junoTypeConstructor: true, typeName: declaration.declaration.name, typeNode: alias.value, generics: alias.generics }, false)
                    }
                }
            }
            return
        }
        if (type.kind === 'GenericType') {
            if (type.name === 'Iterable') this.registerTypeDeclarations({ kind: 'NamedType', name: 'Iterable' }, env, seen)
            type.args.forEach(argument => this.registerTypeDeclarations(argument, env, seen))
        }
        else if (type.kind === 'UnionType' || type.kind === 'IntersectionType') type.types.forEach(part => this.registerTypeDeclarations(part, env, seen))
        else if (type.kind === 'ObjectType') type.members.forEach(member => this.registerTypeDeclarations(member.type, env, seen))
        else if (type.kind === 'ArrayType') this.registerTypeDeclarations(type.element, env, seen)
    }

    private loadLocalModule(specifier: string, env: Environment): Record<string, unknown> {
        const junoTypeModule = specifier === 'juno/types' ? 'index' : /^juno\/types\/(.+)$/.exec(specifier)?.[1]
        if (!junoTypeModule && !specifier.startsWith('.') && !isAbsolute(specifier)) throw new Error(`Unsupported module '${specifier}'`)
        const base = junoTypeModule
            ? resolve(__dirname, '../../types', junoTypeModule)
            : resolve(this.currentDirectory, specifier)
        const candidates = /\.jn$/i.test(base) ? [base] : [`${base}.jn`, resolve(base, 'index.jn')]
        let source: string | undefined
        let file = candidates[0]
        for (const candidate of candidates) {
            try { source = readFileSync(candidate, 'utf8'); file = candidate; break } catch { /* try next candidate */ }
        }
        if (source === undefined) throw new Error(`Cannot find module '${specifier}'`)
        const previousDirectory = this.currentDirectory
        this.currentDirectory = resolve(base, '..')
        const moduleEnv: Environment = { bindings: new Map(), types: new Map(), parent: env }
        const importedModule = (specifier: string, importer: Environment): Record<string, unknown> => {
            if (specifier === 'juno/types' || specifier.startsWith('juno/types/')) return this.loadLocalModule(specifier, importer)
            const moduleBase = resolve(this.currentDirectory, specifier)
            const options = /\.jn$/i.test(moduleBase) ? [moduleBase] : [`${moduleBase}.jn`, resolve(moduleBase, 'index.jn')]
            const target = options.find(candidate => { try { return readFileSync(candidate).length >= 0 } catch { return false } })
            if (!target) throw new Error(`Cannot find module '${specifier}'`)
            const saved = this.currentDirectory
            this.currentDirectory = resolve(target, '..')
            try { return this.loadLocalModule(target, importer) } finally { this.currentDirectory = saved }
        }
        const exported: Record<string, unknown> = {}
        const statements = parse(source)
        for (const statement of statements) {
            if (statement.kind === 'Export') {
                this.execute(statement.declaration, moduleEnv)
                const declaration = statement.declaration
                if (declaration.kind === 'Import') {
                    if (declaration.defaultImport) {
                        const binding = this.lookup(moduleEnv, declaration.defaultImport)
                        if (binding) exported[statement.default ? 'default' : declaration.defaultImport] = binding.value
                    }
                    for (const name of declaration.namedImports) {
                        const binding = this.lookup(moduleEnv, name)
                        if (binding) exported[name] = binding.value
                        const alias = moduleEnv.types.get(name)
                        if (alias) (exported as any).__types ??= {}, (exported as any).__types[name] = alias
                    }
                    continue
                }
                if (declaration.kind !== 'Variable' && declaration.kind !== 'FunctionDeclaration' && declaration.kind !== 'TypeDeclaration' && declaration.kind !== 'ConstructorDeclaration') continue
                const binding = this.lookup(moduleEnv, declaration.name)
                if (binding) exported[statement.default ? 'default' : declaration.name] = binding.value
                if (declaration.kind === 'TypeDeclaration') {
                    const alias = moduleEnv.types.get(declaration.name)
                    if (alias) (exported as any).__types ??= {}, (exported as any).__types[declaration.name] = alias
                }
            } else if (statement.kind === 'Import') {
                const dependency = ['juno', 'juno:node', 'types'].includes(statement.module)
                    ? resolveModule(statement.module) as Record<string, unknown>
                    : importedModule(statement.module, moduleEnv)
                if (statement.defaultImport) this.declare(moduleEnv, statement.defaultImport, this.adaptModule(dependency, moduleEnv), false)
                for (const name of statement.namedImports) {
                    if (dependency[name] !== undefined) this.declare(moduleEnv, name, dependency[name], false)
                    else if ((dependency as any).__junoTypes?.[name]) {
                        const alias = (dependency as any).__junoTypes[name] as TypeAlias
                        moduleEnv.types.set(name, alias)
                        this.declare(moduleEnv, name, { __junoTypeConstructor: true, typeName: name, typeNode: alias.value, generics: alias.generics }, false)
                    } else throw new Error(`Module '${statement.module}' has no export '${name}'`)
                }
            } else this.execute(statement, moduleEnv)
        }
        Object.defineProperty(exported, '__junoTypes', { value: (exported as any).__types ?? {}, enumerable: false })
        this.currentDirectory = previousDirectory
        return exported
    }

    private evaluate(expression: Expression, env: Environment): any {
        switch (expression.kind) {
            case 'Literal': return expression.value
            case 'RegEx': return new RegExp(expression.source, expression.flags)
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
                const right = this.evaluate(expression.value, env)
                binding.value = expression.operator && expression.operator !== '='
                    ? this.applyCompoundOperator(expression.operator, binding.value, right)
                    : right
                return binding.value
            }
            case 'MemberAssignment': {
                const object = this.evaluate(expression.object, env)
                if (object === null || object === undefined) throw new TypeError(`Cannot set property '${expression.property}' of null`)
                const key = expression.index ? this.evaluate(expression.index, env) : expression.property!
                const right = this.evaluate(expression.value, env)
                const current = expression.operator && expression.operator !== '=' ? (object as any)[key as any] : undefined
                const value = expression.operator && expression.operator !== '=' ? this.applyCompoundOperator(expression.operator, current, right) : right
                ;(object as any)[key as any] = value
                return value
            }
            case 'Array': {
                const array = expression.elements.map(item => this.evaluate(item, env))
                Object.defineProperty(array, 'toString', { enumerable: false, value: function(this: object) { return stringifyJunoObject(this) } })
                this.installDefaultHas(array)
                return array
            }
            case 'Object': {
                const object: Record<string, any> = {}
                const accessors = new Map<string, PropertyDescriptor>()
                const readonly = new Set<string>()
                Object.defineProperty(object, 'keys', { enumerable: false, value: function(this: object) { return Object.keys(this) } })
                object.toString = this.defaultToString()
                this.installDefaultHas(object)
                for (const property of expression.properties) {
                    if (property.spread) {
                        let source = this.evaluate(property.value, env)
                        if (source?.__junoTypeConstructor) source = this.applyTypeDefaults({}, { kind: 'NamedType', name: source.typeName }, env)
                        if (!source || typeof source !== 'object') throw new TypeError('Object spread requires an object')
                        for (const key of Object.keys(source)) object[key] = source[key]
                        continue
                    }
                    if (property.accessor && property.value.kind === 'Function') {
                        const previous = accessors.get(property.key) ?? Object.getOwnPropertyDescriptor(object, property.key) ?? { enumerable: true, configurable: true }
                        const fn = property.value
                        const runtimeFn: RuntimeFunction = { __junoFunction: true, params: fn.params, body: fn.expressionBody ? [{ kind: 'Return', value: fn.expressionBody }] : fn.body, closure: env, thisValue: object }
                        delete previous.value
                        delete previous.writable
                        if (property.accessor === 'get') previous.get = () => this.callFunction(runtimeFn, [], object)
                        else previous.set = (value: unknown) => { this.callFunction(runtimeFn, [value], object) }
                        previous.enumerable = true
                        previous.configurable = true
                        accessors.set(property.key, previous)
                        continue
                    }
                    if (property.value.kind === 'Function') {
                        const fn = property.value
                        object[property.key] = { __junoFunction: true, params: fn.params, body: fn.expressionBody ? [{ kind: 'Return', value: fn.expressionBody }] : fn.body, closure: env, thisValue: object } satisfies RuntimeFunction
                    } else object[property.key] = this.evaluate(property.value, env)
                    if (property.readonly) readonly.add(property.key)
                }
                for (const [key, descriptor] of accessors) Object.defineProperty(object, key, descriptor)
                for (const key of readonly) Object.defineProperty(object, key, { ...Object.getOwnPropertyDescriptor(object, key), writable: false, enumerable: true, configurable: false })
                return object
            }
            case 'Unary': {
                if (expression.operator.endsWith('++') || expression.operator.endsWith('--')) {
                    const oldValue = this.evaluate(expression.operand, env)
                    const amount = typeof oldValue === 'bigint' ? 1n : typeof oldValue === 'number' ? 1 : null
                    if (amount === null) throw new TypeError(`Cannot apply '${expression.operator}' to a value of type ${typeof oldValue}; expected number or BigInt`)
                    const updated = expression.operator.endsWith('++') ? (oldValue as any) + (amount as any) : (oldValue as any) - (amount as any)
                    this.writeTarget(expression.operand, updated, env)
                    return expression.operator.startsWith('prefix') ? updated : oldValue
                }
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
                if (expression.callee.kind === 'Member' && expression.callee.property === 'isType' && expression.typeArguments?.length) {
                    return this.matchesTypeNode(this.evaluate(expression.callee.object, env), expression.typeArguments[0], env)
                }
                if (expression.callee.kind === 'Identifier' && expression.callee.name === 'isType' && expression.typeArguments?.length) {
                    const value = expression.args[0] ? this.evaluate(expression.args[0], env) : null
                    return this.matchesTypeNode(value, expression.typeArguments[0], env)
                }
                if (expression.callee.kind === 'Identifier' && expression.callee.name === 'isType' && expression.args.length >= 2) {
                    const value = this.evaluate(expression.args[0], env)
                    const target = this.evaluate(expression.args[1], env) as any
                    const targetType = target?.typeNode as TypeNode | undefined
                    if (targetType) return this.matchesTypeNode(value, targetType, env)
                    return matchesType(value, target)
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
                const passesRuntimeType = expression.callee.kind === 'Identifier' && expression.callee.name === 'isType'
                    || expression.callee.kind === 'Member' && (expression.callee.property === 'isType' || expression.callee.property === 'as')
                if (passesRuntimeType && expression.typeArguments?.length) args.push(expression.typeArguments[0].kind === 'NamedType' ? expression.typeArguments[0].name : 'object')
                if (typeof callee === 'function') {
                    const nativeArgs = args.map(argument => argument?.__junoFunction
                        ? (...values: unknown[]) => this.callFunction(argument as RuntimeFunction, values)
                        : argument)
                    return callee.apply(thisValue, nativeArgs) ?? null
                }
                if (callee?.__junoConstructor) {
                    const constructor = callee as RuntimeConstructor
                    if (!constructor.overloads.length) throw new TypeError('A constructor needs at least one anonymous function')
                    const overload = constructor.overloads.find(candidate => {
                        const nullable = (type: TypeNode | undefined): boolean => Boolean(type && (
                            type.kind === 'NamedType' && type.name === 'null' ||
                            type.kind === 'UnionType' && type.types.some(part => nullable(part))
                        ))
                        const required = candidate.params.filter(param => !param.rest && param.defaultValue === undefined && !nullable(param.type)).length
                        const maximum = candidate.params.some(param => param.rest) ? Number.POSITIVE_INFINITY : candidate.params.length
                        return args.length >= required && args.length <= maximum
                    })
                    if (!overload) throw new TypeError(`No constructor overload accepts ${args.length} argument(s)`)
                    const value = this.callFunction(overload, args)
                    if (!value || typeof value !== 'object') throw new TypeError('A constructor must return an object')
                    return this.applyTypeDefaults(value, constructor.inheritedType, overload.closure)
                }
                if (callee?.__junoTypeConstructor) {
                    const input = args[0] ?? {}
                    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`Constructor '${callee.typeName}' expects an object`)
                    const targetType: TypeNode = expression.typeArguments?.length
                        ? { kind: 'GenericType', name: callee.typeName, args: expression.typeArguments }
                        : { kind: 'NamedType', name: callee.typeName }
                    return this.applyTypeDefaults(input, targetType, env)
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
                if (param.name !== '_') this.declare(local, param.name, args.slice(argumentIndex), true)
                argumentIndex = args.length
            } else {
                const value = argumentIndex < args.length ? args[argumentIndex] : param.defaultValue ? this.evaluate(param.defaultValue, local) : null
                argumentIndex++
                if (param.name !== '_') this.declare(local, param.name, value, true, param.type)
            }
        }
        try {
            this.executeStatements(fn.body, local)
            return null
        } catch (error) {
            if (error instanceof ReturnValue) return error.value
            throw error
        }
    }

    private declare(env: Environment, name: string, value: unknown, mutable: boolean, declaredType?: TypeNode): void {
        if (env.bindings.has(name)) throw new SyntaxError(`Duplicate declaration '${name}' in the same scope`)
        env.bindings.set(name, { value, mutable, declaredType })
    }

    private childEnvironment(parent: Environment): Environment { return { bindings: new Map(), types: new Map(), parent } }

    private adaptModule(module: Record<string, any>, env: Environment): Record<string, any> {
        const adapted = 'console' in module ? { ...module, console: this.adaptConsole(module.console) } : module
        this.installDefaultHas(adapted)
        return adapted
    }

    private adaptConsole(consoleObject: Record<string, any>): Record<string, any> {
        const convert = (args: unknown[]) => args.map(value => value !== null && (typeof value === 'object' || typeof value === 'function') ? this.toJunoString(value) : value)
        const adapted = {
            ...consoleObject,
            log: (...args: unknown[]) => consoleObject.log(...convert(args)),
            error: (...args: unknown[]) => consoleObject.error(...convert(args)),
            warn: (...args: unknown[]) => consoleObject.warn(...convert(args))
        }
        this.installDefaultHas(adapted)
        return adapted
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

    private installDefaultHas(value: object): void {
        if ('has' in value) return
        Object.defineProperty(value, 'has', {
            enumerable: false,
            value: function(this: object, key: string) { return key in this }
        })
    }

    private writeTarget(target: Expression, value: unknown, env: Environment): void {
        if (target.kind === 'Identifier') {
            const binding = this.lookup(env, target.name)
            if (!binding) throw new ReferenceError(`${target.name} is not defined`)
            if (!binding.mutable) throw new TypeError(`Cannot assign to constant '${target.name}'`)
            binding.value = value
            return
        }
        if (target.kind === 'Member') {
            const object = this.evaluate(target.object, env)
            if (object === null || object === undefined) throw new TypeError(`Cannot set property '${target.property}' of null`)
            ;(object as any)[target.property] = value
            return
        }
        if (target.kind === 'Index') {
            const object = this.evaluate(target.object, env)
            if (object === null || object === undefined) throw new TypeError('Cannot set an index on null')
            const index = this.evaluate(target.index, env)
            ;(object as any)[index as any] = value
            return
        }
        throw new TypeError('Increment and decrement require an assignable target')
    }

    private applyCompoundOperator(operator: string, left: any, right: any): any {
        const type = typeof left
        const bothNumbers = type === 'number' && typeof right === 'number'
        const bothBigInts = type === 'bigint' && typeof right === 'bigint'
        if (operator === '+=') {
            if (bothNumbers || bothBigInts || type === 'string' && typeof right === 'string') return left + right
        } else if (operator === '-=') {
            if (bothNumbers || bothBigInts) return left - (right as any)
        } else if (operator === '*=') {
            if (bothNumbers || bothBigInts) return left * (right as any)
        } else if (operator === '/=') {
            if (bothNumbers || bothBigInts) return left / (right as any)
        } else if (operator === '%=') {
            if (bothNumbers || bothBigInts) return left % (right as any)
        } else if (operator === '&=') return Boolean(left) && Boolean(right)
        else if (operator === '|=') return Boolean(left) || Boolean(right)
        throw new TypeError(`Invalid operands for '${operator}': ${type} and ${typeof right}`)
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
            case 'RegEx': return { kind: 'NamedType', name: 'RegEx' }
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
                return { kind: 'ObjectType', members: expression.properties.flatMap(property => property.accessor === 'set' ? [] : [{
                    name: property.key,
                    type: property.accessor === 'get' && property.value.kind === 'Function'
                        ? property.value.returnType ?? { kind: 'NamedType', name: 'any' }
                        : this.inferValueType(property.value, env),
                    optional: false,
                    readonly: false,
                    constant: false
                }]) }
            case 'Function':
                return {
                    kind: 'FunctionType',
                    params: expression.params.map(param => param.type ?? { kind: 'NamedType', name: 'any' }),
                    result: expression.returnType ?? { kind: 'NamedType', name: 'any' }
                }
            case 'Index': return this.typeOf(expression, env) ?? { kind: 'NamedType', name: 'any' }
            case 'Unary':
                if (expression.operator.endsWith('++') || expression.operator.endsWith('--')) return this.inferValueType(expression.operand, env)
                return expression.operator === '-' ? { kind: 'NamedType', name: 'number' } : { kind: 'NamedType', name: 'boolean' }
            case 'Call':
                if (expression.callee.kind === 'Member' && expression.callee.property === 'as' && expression.typeArguments?.length) return expression.typeArguments[0]
                if (expression.callee.kind === 'Identifier' && (this.lookup(env, expression.callee.name)?.value as any)?.__junoConstructor) {
                    return { kind: 'NamedType', name: 'any' }
                }
                if (expression.callee.kind === 'Identifier' && (this.lookup(env, expression.callee.name)?.value as any)?.__junoTypeConstructor) {
                    return expression.typeArguments?.length
                        ? { kind: 'GenericType', name: expression.callee.name, args: expression.typeArguments }
                        : { kind: 'NamedType', name: expression.callee.name }
                }
                return { kind: 'NamedType', name: 'any' }
            default: return { kind: 'NamedType', name: 'any' }
        }
    }

    private resolveAliasType(type: TypeNode, env: Environment, resolving = new Set<string>()): TypeNode {
        if (type.kind === 'NamedType') {
            if (resolving.has(type.name)) return type
            for (let current: Environment | undefined = env; current; current = current.parent) {
                const alias = current.types.get(type.name)
                if (alias && alias.generics.length === 0) return this.resolveAliasType(alias.value, env, new Set([...resolving, type.name]))
            }
            return type
        }
        if (type.kind === 'GenericType') {
            for (let current: Environment | undefined = env; current; current = current.parent) {
                const alias = current.types.get(type.name)
                if (alias) return this.resolveAliasType(this.instantiateAlias(alias, type.args), env, resolving)
            }
            const utility = this.instantiateUtilityType(type, env)
            return utility ?? type
        }
        if (type.kind === 'UnionType' || type.kind === 'IntersectionType') {
            const parts = type.types.map(part => this.resolveAliasType(part, env, resolving))
            if (type.kind === 'IntersectionType' && parts.every(part => part.kind === 'ObjectType')) return { kind: 'ObjectType', members: parts.reverse().flatMap(part => part.kind === 'ObjectType' ? part.members : []) }
            return { ...type, types: parts }
        }
        if (type.kind === 'ArrayType') return { ...type, element: this.resolveAliasType(type.element, env, resolving) }
        if (type.kind === 'ObjectType') return { ...type, members: type.members.map(member => ({ ...member, type: this.resolveAliasType(member.type, env, resolving) })) }
        if (type.kind === 'FunctionType') return { ...type, params: type.params.map(param => this.resolveAliasType(param, env, resolving)), result: this.resolveAliasType(type.result, env, resolving) }
        return type
    }

    private instantiateAlias(alias: TypeAlias, args: TypeNode[]): TypeNode {
        const substitutions = new Map(alias.generics.map((name, index) => [name, args[index] ?? { kind: 'NamedType', name } as TypeNode]))
        const replace = (node: TypeNode): TypeNode => {
            if (node.kind === 'NamedType' && substitutions.has(node.name)) return substitutions.get(node.name)!
            if (node.kind === 'GenericType') return { ...node, args: node.args.map(replace) }
            if (node.kind === 'UnionType' || node.kind === 'IntersectionType') return { ...node, types: node.types.map(replace) }
            if (node.kind === 'ArrayType') return { ...node, element: replace(node.element) }
            if (node.kind === 'FunctionType') return { ...node, params: node.params.map(replace), result: replace(node.result) }
            if (node.kind === 'ObjectType') return { ...node, members: node.members.map(member => ({ ...member, type: replace(member.type) })) }
            return node
        }
        return replace(alias.value)
    }

    private isCallableType(type: TypeNode): boolean {
        return type.kind === 'FunctionType' || (type.kind === 'NamedType' && type.name === 'any')
    }

    private instantiateUtilityType(type: Extract<TypeNode, { kind: 'GenericType' }>, env: Environment): TypeNode | null {
        if (!['Partial', 'Required', 'Readonly', 'Pick', 'Omit'].includes(type.name) || !type.args[0]) return null
        const source = this.resolveAliasType(type.args[0], env)
        if (source.kind !== 'ObjectType') return null
        let members = source.members
        if (type.name === 'Partial') members = members.map(member => ({ ...member, optional: true }))
        else if (type.name === 'Required') members = members.map(member => ({ ...member, optional: false }))
        else if (type.name === 'Readonly') members = members.map(member => ({ ...member, readonly: true }))
        else if (type.name === 'Pick' || type.name === 'Omit') {
            const keyArgument = type.args[1]
            const keys = keyArgument?.kind === 'ArrayType'
                ? this.literalKeys(keyArgument.element)
                : this.literalKeys(keyArgument)
            if (!keys) return null
            members = members.filter(member => type.name === 'Pick' ? keys.has(member.name) : !keys.has(member.name))
        }
        return { ...source, members }
    }

    private literalKeys(type?: TypeNode): Set<string> | null {
        if (!type) return null
        if (type.kind === 'LiteralType' && typeof type.value === 'string') return new Set([type.value])
        if (type.kind === 'UnionType') {
            const keys = new Set<string>()
            for (const part of type.types) {
                const values = this.literalKeys(part)
                if (!values) return null
                for (const value of values) keys.add(value)
            }
            return keys
        }
        if (type.kind === 'ArrayType') return this.literalKeys(type.element)
        return null
    }

    private matchesTypeNode(value: unknown, type: TypeNode, env: Environment, resolving = new Set<string>()): boolean {
        if (type.kind === 'NamedType') {
            if (type.name === 'any' || type.name === 'unknown') return true
            if (type.name === 'null') return value === null
            if (type.name === 'Array' || type.name === 'ReadonlyArray') return Array.isArray(value)
            for (let current: Environment | undefined = env; current; current = current.parent) {
                const alias = current.types.get(type.name)
                if (alias && alias.generics.length === 0) {
                    if (resolving.has(type.name)) return false
                    return this.matchesTypeNode(value, alias.value, env, new Set([...resolving, type.name]))
                }
            }
            switch (type.name) {
                case 'string': return typeof value === 'string'
                case 'number': return typeof value === 'number'
                case 'boolean': return typeof value === 'boolean'
                case 'BigInt': return typeof value === 'bigint'
                case 'RegEx': return value instanceof RegExp
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
            const resolved = this.resolveAliasType(type, env)
            if (resolved !== type) return this.matchesTypeNode(value, resolved, env, resolving)
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
                if (member.accessor === 'set') return typeof Object.getOwnPropertyDescriptor(object, member.name)?.set === 'function'
                if (member.accessor === 'get') return this.matchesTypeNode(memberValue, member.type, env, resolving)
                if (member.method) return typeof memberValue === 'function' || Boolean(memberValue?.__junoFunction)
                return this.matchesTypeNode(memberValue, member.type, env, resolving)
            })
        }
        return false
    }

    private applyTypeDefaults<T extends Record<string, any>>(value: T, type: TypeNode, env: Environment, resolving = new Set<string>()): T {
        if (type.kind === 'GenericType') {
            const resolved = this.resolveAliasType(type, env)
            if (resolved !== type) return this.applyTypeDefaults(value, resolved, env, resolving)
            return value
        }
        if (type.kind === 'NamedType') {
            if (resolving.has(type.name)) return value
            for (let current: Environment | undefined = env; current; current = current.parent) {
                const alias = current.types.get(type.name)
                if (alias && alias.generics.length === 0) return this.applyTypeDefaults(value, alias.value, env, new Set([...resolving, type.name]))
            }
            return value
        }
        if (type.kind === 'IntersectionType') {
            for (const part of [...type.types].reverse()) this.applyTypeDefaults(value, part, env, resolving)
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
        const resolvedType = this.resolveAliasType(type, env)
        if (resolvedType.kind === 'ObjectType') type = resolvedType
        this.installDefaultHas(runtimeValue)
        if (typeof runtimeValue.toString !== 'function' && !(runtimeValue.toString as any)?.__junoFunction) {
            runtimeValue.toString = this.defaultToString()
        }
        for (const member of type.members) {
            if (member.accessor && member.body) {
                const previous = Object.getOwnPropertyDescriptor(runtimeValue, member.name) ?? { enumerable: true, configurable: true }
                const runtimeFn: RuntimeFunction = { __junoFunction: true, params: member.params ?? [], body: member.body, closure: env, thisValue: value }
                delete previous.value
                delete previous.writable
                if (member.accessor === 'get') previous.get = () => this.callFunction(runtimeFn, [], value)
                else previous.set = (input: unknown) => { this.callFunction(runtimeFn, [input], value) }
                previous.enumerable = true
                previous.configurable = true
                Object.defineProperty(runtimeValue, member.name, previous)
                continue
            }
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
                if (alias && alias.generics.length === 0) return this.findTypeMember(alias.value, name, env, new Set([...resolving, type.name]))
            }
            if (type.name === 'string') {
                const string = { kind: 'NamedType', name: 'string' } as TypeNode
                const number = { kind: 'NamedType', name: 'number' } as TypeNode
                const boolean = { kind: 'NamedType', name: 'boolean' } as TypeNode
                const regex = { kind: 'NamedType', name: 'RegEx' } as TypeNode
                const matcher: TypeNode = { kind: 'UnionType', types: [string, regex] }
                const callable = (params: TypeNode[], result: TypeNode) => ({ type: { kind: 'FunctionType', params, result } as TypeNode, optional: false })
                if (name === 'length') return { type: number, optional: false }
                if (name === 'indices') return { type: { kind: 'NamedType', name: 'Range' }, optional: false }
                if (['find', 'findLast'].includes(name)) return callable([matcher], { kind: 'UnionType', types: [string, { kind: 'NamedType', name: 'null' }] })
                if (['findIndex', 'findLastIndex', 'indexOf', 'lastIndexOf', 'search', 'charCodeAt', 'codePointAt', 'localeCompare'].includes(name)) return callable([matcher], number)
                if (['includes', 'startsWith', 'endsWith', 'test'].includes(name)) return callable([matcher], boolean)
                if (name === 'exec') return callable([matcher], { kind: 'UnionType', types: [{ kind: 'ArrayType', element: string }, { kind: 'NamedType', name: 'null' }] })
                if (name === 'join') return callable([string], string)
                if (['split', 'match', 'matchAll', 'toArray'].includes(name)) return callable(name === 'toArray' ? [] : [matcher], { kind: 'ArrayType', element: string })
                if (name === 'iterator') return callable([], { kind: 'FunctionType', params: [], result: { kind: 'NamedType', name: 'any' } })
                if (['at', 'charAt', 'concat', 'normalize', 'padEnd', 'padStart', 'repeat', 'replace', 'replaceAll', 'slice', 'substring', 'substr', 'toLocaleLowerCase', 'toLocaleUpperCase', 'toLowerCase', 'toUpperCase', 'trim', 'trimEnd', 'trimStart', 'valueOf'].includes(name)) return callable([], string)
            }
            if (type.name === 'RegEx') {
                const string = { kind: 'NamedType', name: 'string' } as TypeNode
                const boolean = { kind: 'NamedType', name: 'boolean' } as TypeNode
                const number = { kind: 'NamedType', name: 'number' } as TypeNode
                if (['source', 'flags'].includes(name)) return { type: string, optional: false }
                if (['global', 'ignoreCase', 'multiline', 'dotAll', 'sticky', 'unicode', 'hasIndices', 'unicodeSets'].includes(name)) return { type: boolean, optional: false }
                if (name === 'lastIndex') return { type: number, optional: false }
                const input: TypeNode = { kind: 'UnionType', types: [string, { kind: 'NamedType', name: 'RegEx' }] }
                if (name === 'test') return { type: { kind: 'FunctionType', params: [input], result: boolean }, optional: false }
                if (name === 'exec') return { type: { kind: 'FunctionType', params: [input], result: { kind: 'UnionType', types: [{ kind: 'ArrayType', element: string }, { kind: 'NamedType', name: 'null' }] } }, optional: false }
                if (name === 'compile') return { type: { kind: 'FunctionType', params: [input, string], result: { kind: 'NamedType', name: 'RegEx' } }, optional: false }
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
                if (!commonMember) commonMember = member
                else commonMember.optional ||= member.optional
            }
            return commonMember
        }
        if (type.kind === 'GenericType') {
            for (let current: Environment | undefined = env; current; current = current.parent) {
                const alias = current.types.get(type.name)
                if (alias) return this.findTypeMember(this.instantiateAlias(alias, type.args), name, env, resolving)
            }
        }
        if (type.kind === 'ObjectType') {
            const member = type.members.find(item => item.name === name && item.accessor === 'get')
                ?? type.members.find(item => item.name === name)
            if (member) return { type: member.type, optional: member.optional }
            if (name === 'has') return { type: { kind: 'FunctionType', params: [{ kind: 'NamedType', name: 'string' }], result: { kind: 'NamedType', name: 'boolean' } }, optional: false }
        }
        if (name === 'has' && (type.kind === 'ArrayType' || type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray'))) {
            return { type: { kind: 'FunctionType', params: [{ kind: 'NamedType', name: 'string' }], result: { kind: 'NamedType', name: 'boolean' } }, optional: false }
        }
        if (name === 'indices' && (type.kind === 'ArrayType' || type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray'))) {
            return { type: { kind: 'NamedType', name: 'Range' }, optional: false }
        }
        if (name === 'push' && (type.kind === 'ArrayType' || type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray'))) {
            const element = type.kind === 'ArrayType' ? type.element : type.args[0] ?? { kind: 'NamedType', name: 'any' }
            return { type: { kind: 'FunctionType', params: [element], result: { kind: 'NamedType', name: 'number' } }, optional: false }
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
        if (property === 'indices' && (typeof object === 'string' || Array.isArray(object))) {
            return (resolveModule('juno') as Record<string, any>).Range(object.length)
        }
        if (Array.isArray(object) && (property === 'copy' || property === 'toArray')) return () => [...object]
        if (object && typeof object === 'object' && (object as any).__junoFunction && property === 'call') {
            return (thisArg: unknown, ...args: unknown[]) => this.callFunction(object as RuntimeFunction, args, thisArg)
        }
        if (typeof object === 'string') {
            const findMatch = (search: string | RegExp, last: boolean): { value: string; index: number } | null => {
                if (typeof search === 'string') {
                    const index = last ? object.lastIndexOf(search) : object.indexOf(search)
                    return index < 0 ? null : { value: search, index }
                }
                const flags = search.flags.includes('g') ? search.flags : `${search.flags}g`
                const regexp = new RegExp(search.source, flags)
                let found: RegExpExecArray | null = null
                for (let match = regexp.exec(object); match; match = regexp.exec(object)) {
                    found = match
                    if (!last) break
                    if (match[0] === '') regexp.lastIndex++
                }
                return found ? { value: found[0], index: found.index } : null
            }
            if (property === 'find') return (search: string | RegExp) => findMatch(search, false)?.value ?? null
            if (property === 'findLast') return (search: string | RegExp) => findMatch(search, true)?.value ?? null
            if (property === 'findIndex') return (search: string | RegExp) => findMatch(search, false)?.index ?? -1
            if (property === 'findLastIndex') return (search: string | RegExp) => findMatch(search, true)?.index ?? -1
            if (property === 'includes') return (search: string | RegExp, position = 0) => typeof search === 'string' ? object.includes(search, position) : findMatch(search, false) !== null
            if (property === 'test') return (pattern: string | RegExp) => new RegExp(pattern).test(object)
            if (property === 'exec') return (pattern: string | RegExp) => new RegExp(pattern).exec(object)
            if (property === 'join') return (separator = ',') => object.split('').join(separator)
            if (property === 'toArray') return () => object.split('')
            if (property === 'iterator') return () => {
                const iterator = object[Symbol.iterator]()
                return () => {
                    const next = iterator.next()
                    return next.done ? null : { value: next.value }
                }
            }
        }
        const declaredType = this.typeOf(owner, env)
        if (declaredType && !(declaredType.kind === 'NamedType' && declaredType.name === 'any') && !this.findTypeMember(declaredType, property, env)) {
            throw new TypeError(`Property '${property}' does not exist on declared type`)
        }
        if (!(property in Object(object))) {
            if (optional || this.findTypeMember(declaredType ?? { kind: 'NamedType', name: 'any' }, property, env)?.optional) return null
            throw new TypeError(`Property '${property}' does not exist on value`)
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
        case 'RegEx': return value instanceof RegExp
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
    const interpreter = new Interpreter()
    ;(interpreter as any).currentDirectory = resolve(path, '..')
    interpreter.run(source, path)
}
