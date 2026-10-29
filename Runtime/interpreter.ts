import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Expression, Parameter, Statement, parse } from '../Lexer/parser'
import { resolveModule } from '../Modules'

type Environment = Map<string, { value: unknown; mutable: boolean }>
type RuntimeFunction = { __junoFunction: true; params: Parameter[]; body: Statement[]; closure: Environment; thisValue?: unknown }
class ReturnValue { constructor(readonly value: unknown) {} }

export class Interpreter {
    private readonly globals: Environment = new Map()
    constructor() { this.globals.set('isType', { value: (value: unknown, type: unknown) => matchesType(value, type), mutable: false }) }

    run(source: string): void { this.executeStatements(parse(source), this.globals) }

    private executeStatements(statements: Statement[], env: Environment): unknown {
        for (const statement of statements) {
            try { this.execute(statement, env) }
            catch (error) { if (error instanceof ReturnValue) return error.value; throw error }
        }
        return undefined
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
            case 'Variable': this.declare(env, statement.name, statement.initializer ? this.evaluate(statement.initializer, env) : null, statement.mutable); return
            case 'TypeDeclaration': return
            case 'FunctionDeclaration': this.declare(env, statement.name, { __junoFunction: true, params: statement.params, body: statement.body, closure: env } satisfies RuntimeFunction, false); return
            case 'Return': throw new ReturnValue(statement.value ? this.evaluate(statement.value, env) : undefined)
            case 'ExpressionStatement': this.evaluate(statement.expression, env); return
            case 'If': this.executeStatements(this.evaluate(statement.condition, env) ? statement.consequent : (statement.alternate ?? []), new Map(env)); return
            case 'While': while (this.evaluate(statement.condition, env)) this.executeStatements(statement.body, new Map(env)); return
            case 'ForOf': {
                const values = this.evaluate(statement.iterable, env) as any
                for (const value of values) { const local = new Map(env); this.declare(local, statement.binding, value, statement.mutable); this.executeStatements(statement.body, local) }
                return
            }
        }
    }

    private evaluate(expression: Expression, env: Environment): any {
        switch (expression.kind) {
            case 'Literal': return expression.value
            case 'Identifier':
                if (expression.name === 'this') return env.get('this')?.value
                if (!env.has(expression.name)) throw new ReferenceError(`${expression.name} is not defined`)
                return env.get(expression.name)?.value
            case 'Assignment': {
                const binding = env.get(expression.name)
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
                const left = this.evaluate(expression.left, env), right = this.evaluate(expression.right, env)
                switch (expression.operator) {
                    case '+': return left + right
                    case '-': return left - right
                    case '*': return left * right
                    case '/': return left / right
                    case '%': return left % right
                    case '==': return deepEqual(left, right)
                    case '!=': return !deepEqual(left, right)
                    case '<': return left < right
                    case '<=': return left <= right
                    case '>': return left > right
                    case '>=': return left >= right
                    case '|': return Boolean(left) || Boolean(right)
                    case '&': return Boolean(left) && Boolean(right)
                    default: throw new Error(`Unsupported operator '${expression.operator}'`)
                }
            }
            case 'Member': {
                const object = this.evaluate(expression.object, env)
                if (object == null && expression.optional) return null
                return (object as any)?.[expression.property]
            }
            case 'Call': {
                let thisValue: unknown
                let callee: any
                if (expression.callee.kind === 'Member') { thisValue = this.evaluate(expression.callee.object, env); callee = (thisValue as any)?.[expression.callee.property] }
                else callee = this.evaluate(expression.callee, env)
                const args = expression.args.map(arg => this.evaluate(arg, env))
                if (expression.typeArguments?.length) args.push(expression.typeArguments[0].kind === 'NamedType' ? expression.typeArguments[0].name : 'object')
                if (typeof callee === 'function') return callee.apply(thisValue, args)
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
        const local = new Map(fn.closure)
        if (thisValue !== undefined) local.set('this', { value: thisValue, mutable: false })
        fn.params.forEach((param, index) => this.declare(local, param.name, args[index] ?? (param.defaultValue ? this.evaluate(param.defaultValue, local) : null), true))
        return this.executeStatements(fn.body, local)
    }

    private declare(env: Environment, name: string, value: unknown, mutable: boolean): void {
        if (env.has(name)) throw new SyntaxError(`Duplicate declaration '${name}' in the same scope`)
        env.set(name, { value, mutable })
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
