import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { Expression, Loc, MatchPattern, Parameter, Statement, TypeMember, TypeNode, parse } from '../Lexer/parser'
import { resolveModule } from '../Modules'
import { analyze } from '../vscode-junoscript/src/language.js'

type Binding = { value: unknown; mutable: boolean; declaredType?: TypeNode }
type TypeAlias = { value: TypeNode; generics: string[]; genericDefaults?: (TypeNode | undefined)[] }
type Environment = { bindings: Map<string, Binding>; types: Map<string, TypeAlias>; parent?: Environment }
type RuntimeFunction = { __junoFunction: true; params: Parameter[]; body: Statement[]; closure: Environment; thisValue?: unknown; name?: string; file?: string; loc?: Loc }
type RuntimeConstructor = { __junoConstructor: true; typeName: string; inheritedType: TypeNode; overloads: RuntimeFunction[]; [name: string]: unknown }
class ReturnValue { constructor(readonly value: unknown) {} }
class BreakSignal {}

export class Interpreter {
    private readonly globals: Environment = { bindings: new Map(), types: new Map() }
    private currentDirectory = process.cwd()
    private currentFile?: string
    private readonly callStack: { name: string; file?: string; loc?: Loc }[] = []
    constructor() {
        ;(globalThis as any)[Symbol.for('junoscript.captureStackTrace')] = () => this.captureStackTrace()
        this.globals.bindings.set('isType', { value: (value: unknown, type: unknown) => matchesType(value, type), mutable: false })
        this.globals.bindings.set('RegEx', {
            value: (pattern: string | RegExp, flags?: string) => new RegExp(pattern, flags),
            mutable: false,
            declaredType: { kind: 'FunctionType', params: [{ kind: 'NamedType', name: 'string' }, { kind: 'NamedType', name: 'string' }], result: { kind: 'NamedType', name: 'RegEx' } }
        })
    }

    run(source: string, filePath?: string): void {
        this.currentFile = filePath
        const statements = parse(source, { filePath })
        for (const statement of statements) {
            if (statement.kind === 'TypeDeclaration') {
                this.globals.types.set(statement.name, { value: statement.value, generics: statement.generics, genericDefaults: statement.genericDefaults })
                this.registerTypeDeclarations(statement.value, this.globals)
            } else if (statement.kind === 'Export' && statement.declaration.kind === 'TypeDeclaration') {
                this.globals.types.set(statement.declaration.name, { value: statement.declaration.value, generics: statement.declaration.generics, genericDefaults: statement.declaration.genericDefaults })
                this.registerTypeDeclarations(statement.declaration.value, this.globals)
            }
        }
        this.executeStatements(statements, this.globals)
    }

    runModule(source: string, filePath: string): Record<string, unknown> {
        const previousDirectory = this.currentDirectory
        const previousFile = this.currentFile
        this.currentDirectory = resolve(filePath, '..')
        this.currentFile = filePath
        const env: Environment = { bindings: new Map(), types: new Map(), parent: this.globals }
        const exported: Record<string, unknown> = {}
        const statements = parse(source, { filePath })
        try {
            for (const statement of statements) {
                const declaration = statement.kind === 'Export' ? statement.declaration : statement
                if (declaration.kind === 'TypeDeclaration') {
                    env.types.set(declaration.name, { value: declaration.value, generics: declaration.generics, genericDefaults: declaration.genericDefaults })
                    this.registerTypeDeclarations(declaration.value, env)
                }
            }
            for (const statement of statements) {
                if (statement.kind !== 'Export') {
                    this.execute(statement, env)
                    continue
                }
                this.execute(statement.declaration, env)
                const declaration = statement.declaration
                if (declaration.kind === 'Import') {
                    if (declaration.defaultImport) {
                        const binding = this.lookup(env, declaration.defaultImport)
                        if (binding) exported[statement.default ? 'default' : declaration.defaultImport] = this.toNativeExport(binding.value)
                    }
                    for (const name of declaration.namedImports) {
                        const binding = this.lookup(env, name)
                        if (binding) exported[name] = this.toNativeExport(binding.value)
                    }
                    continue
                }
                if (declaration.kind === 'Destructure') {
                    for (const binding of declaration.bindings) {
                        const value = this.lookup(env, binding.name)
                        if (value) exported[binding.name] = this.toNativeExport(value.value)
                    }
                    continue
                }
                if (declaration.kind !== 'Variable' && declaration.kind !== 'FunctionDeclaration' && declaration.kind !== 'TypeDeclaration' && declaration.kind !== 'ConstructorDeclaration') continue
                const binding = this.lookup(env, declaration.name)
                if (binding) exported[statement.default ? 'default' : declaration.name] = this.toNativeExport(binding.value)
            }
            return exported
        } finally {
            this.currentDirectory = previousDirectory
            this.currentFile = previousFile
        }
    }

    private executeStatements(statements: Statement[], env: Environment): unknown {
        for (const statement of statements) this.execute(statement, env)
        return null
    }

    private execute(statement: Statement, env: Environment): void {
        switch (statement.kind) {
            case 'Import': {
                const module = ['juno', 'juno:node', 'juno:types', 'types'].includes(statement.module)
                    ? resolveModule(statement.module) as Record<string, unknown>
                    : this.loadLocalModule(statement.module, env)
                const adaptedModule = this.adaptModule(module, env)
                if (statement.defaultImport) this.declare(env, statement.defaultImport, adaptedModule, false)
                for (const name of statement.namedImports) {
                    const localTypeModule = ({
                        Iterable: 'iterable', Range: 'range', Array: 'array', Set: 'set', ValueSet: 'set', Map: 'map', ValueMap: 'map', Queue: 'queue', Object: 'object', Boolean: 'boolean', Number: 'number',
                        String: 'string', Tuple: 'tuple', Random: 'random', Error: 'error', Result: 'error', ok: 'error'
                    } as Record<string, string>)[name]
                    if ((statement.module === 'juno' || statement.module === 'juno:types') && localTypeModule) {
                        const constructorModule = this.loadLocalModule(`juno:types/${localTypeModule}`, env)
                        if (!(name in constructorModule)) throw new Error(`Module 'juno' has no export '${name}'`)
                        const alias = (constructorModule as any).__junoTypes?.[name] as TypeAlias | undefined
                        if (alias) {
                            ;(statement.importedTypes ??= {})[name] = alias.value
                            env.types.set(name, alias)
                        }
                        this.declare(env, name, constructorModule[name], false)
                        continue
                    }
                    if (!(name in module) && !(module as any).__junoTypes?.[name]) throw new Error(`Module '${statement.module}' has no export '${name}'`)
                    if (!(name in module) && (module as any).__junoTypes?.[name]) {
                        const alias = (module as any).__junoTypes[name] as TypeAlias
                        ;(statement.importedTypes ??= {})[name] = alias.value
                        env.types.set(name, alias)
                        this.declare(env, name, { __junoTypeConstructor: true, typeName: name, typeNode: alias.value, generics: alias.generics }, false)
                        continue
                    }
                    const importedValue = name === 'console' ? this.adaptConsole(module[name] as Record<string, any>) : this.adaptNativeValue(module[name])
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
            case 'ArrayDestructure': {
                const source = this.evaluate(statement.initializer, env) as any
                let values: unknown[]
                if (Array.isArray(source)) values = [...source]
                else if (source?.toArray?.__junoFunction) values = this.callFunction(source.toArray, [], source) as unknown[]
                else if (typeof source?.toArray === 'function') values = source.toArray()
                else throw new TypeError('Array destructuring requires an array, tuple, or value with toArray()')
                for (const binding of statement.bindings) {
                    if (!binding.name || binding.name === '_') continue
                    this.declare(env, binding.name, binding.rest ? values.slice(binding.index) : values[binding.index] ?? null, statement.mutable)
                }
                return
            }
            case 'TypeDeclaration': {
                env.types.set(statement.name, { value: statement.value, generics: statement.generics, genericDefaults: statement.genericDefaults })
                this.registerTypeDeclarations(statement.value, env)
                this.declare(env, statement.name, { __junoTypeConstructor: true, typeName: statement.name, typeNode: statement.value, generics: statement.generics }, false)
                return
            }
            case 'FunctionDeclaration': this.declare(env, statement.name, { __junoFunction: true, params: statement.params, body: statement.body, closure: env, name: statement.name, file: this.currentFile, loc: statement.loc } satisfies RuntimeFunction, false); return
            case 'ConstructorDeclaration': {
                if (!statement.overloads.length) throw new TypeError(`Constructor '${statement.name}' needs at least one anonymous function`)
                this.registerTypeDeclarations(statement.inheritedType, env)
                const overloads = statement.overloads.map(overload => ({ __junoFunction: true as const, params: overload.params, body: overload.body, closure: env, name: statement.name, file: this.currentFile, loc: statement.loc }))
                const constructor: RuntimeConstructor = { __junoConstructor: true, typeName: statement.name, inheritedType: statement.inheritedType, overloads }
                for (const method of statement.methods) constructor[method.name] = { __junoFunction: true, params: method.params, body: method.body, closure: env, name: `${statement.name}.${method.name}`, file: this.currentFile, loc: method.loc } satisfies RuntimeFunction
                this.declare(env, statement.name, constructor, false)
                return
            }
            case 'Return': throw new ReturnValue(statement.value ? this.evaluate(statement.value, env) : null)
            case 'Break': throw new BreakSignal()
            case 'ExpressionStatement': this.evaluate(statement.expression, env); return
            case 'If': this.executeStatements(this.requireCondition(this.evaluate(statement.condition, env)) ? statement.consequent : (statement.alternate ?? []), this.childEnvironment(env)); return
            case 'While': {
                while (this.requireCondition(this.evaluate(statement.condition, env))) {
                    try { this.executeStatements(statement.body, this.childEnvironment(env)) }
                    catch (error) { if (error instanceof BreakSignal) break; throw error }
                }
                return
            }
            case 'ForOf': {
                const iterable = this.evaluate(statement.iterable, env) as any
                const values = Array.isArray(iterable) || iterable?.[Symbol.iterator]
                    ? iterable
                    : iterable?.toArray?.__junoFunction
                        ? this.callFunction(iterable.toArray, [], iterable)
                        : iterable && typeof iterable.toArray === 'function'
                            ? iterable.toArray()
                            : iterable
                for (const value of values) {
                    const local = this.childEnvironment(env)
                    this.declare(local, statement.binding, value, statement.mutable)
                    try { this.executeStatements(statement.body, local) }
                    catch (error) { if (error instanceof BreakSignal) break; throw error }
                }
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
                    const alias = { value: declaration.declaration.value, generics: declaration.declaration.generics, genericDefaults: declaration.declaration.genericDefaults }
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
        else if (type.kind === 'IndexedAccessType') { this.registerTypeDeclarations(type.object, env, seen); this.registerTypeDeclarations(type.index, env, seen) }
    }

    private loadLocalModule(specifier: string, env: Environment): Record<string, unknown> {
        const junoTypeModule = specifier === 'juno:types' ? 'index' : /^juno:types\/(.+)$/.exec(specifier)?.[1]
        if (!junoTypeModule && !specifier.startsWith('.') && !isAbsolute(specifier)) throw new Error(`Unsupported module '${specifier}'`)
        const base = junoTypeModule
            ? resolve(__dirname, '../../types', junoTypeModule)
            : resolve(this.currentDirectory, specifier)
        const candidates = /\.(?:jn|[cm]?[jt]s)$/i.test(base) ? [base] : [
            `${base}.jn`, `${base}.js`, `${base}.ts`,
            resolve(base, 'index.jn'), resolve(base, 'index.js'), resolve(base, 'index.ts')
        ]
        let source: string | undefined
        let file = candidates[0]
        for (const candidate of candidates) {
            try { source = readFileSync(candidate, 'utf8'); file = candidate; break } catch { /* try next candidate */ }
        }
        if (source === undefined) throw new Error(`Cannot find module '${specifier}'`)
        if (!/\.jn$/i.test(file)) {
            const loaded = require(file) as Record<string, unknown>
            return loaded && typeof loaded === 'object' ? loaded : { default: loaded }
        }
        const previousDirectory = this.currentDirectory
        const previousFile = this.currentFile
        this.currentDirectory = resolve(base, '..')
        this.currentFile = file
        const moduleEnv: Environment = { bindings: new Map(), types: new Map(), parent: env }
        const importedModule = (specifier: string, importer: Environment): Record<string, unknown> => {
            if (specifier === 'juno:types' || specifier.startsWith('juno:types/')) return this.loadLocalModule(specifier, importer)
            const moduleBase = resolve(this.currentDirectory, specifier)
            const options = /\.(?:jn|[cm]?[jt]s)$/i.test(moduleBase) ? [moduleBase] : [
                `${moduleBase}.jn`, `${moduleBase}.js`, `${moduleBase}.ts`,
                resolve(moduleBase, 'index.jn'), resolve(moduleBase, 'index.js'), resolve(moduleBase, 'index.ts')
            ]
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
                if (declaration.kind === 'Destructure') {
                    for (const binding of declaration.bindings) {
                        const value = this.lookup(moduleEnv, binding.name)
                        if (value) exported[binding.name] = value.value
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
                const dependency = ['juno', 'juno:node', 'juno:types', 'types'].includes(statement.module)
                    ? resolveModule(statement.module) as Record<string, unknown>
                    : importedModule(statement.module, moduleEnv)
                if (statement.defaultImport) this.declare(moduleEnv, statement.defaultImport, this.adaptModule(dependency, moduleEnv), false)
                for (const name of statement.namedImports) {
                    if (dependency[name] !== undefined) this.declare(moduleEnv, name, this.adaptNativeValue(dependency[name]), false)
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
        this.currentFile = previousFile
        return exported
    }

    private evaluateSpread(expression: Expression, env: Environment): unknown[] {
        const value = this.evaluate(expression, env)
        let result: unknown
        if (Array.isArray(value)) result = [...value]
        else if (value && typeof value === 'object') {
            const indices = Object.keys(value).filter(key => /^\d+$/.test(key)).map(Number).sort((a, b) => a - b)
            if (indices.length > 0 || 'copy' in value && 'push' in value) result = indices.map(index => (value as any)[index])
            else {
                const toArray = this.readMember(value, 'toArray', false, expression, env)
                if ((toArray as any)?.__junoFunction) result = this.callFunction(toArray as RuntimeFunction, [], value)
                else if (typeof toArray === 'function') result = toArray.call(value)
                else throw new TypeError('Spread requires a callable toArray() method')
            }
        } else {
            const toArray = this.readMember(value, 'toArray', false, expression, env)
            if ((toArray as any)?.__junoFunction) result = this.callFunction(toArray as RuntimeFunction, [], value)
            else if (typeof toArray === 'function') result = toArray.call(value)
            else throw new TypeError('Spread requires a callable toArray() method')
        }
        if (!Array.isArray(result)) throw new TypeError('Spread toArray() must return an array')
        return result
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
                if ((object as any).__junoSealed?.has(String(key))) throw new TypeError(`Cannot override sealed member '${String(key)}'`)
                const right = this.evaluate(expression.value, env)
                const current = expression.operator && expression.operator !== '=' ? (object as any)[key as any] : undefined
                const value = expression.operator && expression.operator !== '=' ? this.applyCompoundOperator(expression.operator, current, right) : right
                ;(object as any)[key as any] = value
                return value
            }
            case 'Array': {
                const array: unknown[] = []
                for (const item of expression.elements) {
                    if (item.kind === 'Spread') array.push(...this.evaluateSpread(item.value, env))
                    else array.push(this.evaluate(item, env))
                }
                Object.defineProperty(array, 'toString', { enumerable: false, value: function(this: object) { return stringifyJunoObject(this) } })
                this.installDefaultHas(array)
                return array
            }
            case 'Spread':
                throw new SyntaxError('Spread is only valid in arrays and call arguments')
            case 'Object': {
                const object: Record<string, any> = {}
                const accessors = new Map<string, PropertyDescriptor>()
                const readonly = new Set<string>()
                const sealed = new Set<string>()
                Object.defineProperty(object, 'keys', {
                    enumerable: false,
                    configurable: true,
                    writable: true,
                    value: function(this: object) { return Object.keys(this) }
                })
                object.toString = this.defaultToString()
                this.installDefaultHas(object)
                for (const property of expression.properties) {
                    if (property.typeOnly) continue
                    if (property.spread) {
                        let source = this.evaluate(property.value, env)
                        if (source?.__junoTypeConstructor) source = this.applyTypeDefaults({}, { kind: 'NamedType', name: source.typeName }, env)
                        if (!source || typeof source !== 'object') throw new TypeError('Object spread requires an object')
                        for (const key of Object.keys(source)) {
                            if (sealed.has(key)) throw new TypeError(`Cannot override sealed member '${key}'`)
                            object[key] = source[key]
                        }
                        for (const key of (source as any).__junoSealed ?? []) sealed.add(key)
                        continue
                    }
                    if (sealed.has(property.key)) throw new TypeError(`Cannot override sealed member '${property.key}'`)
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
                        if (property.sealed) sealed.add(property.key)
                        continue
                    }
                    if (property.value.kind === 'Function') {
                        const fn = property.value
                        const runtimeFn = { __junoFunction: true, params: fn.params, body: fn.expressionBody ? [{ kind: 'Return', value: fn.expressionBody }] : fn.body, closure: env, thisValue: object } satisfies RuntimeFunction
                        if (property.key === '') Object.defineProperty(object, '__junoCall', { enumerable: false, configurable: true, writable: true, value: runtimeFn })
                        else object[property.key] = runtimeFn
                    } else object[property.key] = this.evaluate(property.value, env)
                    if (property.readonly) readonly.add(property.key)
                    if (property.sealed) sealed.add(property.key)
                }
                for (const [key, descriptor] of accessors) Object.defineProperty(object, key, descriptor)
                for (const key of readonly) Object.defineProperty(object, key, { ...Object.getOwnPropertyDescriptor(object, key), writable: false, enumerable: true, configurable: false })
                Object.defineProperty(object, '__junoSealed', { enumerable: false, configurable: false, value: sealed })
                this.installCallableMethods(object)
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
                return expression.operator === '-' ? -value : !this.toBoolean(value)
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
                        return this.toBoolean(left) || this.toBoolean(right)
            
                    case '&':
                        return this.toBoolean(left) && this.toBoolean(right)
            
                    default:
                        throw new Error(`Unsupported operator '${expression.operator}'`)
                }
            }
            case 'Conditional':
                return this.requireCondition(this.evaluate(expression.condition, env))
                    ? this.evaluate(expression.consequent, env)
                    : this.evaluate(expression.alternate, env)
            case 'Match': {
                const value = this.evaluate(expression.value, env)
                for (const item of expression.cases) {
                    const bindings = new Map<string, unknown>()
                    if (item.pattern && !this.matchesPattern(value, item.pattern, env, bindings)) continue
                    const local = this.childEnvironment(env)
                    if (item.pattern && expression.value.kind === 'Identifier') {
                        const narrowedType = this.patternTypeNode(item.pattern, env)
                        if (narrowedType) this.declare(local, expression.value.name, value, false, narrowedType)
                    }
                    for (const [name, binding] of bindings) this.declare(local, name, binding, false)
                    if (item.guard && !this.requireCondition(this.evaluate(item.guard, local))) continue
                    try {
                        this.executeStatements(item.body, local)
                        return null
                    } catch (error) {
                        if (error instanceof ReturnValue) return error.value
                        throw error
                    }
                }
                return null
            }
            case 'Try': {
                let result: unknown
                try {
                    let attempted: any
                    if (expression.body) {
                        try {
                            this.executeStatements(expression.body, this.childEnvironment(env))
                            attempted = null
                        } catch (error) {
                            if (error instanceof ReturnValue) attempted = error.value
                            else throw error
                        }
                    } else attempted = this.evaluate(expression.value!, env) as any
                    if (!attempted || typeof attempted !== 'object' || typeof attempted.ok !== 'boolean') {
                        throw new TypeError('try expects a Result value')
                    }
                    if (attempted.ok) result = attempted.value
                    else {
                        let handled = false
                        for (const clause of expression.catches) {
                            const taggedMatch = clause.type?.kind === 'NamedType'
                                && attempted.error !== null && typeof attempted.error === 'object'
                                && attempted.error.type === clause.type.name
                            if (clause.type && !taggedMatch && !this.matchesTypeNode(attempted.error, clause.type, env)) continue
                            const local = this.childEnvironment(env)
                            if (clause.binding) this.declare(local, clause.binding, attempted.error, false)
                            try {
                                this.executeStatements(clause.body, local)
                                result = null
                            } catch (error) {
                                if (error instanceof ReturnValue) result = error.value
                                else throw error
                            }
                            handled = true
                            break
                        }
                        if (!handled) throw attempted.error
                    }
                } finally {
                    if (expression.finallyBody) {
                        try { this.executeStatements(expression.finallyBody, this.childEnvironment(env)) }
                        catch (error) { if (!(error instanceof ReturnValue)) throw error }
                    }
                }
                return result
            }
            case 'Is':
                return this.matchesTypeNode(this.evaluate(expression.value, env), expression.type, env)
            case 'Member': {
                const object = this.evaluate(expression.object, env)
                const member = this.readMember(object, expression.property, expression.optional, expression.object, env)
                return typeof member === 'function' ? member.bind(object) : member
            }
            case 'Index': {
                const object = this.evaluate(expression.object, env)
                const index = this.evaluate(expression.index, env)
                if (object == null) throw new TypeError('Cannot index null')
                if (Array.isArray(object)) {
                    if (typeof index === 'number' && (!Number.isInteger(index) || index < 0 || index >= object.length)) {
                        throw new TypeError(`Array index must be an integer in [0, ${object.length}); received ${String(index)}`)
                    }
                    if (typeof index !== 'number' && typeof index !== 'string') {
                        throw new TypeError(`Array index must be a number or an array member name; received ${typeof index}`)
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
                if (expression.callee.kind === 'Identifier' && expression.callee.name === 'Items' && expression.typeArguments?.length) {
                    const values: (string | number)[] = []
                    const collect = (type: TypeNode): void => {
                        if (type.kind === 'UnionType') return type.types.forEach(collect)
                        if (type.kind === 'LiteralType' && (typeof type.value === 'string' || typeof type.value === 'number')) { values.push(type.value); return }
                        throw new TypeError(`Items<> only accepts string or number literal types; received '${typeName(type)}'`)
                    }
                    expression.typeArguments.forEach(type => collect(this.resolveAliasType(type, env)))
                    return values
                }
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
                const args: unknown[] = []
                for (const argument of expression.args) {
                    if (argument.kind === 'Spread') args.push(...this.evaluateSpread(argument.value, env))
                    else args.push(this.evaluate(argument, env))
                }
                const passesRuntimeType = expression.callee.kind === 'Identifier' && expression.callee.name === 'isType'
                    || expression.callee.kind === 'Member' && (expression.callee.property === 'isType' || expression.callee.property === 'as')
                if (passesRuntimeType && expression.typeArguments?.length) args.push(expression.typeArguments[0].kind === 'NamedType' ? expression.typeArguments[0].name : 'object')
                if (typeof callee === 'function') {
                    const nativeArgs = args.map(argument => this.toNativeValue(argument))
                    return this.adaptNativeValue(callee.apply(thisValue, nativeArgs)) ?? null
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
                    const result = this.applyTypeDefaults(value, constructor.inheritedType, overload.closure)
                    return constructor.typeName === 'Tuple' ? Object.freeze(result) : result
                }
                if (callee?.__junoTypeConstructor) {
                    const input = args[0] ?? {}
                    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError(`Constructor '${callee.typeName}' expects an object`)
                    const targetType: TypeNode = expression.typeArguments?.length
                        ? { kind: 'GenericType', name: callee.typeName, args: expression.typeArguments }
                        : { kind: 'NamedType', name: callee.typeName }
                    return this.applyTypeDefaults(input, targetType, env)
                }
                if (callee?.__junoCall?.__junoFunction) return this.callFunction(callee.__junoCall, args, callee)
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
        this.callStack.push({ name: fn.name ?? '<anonymous>', file: fn.file, loc: fn.loc })
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
            if (error instanceof BreakSignal) throw new SyntaxError("'break' cannot cross a function boundary")
            throw error
        } finally {
            this.callStack.pop()
        }
    }

    private patternBindings(pattern: MatchPattern): Set<string> {
        if (pattern.kind === 'PatternObject') return new Set(pattern.properties.map(property => property.name))
        if (pattern.kind === 'PatternUnion') return new Set(pattern.patterns.flatMap(part => [...this.patternBindings(part)]))
        return new Set()
    }

    private patternTypeNode(pattern: MatchPattern, env: Environment): TypeNode | undefined {
        if (pattern.kind === 'PatternLiteral') {
            if (typeof pattern.value === 'bigint') return { kind: 'NamedType', name: 'bigint' }
            return pattern.value === null ? { kind: 'NamedType', name: 'null' } : { kind: 'LiteralType', value: pattern.value }
        }
        if (pattern.kind === 'PatternUnion') {
            const types = pattern.patterns.flatMap(part => this.patternTypeNode(part, env) ?? [])
            return types.length ? { kind: 'UnionType', types } : undefined
        }
        if (pattern.kind === 'PatternObject') return { kind: 'ObjectType', members: pattern.properties.map(property => ({
            name: property.name, type: property.pattern ? this.patternTypeNode(property.pattern, env) ?? { kind: 'NamedType', name: 'any' } : { kind: 'NamedType', name: 'any' },
            optional: false, readonly: true, constant: false
        })) }
        if (pattern.name === '_') return undefined
        const binding = this.lookup(env, pattern.name)?.value as any
        const isType = binding?.__junoConstructor || binding?.__junoTypeConstructor || env.types.has(pattern.name)
            || ['string', 'number', 'boolean', 'bigint', 'symbol', 'object', 'unknown', 'any', 'null'].includes(pattern.name)
        if (!isType) return undefined
        const base: TypeNode = { kind: 'NamedType', name: pattern.name }
        return pattern.nullable ? { kind: 'UnionType', types: [base, { kind: 'NamedType', name: 'null' }] } : base
    }

    private matchesPattern(value: unknown, pattern: MatchPattern, env: Environment, bindings: Map<string, unknown>): boolean {
        if (pattern.kind === 'PatternLiteral') return deepEqual(value, pattern.value)
        if (pattern.kind === 'PatternUnion') {
            const names = this.patternBindings(pattern)
            for (const part of pattern.patterns) {
                const candidate = new Map<string, unknown>([...names].map(name => [name, null]))
                if (this.matchesPattern(value, part, env, candidate)) {
                    for (const [name, binding] of candidate) bindings.set(name, binding)
                    return true
                }
            }
            return false
        }
        if (pattern.kind === 'PatternObject') {
            if (value === null || typeof value !== 'object') return false
            const candidate = new Map(bindings)
            for (const property of pattern.properties) {
                const member = property.name in value ? (value as Record<string, unknown>)[property.name] : null
                if (property.pattern && !this.matchesPattern(member, property.pattern, env, candidate)) return false
                candidate.set(property.name, member)
            }
            for (const [name, binding] of candidate) bindings.set(name, binding)
            return true
        }
        if (pattern.name === '_') return true
        const binding = this.lookup(env, pattern.name)?.value as any
        let matches: boolean
        if (binding?.__junoConstructor) matches = this.matchesTypeNode(value, binding.inheritedType, env)
        else if (binding?.__junoTypeConstructor || env.types.has(pattern.name) || ['string', 'number', 'boolean', 'bigint', 'symbol', 'object', 'unknown', 'any', 'null'].includes(pattern.name)) {
            matches = this.matchesTypeNode(value, { kind: 'NamedType', name: pattern.name }, env)
        } else if (binding !== undefined) matches = deepEqual(value, binding)
        else matches = false
        return matches || Boolean(pattern.nullable && value === null)
    }

    private captureStackTrace(): string[] {
        return [...this.callStack].reverse().map(frame => {
            const position = frame.file
                ? `${frame.file}${frame.loc ? `:${frame.loc.line}:${frame.loc.column}` : ''}`
                : frame.loc ? `${frame.loc.line}:${frame.loc.column}` : '<unknown>'
            return `at ${frame.name} (${position})`
        })
    }

    private toNativeValue(value: unknown): unknown {
        if ((value as any)?.__junoFunction) {
            return (...args: unknown[]) => this.toNativeValue(this.callFunction(value as RuntimeFunction, args))
        }
        if (value === null || typeof value !== 'object') return value

        const target = value as Record<PropertyKey, any>
        const hasJunoMethod = Reflect.ownKeys(target).some(property => target[property]?.__junoFunction)
        const hasToArray = typeof target.toArray === 'function' || target.toArray?.__junoFunction
        if (!hasJunoMethod && !hasToArray) return value

        const thisInterpreter = this
        const wrappers = new Map<PropertyKey, { method: RuntimeFunction; callable: (...args: unknown[]) => unknown }>()
        return new Proxy(target, {
            get: (object, property, receiver) => {
                if (property === Symbol.iterator && hasToArray) return function() {
                    const method = object.toArray
                    const items = method?.__junoFunction
                        ? thisInterpreter.callFunction(method as RuntimeFunction, [], object)
                        : method.call(object)
                    if (!items || typeof items[Symbol.iterator] !== 'function') throw new TypeError('toArray() must return an iterable value')
                    return items[Symbol.iterator]()
                }
                const member = Reflect.get(object, property, receiver)
                if (!member?.__junoFunction) return member

                const cached = wrappers.get(property)
                if (cached && cached.method === member) return cached.callable

                const callable = (...args: unknown[]) => this.callFunction(member as RuntimeFunction, args, object)
                wrappers.set(property, { method: member, callable })
                return callable
            }
        })
    }

    private callRuntimeConstructor(constructor: RuntimeConstructor, args: unknown[]): unknown {
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
        const result = this.applyTypeDefaults(value, constructor.inheritedType, overload.closure)
        return this.toNativeValue(constructor.typeName === 'Tuple' ? Object.freeze(result) : result)
    }

    private toNativeExport(value: any): any {
        if (value?.__junoConstructor) {
            const constructor = value as RuntimeConstructor
            const callable = (...args: unknown[]) => this.callRuntimeConstructor(constructor, args.map(argument => this.adaptNativeValue(argument)))
            for (const key of Object.keys(constructor)) {
                if (key.startsWith('__') || key === 'overloads' || key === 'inheritedType' || key === 'typeName') continue
                const member = constructor[key] as any
                ;(callable as any)[key] = member?.__junoFunction
                    ? (...args: unknown[]) => this.toNativeValue(this.callFunction(member as RuntimeFunction, args.map(argument => this.adaptNativeValue(argument))))
                    : this.toNativeValue(member)
            }
            Object.defineProperty(callable, '__junoConstructor', { value: true })
            return callable
        }
        if (value?.__junoTypeConstructor) {
            return (input: Record<string, unknown> = {}) => this.toNativeValue(this.applyTypeDefaults(input, value.typeNode, this.globals))
        }
        return this.toNativeValue(value)
    }

    private adaptNativeValue(value: any): any {
        if (typeof value === 'function') {
            const source = Function.prototype.toString.call(value)
            if (/^class\s/.test(source)) {
                const NativeClass = value
                return new Proxy(NativeClass, {
                    apply: (_target, _thisArg, args) => this.adaptNativeValue(Reflect.construct(NativeClass, args.map(argument => this.toNativeValue(argument))))
                })
            }
            return value
        }
        if (value === null || value === undefined || typeof value !== 'object') return value
        if (typeof value.iterator === 'function' || typeof value[Symbol.iterator] !== 'function') return value
        const iterator = function(this: any): () => ({ value: unknown } | null) {
            const native = value[Symbol.iterator].call(value) as Iterator<unknown>
            return () => {
                const next = native.next()
                return next.done ? null : { value: next.value }
            }
        }
        if (Object.isExtensible(value)) {
            Object.defineProperty(value, 'iterator', { enumerable: false, configurable: true, value: iterator })
            return value
        }
        return new Proxy(value, {
            has: (target, property) => property === 'iterator' || Reflect.has(target, property),
            get: (target, property, receiver) => property === 'iterator' ? iterator : Reflect.get(target, property, receiver)
        })
    }

    private declare(env: Environment, name: string, value: unknown, mutable: boolean, declaredType?: TypeNode): void {
        if (env.bindings.has(name)) throw new SyntaxError(`Duplicate declaration '${name}' in the same scope`)
        env.bindings.set(name, { value, mutable, declaredType })
    }

    private childEnvironment(parent: Environment): Environment { return { bindings: new Map(), types: new Map(), parent } }

    private adaptModule(module: Record<string, any>, env: Environment): Record<string, any> {
        const adapted: Record<PropertyKey, any> = 'console' in module ? { ...module, console: this.adaptConsole(module.console) } : { ...module }
        for (const key of Reflect.ownKeys(adapted)) if (key !== 'console') adapted[key] = this.adaptNativeValue(adapted[key])
        this.installDefaultHas(adapted)
        return adapted as Record<string, any>
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
        const interpreter = this
        if (!('has' in value)) Object.defineProperty(value, 'has', {
            enumerable: false,
            configurable: true,
            writable: true,
            value: function(this: object, key: string) { return key in this }
        })
        const installResult = (result: any): any => {
            if (result && typeof result === 'object') {
                if (!Array.isArray(result) && !Object.prototype.hasOwnProperty.call(result, 'toString')) result.toString = this.defaultToString()
                this.installDefaultHas(result)
            }
            return result
        }
        if (!('asReadonly' in value)) Object.defineProperty(value, 'asReadonly', {
            enumerable: false,
            configurable: true,
            writable: true,
            value: function(this: any) {
                const copy = Array.isArray(this) ? [...this] : { ...this }
                interpreter.installDefaultHas(copy)
                return Object.freeze(copy)
            }
        })
        if (!('asMutable' in value)) Object.defineProperty(value, 'asMutable', {
            enumerable: false,
            configurable: true,
            writable: true,
            value: function(this: any) {
                const copy = Array.isArray(this) ? [...this] : { ...this }
                interpreter.installDefaultHas(copy)
                return copy
            }
        })
        if (!('deepClone' in value)) Object.defineProperty(value, 'deepClone', {
            enumerable: false,
            configurable: true,
            writable: true,
            value: function(this: object) {
                const clone = deepCloneValue(this)
                interpreter.installDefaultHas(clone)
                return clone
            }
        })
        if (!('deepFreeze' in value)) Object.defineProperty(value, 'deepFreeze', {
            enumerable: false,
            configurable: true,
            writable: true,
            value: function(this: object) { return deepFreezeValue(this) }
        })
        if (!('toDeepFreezed' in value)) Object.defineProperty(value, 'toDeepFreezed', {
            enumerable: false,
            configurable: true,
            writable: true,
            value: function(this: object) {
                const clone = deepCloneValue(this)
                interpreter.installDefaultHas(clone)
                return deepFreezeValue(clone)
            }
        })
        if (!('pick' in value)) Object.defineProperty(value, 'pick', {
            enumerable: false,
            configurable: true,
            writable: true,
            value: function(this: any, ...keys: (string | number)[]) {
                if (Array.isArray(this) && keys.every(key => typeof key === 'number')) return installResult(keys.map(key => this[key]))
                const result: Record<string, unknown> = {}
                for (const key of keys) if (key in this) result[String(key)] = this[key]
                return installResult(result)
            }
        })
        if (!('omit' in value)) Object.defineProperty(value, 'omit', {
            enumerable: false,
            configurable: true,
            writable: true,
            value: function(this: any, ...keys: (string | number)[]) {
                if (Array.isArray(this) && keys.every(key => typeof key === 'number')) {
                    const removed = new Set(keys)
                    return installResult(this.filter((_item: unknown, index: number) => !removed.has(index)))
                }
                const removed = new Set(keys.map(String))
                const result: Record<string, unknown> = {}
                for (const key of Object.keys(this)) if (!removed.has(key)) result[key] = this[key]
                return installResult(result)
            }
        })
    }

    private installCallableMethods(value: Record<string, any>): void {
        if (!value.__junoCall?.__junoFunction) return
        const define = (name: string, method: (...args: any[]) => unknown): void => {
            if (name in value) return
            Object.defineProperty(value, name, { enumerable: false, configurable: true, writable: true, value: method })
        }
        define('call', (thisArg: unknown, ...args: unknown[]) => this.callFunction(value.__junoCall, args, thisArg))
        define('apply', (thisArg: unknown, args: unknown[]) => {
            if (!Array.isArray(args)) throw new TypeError('Callable object apply() expects an array as its second argument')
            return this.callFunction(value.__junoCall, args, thisArg)
        })
        define('bind', (thisArg: unknown, ...boundArgs: unknown[]) => (...args: unknown[]) => this.callFunction(value.__junoCall, [...boundArgs, ...args], thisArg))
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
            if ((object as any).__junoSealed?.has(target.property!)) throw new TypeError(`Cannot override sealed member '${target.property}'`)
            ;(object as any)[target.property] = value
            return
        }
        if (target.kind === 'Index') {
            const object = this.evaluate(target.object, env)
            if (object === null || object === undefined) throw new TypeError('Cannot set an index on null')
            const index = this.evaluate(target.index, env)
            if ((object as any).__junoSealed?.has(String(index))) throw new TypeError(`Cannot override sealed member '${String(index)}'`)
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
        } else if (operator === '&=') return this.toBoolean(left) && this.toBoolean(right)
        else if (operator === '|=') return this.toBoolean(left) || this.toBoolean(right)
        throw new TypeError(`Invalid operands for '${operator}': ${type} and ${typeof right}`)
    }

    private requireCondition(value: unknown): boolean {
        if (value == null) throw new TypeError('Cannot use null as a condition; use ! or ?? to handle null')
        return this.toBoolean(value)
    }

    private toBoolean(value: unknown): boolean {
        if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
            const method = (value as any).toBoolean
            if (method === undefined) return true
            const result = method?.__junoFunction
                ? this.callFunction(method as RuntimeFunction, [], value)
                : typeof method === 'function'
                    ? method.call(value)
                    : (() => { throw new TypeError("Property 'toBoolean' must be a function") })()
            if (typeof result !== 'boolean') throw new TypeError("Method 'toBoolean' must return boolean")
            return result
        }
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
            const lookupType = parentType && expression.optional ? this.nonNullableType(parentType) : parentType
            return lookupType ? this.findTypeMember(lookupType, expression.property, env)?.type ?? null : null
        }
        if (expression.kind === 'Index') {
            const parentType = this.typeOf(expression.object, env) ?? this.inferValueType(expression.object, env)
            const keyType: TypeNode = expression.index.kind === 'Literal' && (typeof expression.index.value === 'string' || typeof expression.index.value === 'number')
                ? { kind: 'LiteralType', value: expression.index.value }
                : this.typeOf(expression.index, env) ?? this.inferValueType(expression.index, env)
            return this.indexedType(parentType, keyType, env)
        }
        return null
    }

    private indexedType(objectType: TypeNode, keyType: TypeNode, env: Environment): TypeNode | null {
        const object = this.resolveAliasType(objectType, env)
        const key = this.resolveAliasType(keyType, env)
        const keys = key.kind === 'UnionType' ? key.types : [key]
        const results: TypeNode[] = []
        for (const part of keys) {
            if ((object.kind === 'ArrayType' || object.kind === 'GenericType' && (object.name === 'Array' || object.name === 'ReadonlyArray')) && (part.kind === 'NamedType' && part.name === 'number' || part.kind === 'LiteralType' && typeof part.value === 'number')) {
                results.push(object.kind === 'ArrayType' ? object.element : object.args[0] ?? { kind: 'NamedType', name: 'any' })
                continue
            }
            if (part.kind !== 'LiteralType' || typeof part.value !== 'string' && typeof part.value !== 'number') return null
            const member = this.findTypeMember(object, String(part.value), env)
            if (member) results.push(member.type)
            else if (object.kind === 'ObjectType') {
                const signature = object.members.find(item => item.indexType && this.matchesTypeNode(part.value, item.indexType, env))
                if (!signature) return null
                results.push(signature.type)
            } else return null
        }
        return results.length === 1 ? results[0] : results.length ? { kind: 'UnionType', types: results } : null
    }

    private nonNullableType(type: TypeNode): TypeNode {
        if (type.kind !== 'UnionType') return type
        const types = type.types.filter(part => !(
            part.kind === 'NamedType' && part.name === 'null'
            || part.kind === 'LiteralType' && part.value === null
        ))
        return types.length === 1 ? types[0] : { ...type, types }
    }

    private inferValueType(expression: Expression, env: Environment): TypeNode {
        switch (expression.kind) {
            case 'RegEx': return { kind: 'NamedType', name: 'RegEx' }
            case 'Literal':
                return { kind: 'NamedType', name: expression.value === null ? 'null' : typeof expression.value === 'bigint' ? 'BigInt' : typeof expression.value }
            case 'Template': return { kind: 'NamedType', name: 'string' }
            case 'Identifier': return this.lookup(env, expression.name)?.declaredType ?? { kind: 'NamedType', name: 'any' }
            case 'Array': {
                const elements = expression.elements.map(item => {
                    if (item.kind !== 'Spread') return this.inferValueType(item, env)
                    const spread = this.inferValueType(item.value, env)
                    return spread.kind === 'ArrayType' ? spread.element : { kind: 'NamedType', name: 'any' } as TypeNode
                })
                const flattened = elements.flatMap(type => type.kind === 'UnionType' ? type.types : [type])
                return { kind: 'ArrayType', element: flattened.length === 0 ? { kind: 'NamedType', name: 'any' } : flattened.length === 1 ? flattened[0] : { kind: 'UnionType', types: flattened } }
            }
            case 'Spread': {
                const spread = this.inferValueType(expression.value, env)
                return spread.kind === 'ArrayType' ? spread.element : { kind: 'NamedType', name: 'any' }
            }
            case 'Object':
                return { kind: 'ObjectType', members: expression.properties.flatMap(property => property.accessor === 'set' ? [] : [{
                    name: property.key,
                    type: property.accessor === 'get' && property.value.kind === 'Function'
                        ? property.value.returnType ?? { kind: 'NamedType', name: 'any' }
                        : this.inferValueType(property.value, env),
                    optional: false,
                    readonly: false,
                    constant: false,
                    method: property.value.kind === 'Function' && !property.accessor,
                    params: property.value.kind === 'Function' ? property.value.params : undefined
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

    private inferRuntimeValueType(value: unknown): TypeNode {
        if (value === null || value === undefined) return { kind: 'NamedType', name: 'null' }
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return { kind: 'LiteralType', value }
        if (typeof value === 'bigint') return { kind: 'NamedType', name: 'BigInt' }
        if (typeof value === 'function' || (value as any)?.__junoFunction) return { kind: 'NamedType', name: 'Function' }
        if (Array.isArray(value)) {
            const elements = value.map(item => this.inferRuntimeValueType(item))
            const unique = elements.filter((item, index) => elements.findIndex(other => typeName(other) === typeName(item)) === index)
            return { kind: 'ArrayType', element: unique.length === 1 ? unique[0] : unique.length ? { kind: 'UnionType', types: unique } : { kind: 'NamedType', name: 'any' } }
        }
        const members: TypeMember[] = Object.entries(value as Record<string, unknown>)
            .filter(([name, member]) => !name.startsWith('__') && typeof member !== 'function' && !(member as any)?.__junoFunction)
            .map(([name, member]) => ({ name, type: this.inferRuntimeValueType(member), optional: false, readonly: false, constant: false }))
        return { kind: 'ObjectType', members }
    }

    private resolveAliasType(type: TypeNode, env: Environment, resolving = new Set<string>()): TypeNode {
        if (type.kind === 'NamedType') {
            if (resolving.has(type.name)) return type
            for (let current: Environment | undefined = env; current; current = current.parent) {
                const alias = current.types.get(type.name)
                if (alias && alias.generics.every((_name, index) => alias.genericDefaults?.[index])) return this.resolveAliasType(this.instantiateAlias(alias, []), env, new Set([...resolving, type.name]))
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
        if (type.kind === 'TypeOfType') {
            const dependsOnUnresolvedType = type.expression.kind === 'Index'
                && type.expression.index.kind === 'Identifier'
                && resolving.has(type.expression.index.name)
            if (dependsOnUnresolvedType) return type
            return this.resolveAliasType(this.inferRuntimeValueType(this.evaluate(type.expression, env)), env, resolving)
        }
        if (type.kind === 'ConditionalType') {
            const check = this.resolveAliasType(type.check, env, resolving)
            const target = this.resolveAliasType(type.target, env, resolving)
            const assignable = (source: TypeNode, destination: TypeNode): boolean => {
                if (source.kind === 'UnionType') return source.types.every(part => assignable(part, destination))
                if (destination.kind === 'UnionType') return destination.types.some(part => assignable(source, part))
                if (destination.kind === 'NamedType' && (destination.name === 'any' || destination.name === 'unknown')) return true
                if (source.kind === 'LiteralType' && destination.kind === 'NamedType') return typeof source.value === destination.name
                if (source.kind === 'LiteralType' && destination.kind === 'LiteralType') return source.value === destination.value
                if (source.kind === 'NamedType' && destination.kind === 'NamedType') return source.name === destination.name
                if (source.kind === 'ArrayType' && destination.kind === 'ArrayType') return assignable(source.element, destination.element)
                return false
            }
            return this.resolveAliasType(assignable(check, target) ? type.consequent : type.alternate, env, resolving)
        }
        if (type.kind === 'IndexedAccessType') return this.indexedType(type.object, type.index, env) ?? { kind: 'NamedType', name: 'any' }
        if (type.kind === 'ObjectType') return { ...type, members: type.members.map(member => ({
            ...member,
            type: this.resolveAliasType(member.type, env, new Set([...resolving, ...(member.generics ?? []), ...(member.indexType ? [member.name] : [])])),
            indexType: member.indexType ? this.resolveAliasType(member.indexType, env, resolving) : undefined,
            params: member.params?.map(param => ({ ...param, type: param.type ? this.resolveAliasType(param.type, env, new Set([...resolving, ...(member.generics ?? [])])) : undefined }))
        })) }
        if (type.kind === 'FunctionType') return { ...type, params: type.params.map(param => this.resolveAliasType(param, env, resolving)), result: this.resolveAliasType(type.result, env, resolving) }
        return type
    }

    private instantiateAlias(alias: TypeAlias, args: TypeNode[]): TypeNode {
        const substitutions = new Map(alias.generics.map((name, index) => [name, args[index] ?? alias.genericDefaults?.[index] ?? { kind: 'NamedType', name } as TypeNode]))
        const replace = (node: TypeNode): TypeNode => {
            if (node.kind === 'NamedType' && substitutions.has(node.name)) return substitutions.get(node.name)!
            if (node.kind === 'GenericType') return { ...node, args: node.args.map(replace) }
            if (node.kind === 'UnionType' || node.kind === 'IntersectionType') return { ...node, types: node.types.map(replace) }
            if (node.kind === 'ArrayType') return { ...node, element: replace(node.element) }
            if (node.kind === 'IndexedAccessType') return { ...node, object: replace(node.object), index: replace(node.index) }
            if (node.kind === 'ConditionalType') return { ...node, check: replace(node.check), target: replace(node.target), consequent: replace(node.consequent), alternate: replace(node.alternate) }
            if (node.kind === 'FunctionType') return { ...node, params: node.params.map(replace), result: replace(node.result) }
            if (node.kind === 'ObjectType') return { ...node, members: node.members.map(member => ({ ...member, type: replace(member.type), indexType: member.indexType ? replace(member.indexType) : undefined })) }
            return node
        }
        return replace(alias.value)
    }

    private isCallableType(type: TypeNode): boolean {
        return type.kind === 'FunctionType' || (type.kind === 'NamedType' && type.name === 'any')
            || type.kind === 'ObjectType' && type.members.some(member => member.name === '' && member.method)
    }

    private instantiateUtilityType(type: Extract<TypeNode, { kind: 'GenericType' }>, env: Environment): TypeNode | null {
        if (!['Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'KeyOf', 'Exclude'].includes(type.name) || !type.args[0]) return null
        if (type.name === 'Exclude') {
            const source = this.resolveAliasType(type.args[0], env)
            const excluded = type.args[1] ? this.resolveAliasType(type.args[1], env) : { kind: 'NamedType', name: 'never' } as TypeNode
            const parts = source.kind === 'UnionType' ? source.types : [source]
            const remaining = parts.filter(part => typeName(part) !== typeName(excluded) && !(excluded.kind === 'UnionType' && excluded.types.some(item => typeName(item) === typeName(part))))
            return remaining.length === 1 ? remaining[0] : remaining.length ? { kind: 'UnionType', types: remaining } : { kind: 'NamedType', name: 'never' }
        }
        const source = this.resolveAliasType(type.args[0], env)
        if (type.name === 'KeyOf') {
            if (source.kind === 'ArrayType' || source.kind === 'GenericType' && (source.name === 'Array' || source.name === 'ReadonlyArray')) {
                const names = ['length', 'indices', 'has', 'pick', 'omit', 'deepClone', 'deepFreeze', 'toDeepFreezed', 'at', 'concat', 'copy', 'copyWithin', 'entries', 'enumerate', 'every', 'fill', 'filter', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flat', 'flatMap', 'forEach', 'includes', 'indexOf', 'iterator', 'join', 'lastIndexOf', 'map', 'pop', 'push', 'reduce', 'reduceRight', 'reverse', 'shift', 'slice', 'some', 'sort', 'splice', 'toArray', 'toReversed', 'toSorted', 'toSpliced', 'toString', 'unshift', 'with']
                return { kind: 'UnionType', types: [{ kind: 'NamedType', name: 'number' }, ...names.map(name => ({ kind: 'LiteralType', value: name } as TypeNode))] }
            }
            if (source.kind !== 'ObjectType') return null
            const keys: TypeNode[] = source.members.flatMap(member => {
                if (member.indexType) return [member.indexType]
                const numeric = Number(member.name)
                return [{ kind: 'LiteralType', value: member.name !== '' && Number.isFinite(numeric) && String(numeric) === member.name ? numeric : member.name }]
            })
            return keys.length === 1 ? keys[0] : { kind: 'UnionType', types: keys }
        }
        if (source.kind === 'UnionType' || source.kind === 'IntersectionType') {
            return { ...source, types: source.types.map(part => this.instantiateUtilityType({ ...type, args: [part, ...type.args.slice(1)] }, env) ?? part) }
        }
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
        if (type.kind === 'TypeOfType' || type.kind === 'IndexedAccessType' || type.kind === 'ConditionalType') {
            const resolved = this.resolveAliasType(type, env, resolving)
            return this.matchesTypeNode(value, resolved, env, resolving)
        }
        if (type.kind === 'NamedType') {
            if (type.name === 'any' || type.name === 'unknown') return true
            if (type.name === 'null') return value === null
            if (type.name === 'Array' || type.name === 'ReadonlyArray') return Array.isArray(value)
            for (let current: Environment | undefined = env; current; current = current.parent) {
                const alias = current.types.get(type.name)
                if (alias && alias.generics.every((_name, index) => alias.genericDefaults?.[index])) {
                    if (resolving.has(type.name)) return false
                    return this.matchesTypeNode(value, this.instantiateAlias(alias, []), env, new Set([...resolving, type.name]))
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
        if (type.kind === 'FunctionType') return typeof value === 'function' || Boolean((value as any)?.__junoFunction || (value as any)?.__junoCall?.__junoFunction)
        if (type.kind === 'ObjectType') {
            if (value === null || typeof value !== 'object') return false
            const object = value as Record<string, any>
            for (const signature of type.members.filter(member => member.indexType)) {
                for (const [key, memberValue] of Object.entries(object)) {
                    if (key.startsWith('__') || typeof memberValue === 'function' || memberValue?.__junoFunction) continue
                    const numeric = Number(key)
                    const runtimeKey = Number.isFinite(numeric) && String(numeric) === key ? numeric : key
                    if (this.matchesTypeNode(runtimeKey, signature.indexType!, env, resolving) && !this.matchesTypeNode(memberValue, signature.type, env, resolving)) return false
                }
            }
            return type.members.filter(member => !member.indexType).every(member => {
                if (member.name === '' && member.method) return Boolean(object.__junoCall?.__junoFunction)
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
                if (alias && alias.generics.every((_name, index) => alias.genericDefaults?.[index])) return this.applyTypeDefaults(value, this.instantiateAlias(alias, []), env, new Set([...resolving, type.name]))
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
        const sealedMembers: Set<string> = runtimeValue.__junoSealed ?? new Set<string>()
        if (!runtimeValue.__junoSealed) Object.defineProperty(runtimeValue, '__junoSealed', { enumerable: false, configurable: false, value: sealedMembers })
        if (typeof runtimeValue.toString !== 'function' && !(runtimeValue.toString as any)?.__junoFunction) {
            runtimeValue.toString = this.defaultToString()
        }
        for (const member of type.members) {
            if (member.indexType) continue
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
                if (member.sealed) sealedMembers.add(member.name)
                continue
            }
            if (member.method) {
                if (member.name === '') {
                    if (member.body && !runtimeValue.__junoCall?.__junoFunction) {
                        Object.defineProperty(runtimeValue, '__junoCall', {
                            enumerable: false,
                            configurable: true,
                            writable: true,
                            value: { __junoFunction: true, params: member.params ?? [], body: member.body, closure: env, thisValue: value } satisfies RuntimeFunction
                        })
                    }
                    continue
                }
                const isDefaultToString = member.name === 'toString' && runtimeValue[member.name]?.__junoDefaultToString
                if (member.body && (isDefaultToString || (typeof runtimeValue[member.name] !== 'function' && !runtimeValue[member.name]?.__junoFunction))) {
                    ;(value as Record<string, any>)[member.name] = { __junoFunction: true, params: member.params ?? [], body: member.body, closure: env, thisValue: value } satisfies RuntimeFunction
                }
                if (member.sealed) sealedMembers.add(member.name)
                continue
            }
            const nullableMember = member.type.kind === 'NamedType' && member.type.name === 'null'
                || member.type.kind === 'UnionType' && member.type.types.some(part => part.kind === 'NamedType' && part.name === 'null')
            if (!Object.prototype.hasOwnProperty.call(value, member.name) && (member.optional || nullableMember) && member.defaultValue === undefined) {
                Object.defineProperty(runtimeValue, member.name, {
                    value: null,
                    enumerable: false,
                    writable: !member.readonly,
                    configurable: !member.readonly
                })
            }
            if (!Object.prototype.hasOwnProperty.call(value, member.name) && member.defaultValue) {
                ;(value as Record<string, any>)[member.name] = this.evaluate(member.defaultValue, env)
            }
            const fieldValue = value[member.name]
            if (fieldValue && typeof fieldValue === 'object' && !Array.isArray(fieldValue)) {
                this.applyTypeDefaults(fieldValue, member.type, env, resolving)
            }
            if (member.sealed) sealedMembers.add(member.name)
        }
        this.installCallableMethods(runtimeValue)
        return value
    }

    private findTypeMember(type: TypeNode, name: string, env: Environment, resolving = new Set<string>()): { type: TypeNode; optional: boolean } | null {
        if ((name === 'asReadonly' || name === 'asMutable' || name === 'deepClone' || name === 'deepFreeze' || name === 'toDeepFreezed') && !(type.kind === 'LiteralType' && type.value === null) && !(type.kind === 'NamedType' && type.name === 'null')) {
            return { type: { kind: 'FunctionType', params: [], result: type }, optional: false }
        }
        if (type.kind === 'NamedType') {
            if (resolving.has(type.name)) return null
            for (let current: Environment | undefined = env; current; current = current.parent) {
                const alias = current.types.get(type.name)
                if (alias && alias.generics.every((_generic, index) => alias.genericDefaults?.[index])) return this.findTypeMember(this.instantiateAlias(alias, []), name, env, new Set([...resolving, type.name]))
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
            if (type.name === 'number' && name === 'valueOf') {
                return { type: { kind: 'FunctionType', params: [], result: { kind: 'NamedType', name: 'number' } }, optional: false }
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
            const member = type.members.find(item => !item.indexType && item.name === name && item.accessor === 'get')
                ?? type.members.find(item => !item.indexType && item.name === name)
            if (member) return { type: member.type, optional: member.optional }
            const indexMember = type.members.find(item => item.indexType && this.matchesTypeNode(name, item.indexType, env))
            if (indexMember) return { type: indexMember.type, optional: indexMember.optional }
            const call = type.members.find(item => item.name === '' && item.method)
            if (call) {
                const any = { kind: 'NamedType', name: 'any' } as TypeNode
                const signature = { kind: 'FunctionType', params: (call.params ?? []).map(param => param.type ?? any), result: call.type } as TypeNode
                if (name === 'call') return { type: { kind: 'FunctionType', params: [any, ...(call.params ?? []).map(param => param.type ?? any)], result: call.type }, optional: false }
                if (name === 'apply') return { type: { kind: 'FunctionType', params: [any, { kind: 'ArrayType', element: any }], result: call.type }, optional: false }
                if (name === 'bind') return { type: { kind: 'FunctionType', params: [any], result: signature }, optional: false }
            }
            if (name === 'has') return { type: { kind: 'FunctionType', params: [{ kind: 'NamedType', name: 'string' }], result: { kind: 'NamedType', name: 'boolean' } }, optional: false }
            if (name === 'pick' || name === 'omit') return { type: { kind: 'FunctionType', params: [{ kind: 'ArrayType', element: { kind: 'NamedType', name: 'any' } }], result: type }, optional: false }
        }
        if ((name === 'pick' || name === 'omit') && (type.kind === 'ArrayType' || type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray'))) {
            return { type: { kind: 'FunctionType', params: [{ kind: 'ArrayType', element: { kind: 'NamedType', name: 'number' } }], result: type }, optional: false }
        }
        if (name === 'has' && (type.kind === 'ArrayType' || type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray'))) {
            return { type: { kind: 'FunctionType', params: [{ kind: 'NamedType', name: 'string' }], result: { kind: 'NamedType', name: 'boolean' } }, optional: false }
        }
        if (name === 'length' && (type.kind === 'ArrayType' || type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray'))) {
            return { type: { kind: 'NamedType', name: 'number' }, optional: false }
        }
        if (name === 'indices' && (type.kind === 'ArrayType' || type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray'))) {
            return { type: { kind: 'NamedType', name: 'Range' }, optional: false }
        }
        if (name === 'push' && (type.kind === 'ArrayType' || type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray'))) {
            const element = type.kind === 'ArrayType' ? type.element : type.args[0] ?? { kind: 'NamedType', name: 'any' }
            return { type: { kind: 'FunctionType', params: [element], result: { kind: 'NamedType', name: 'number' } }, optional: false }
        }
        if (name === 'includes' && (type.kind === 'ArrayType' || type.kind === 'GenericType' && (type.name === 'Array' || type.name === 'ReadonlyArray'))) {
            const element = type.kind === 'ArrayType' ? type.element : type.args[0] ?? { kind: 'NamedType', name: 'any' }
            return { type: { kind: 'FunctionType', params: [element], result: { kind: 'NamedType', name: 'boolean' } }, optional: false }
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
        if (Array.isArray(object) && property === 'includes') {
            return (value: unknown, fromIndex = 0): boolean => {
                let start = Math.trunc(fromIndex)
                if (start < 0) start = Math.max(object.length + start, 0)
                for (let index = start; index < object.length; index++) {
                    if (deepEqual(object[index], value)) return true
                }
                return false
            }
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
        const memberLookupType = declaredType && optional ? this.nonNullableType(declaredType) : declaredType
        const declaredMember = memberLookupType ? this.findTypeMember(memberLookupType, property, env) : null
        if (declaredType && !(declaredType.kind === 'NamedType' && declaredType.name === 'any') && !declaredMember) {
            throw new TypeError(`Property '${property}' does not exist on declared type`)
        }
        if (!(property in Object(object))) {
            if (optional || declaredMember?.optional) return null
            throw new TypeError(`Property '${property}' does not exist on value`)
        }
        const value = (object as any)[property]
        return value === undefined ? null : value
    }
}

function deepEqual(a: any, b: any, seen = new WeakMap<object, WeakSet<object>>()): boolean {
    if (a === b || typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)) return true
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
    if (Array.isArray(a) !== Array.isArray(b)) return false
    let compared = seen.get(a)
    if (compared?.has(b)) return true
    if (!compared) { compared = new WeakSet<object>(); seen.set(a, compared) }
    compared.add(b)
    const structuralKeys = (value: Record<string, unknown>): string[] => Object.keys(value).filter(key =>
        !(key === 'toString' && typeof value[key] === 'function' && (value[key] as { __junoDefaultToString?: boolean }).__junoDefaultToString)
    )
    const keysA = structuralKeys(a), keysB = structuralKeys(b)
    return keysA.length === keysB.length && keysA.every(key => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key], seen))
}

function isRuntimeCallable(value: unknown): boolean {
    return Boolean(value && typeof value === 'object' && ((value as any).__junoFunction || (value as any).__junoConstructor))
}

function deepCloneValue<T>(value: T, seen = new WeakMap<object, any>()): T {
    if (value === null || typeof value !== 'object' || isRuntimeCallable(value)) return value
    const existing = seen.get(value)
    if (existing) return existing
    if (value instanceof Set) {
        const clone = new Set()
        seen.set(value, clone)
        for (const item of value) clone.add(deepCloneValue(item, seen))
        return clone as T
    }
    if (value instanceof Map) {
        const clone = new Map()
        seen.set(value, clone)
        for (const [key, item] of value) clone.set(deepCloneValue(key, seen), deepCloneValue(item, seen))
        return clone as T
    }
    const clone: any = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value))
    seen.set(value, clone)
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor) continue
        if ('value' in descriptor) descriptor.value = deepCloneValue(descriptor.value, seen)
        Object.defineProperty(clone, key, descriptor)
    }
    return clone
}

function deepFreezeValue<T>(value: T, seen = new WeakSet<object>()): T {
    if (value === null || typeof value !== 'object' || isRuntimeCallable(value) || seen.has(value)) return value
    seen.add(value)
    for (const key of Reflect.ownKeys(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (descriptor && 'value' in descriptor) deepFreezeValue(descriptor.value, seen)
    }
    return Object.freeze(value)
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
        case 'IndexedAccessType': return `${typeName(type.object)}[${typeName(type.index)}]`
        case 'TypeOfType': return 'typeof<…>'
        case 'ConditionalType': return `${typeName(type.check)} is ${typeName(type.target)} ? ${typeName(type.consequent)} : ${typeName(type.alternate)}`
        case 'UnionType': return type.types.map(typeName).join(' | ')
        case 'IntersectionType': return type.types.map(typeName).join(' & ')
        case 'FunctionType': return 'function'
        case 'ObjectType': return 'object'
    }
}

export function runFile(file: string): void {
    const path = resolve(file)
    const source = readFileSync(path, 'utf8')
    const diagnostics = analyze(source, path)?.diagnostics ?? []
    if (diagnostics.length) {
        const details = diagnostics
            .map(diagnostic => `${path}:${diagnostic.line}:${diagnostic.column} - ${diagnostic.message}`)
            .join('\n')
        throw new Error(`JunoScript diagnostics prevented execution:\n${details}`)
    }
    const interpreter = new Interpreter()
    ;(interpreter as any).currentDirectory = resolve(path, '..')
    interpreter.run(source, path)
}

export function runBuiltModule(source: string, file: string): Record<string, unknown> {
    const path = resolve(file)
    const diagnostics = analyze(source, path)?.diagnostics ?? []
    if (diagnostics.length) {
        const details = diagnostics
            .map(diagnostic => `${path}:${diagnostic.line}:${diagnostic.column} - ${diagnostic.message}`)
            .join('\n')
        throw new Error(`JunoScript diagnostics prevented module initialization:\n${details}`)
    }
    return new Interpreter().runModule(source, path)
}
