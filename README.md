# JunoScript

JunoScript — экспериментальный интерпретируемый язык с отступами вместо фигурных скобок, структурной системой типов и синтаксисом, вдохновлённым TypeScript.

Проект включает lexer, parser, интерпретатор `junode`, стандартные модули, расширение VS Code с diagnostics/hover/inlay hints и взаимодействие с JavaScript/TypeScript.

> JunoScript находится в разработке. Документация описывает возможности, представленные parser AST, runtime и программами из каталога [`Tests`](./Tests). API ещё может меняться.

## Содержание

- [Установка и запуск](#установка-и-запуск)
- [Сборка JN в JavaScript или TypeScript](#сборка-jn-в-javascript-или-typescript)
- [Первая программа](#первая-программа)
- [Основы синтаксиса](#основы-синтаксиса)
- [Переменные и inference](#переменные-и-inference)
- [Типы](#типы)
- [Функции](#функции)
- [Условия, циклы и match](#условия-циклы-и-match)
- [Массивы, Tuple и destructuring](#массивы-tuple-и-destructuring)
- [Объявления type](#объявления-type)
- [Конструкторы](#конструкторы)
- [Объекты](#объекты)
- [Generics](#generics)
- [Utility types](#utility-types)
- [Iterable и коллекции](#iterable-и-коллекции)
- [Обработка ошибок](#обработка-ошибок)
- [Строки и RegEx](#строки-и-regex)
- [Модули и TypeScript](#модули-и-typescript)
- [Стандартные модули](#стандартные-модули)
- [VS Code](#vs-code)
- [Тестовые программы](#тестовые-программы)

## Установка и запуск

Требуются Node.js и npm. Установите зависимости и соберите проект:

```sh
npm install
npm run build
```

Запуск `.jn`-файла из checkout:

```sh
npm start -- Tests/test.jn
```

Команду `junode` можно зарегистрировать глобально:

```sh
npm link
junode Tests/test.jn
```

Аргументы передаются после имени файла:

```sh
junode program.jn first second
```

Сборка расширения VS Code:

```sh
npm run compile --prefix vscode-junoscript
```

После пересборки установленного расширения выполните `Developer: Reload Window`.

## Сборка JN в JavaScript или TypeScript

CLI умеет создавать исполняемый JS/TS-модуль из JunoScript-файла:

```sh
junode --build source.jn
```

По умолчанию рядом с `source.jn` создаётся `source.js`. Явный output:

```sh
junode --build source.jn --out dist/source.js
```

TypeScript wrapper:

```sh
junode --build source.jn --target ts
junode --build source.jn --out dist/source.ts
```

Текущий `.ts` backend создаёт именованные exports, но пока объявляет их как `any`. Он предназначен для выполнения и проверки module wiring; генерация точных `.d.ts`/TS-сигнатур является отдельным будущим этапом. Точные Juno-типы доступны в `.jn` source и hover расширения.

Перед генерацией выполняется полный Juno-анализ. При diagnostics файл не создаётся. Сгенерированный модуль встраивает entry JN source и запускает его через Juno runtime backend. Внутри выполняемого JN-кода сохраняются:

- runtime type behavior и type defaults;
- `readonly` и `sealed` semantics;
- constructors и overload dispatch;
- `Iterable`, `Result`, `try/catch` и стандартные типы;
- Juno stack information и module resolution.

Собранный файл является runtime wrapper, а не standalone bundle. Он зависит от собранного Juno runtime. Relative imports продолжают разрешаться относительно исходного `.jn`-файла, поэтому импортируемые `.jn`/`.js`/`.ts` dependencies должны оставаться доступными. Entry source при этом уже встроен в generated-файл.

Проверки `readonly`/`sealed` гарантируются при выполнении JN-операций. JavaScript consumer получает обычные JS values; прямое изменение объекта со стороны JS находится за границей статической системы JunoScript.

Пример исходного модуля:

```junoscript
export const answer = 42

export fun greet(name: string): string =
    return 'Hello, ${name}'

export constructor Counter: {
    value: number
} {
    fun (value: number): Counter =
        return { value }

    fun zero(): Counter =
        return Counter(0)
}
```

Использование собранного CommonJS-модуля:

```js
const { answer, greet, Counter } = require('./source.js')

const counter = Counter(10)
const empty = Counter.zero()
```

### Представление JN constructor в JavaScript

JN constructor экспортируется как callable function object, концептуально:

```js
const Counter = Object.assign(
    (...args) => createJunoValue(...args),
    { zero: () => createJunoValue(0) }
)
```

Это намеренный выбор вместо JS `class`:

- Juno constructors вызываются без `new`;
- они могут иметь несколько call overloads;
- constructor возвращает структурный объект, а не обязательно class instance;
- static methods естественно размещаются на function object;
- сохраняется callable/structural модель JunoScript.

Из JavaScript JN constructor можно вызвать как обычную функцию. Его static methods также являются обычными JS-функциями.

### Импорт JS/TS class в JunoScript

Экспортированный JavaScript или TypeScript `class` автоматически адаптируется в Juno constructor:

```ts
export class NativeCounter {
    static zero(): NativeCounter { return new NativeCounter(0) }
    value: number
    constructor(value: number) { this.value = value }
    increment(): number { return ++this.value }
}
```

```junoscript
import { NativeCounter } from './native.ts'

const counter = NativeCounter(5) # внутри выполняется new NativeCounter(5)
counter.increment()

const zero = NativeCounter.zero()
```

Static values остаются доступны во время выполнения через `NativeCounter.member`. Для hover и inference расширение в текущей версии извлекает constructor parameters, public/readonly instance fields, instance methods, static methods и generic parameters class/methods.

Static data fields доступны runtime, но пока не получают точный тип из host source analysis.

Пример hover для class import:

```text
constructor NativeAccumulator(value: number): NativeAccumulator
NativeAccumulator.zero(): NativeAccumulator
```

Результат вызова сохраняет instance type и структурное описание:

```text
const sampleAccumulator: NativeAccumulator

{
  value: number;
  add(amount: number): number;
}
```

Экспортированный class не должен деградировать до `any`. Это поведение закреплено тестом `checkInference.cjs`.

### Тесты build pipeline

Полный набор fixtures находится в [`Tests/testBuild`](./Tests/testBuild). Сначала соберите проект, затем запустите suite:

```sh
npm run build
npm run test:build
```

Runner создаёт временный каталог `Tests/testBuild/.generated`, выполняет проверки и всегда удаляет generated-файлы после завершения.

| Fixture | Что проверяет |
| --- | --- |
| [`testBuild.jn`](./Tests/testBuild/testBuild.jn) | Экспорт `const`, функции, JN constructor и static method |
| [`dependency.jn`](./Tests/testBuild/dependency.jn) | Экспорт generic constructor из зависимого JN-модуля |
| [`imports.jn`](./Tests/testBuild/imports.jn) | Relative import другого `.jn` во время работы generated module |
| [`runtimeTypes.jn`](./Tests/testBuild/runtimeTypes.jn) | `type` defaults и экспортированные JN methods |
| [`nativeClass.ts`](./Tests/testBuild/nativeClass.ts) | Нативный TypeScript class с instance/static methods |
| [`classInterop.jn`](./Tests/testBuild/classInterop.jn) | Импорт TS class как Juno constructor и повторный экспорт значений |
| [`checkInference.cjs`](./Tests/testBuild/checkInference.cjs) | Regression-тест constructor hover, instance shape и защиты от `any` |
| [`consumeBuilt.cjs`](./Tests/testBuild/consumeBuilt.cjs) | Runtime assertions для generated CommonJS modules |
| [`consumeTypes.ts`](./Tests/testBuild/consumeTypes.ts) | Module wiring generated TypeScript wrapper и проверка через `tsc` |
| [`run.cjs`](./Tests/testBuild/run.cjs) | Сборка fixtures, запуск assertions, `tsc` и cleanup |

Отдельная краткая памятка находится в [`Tests/testBuild/README.md`](./Tests/testBuild/README.md).

## Первая программа

```junoscript
import { console } from 'juno'

const language = 'JunoScript'

fun greet(name: string): string =
    return 'Hello, ${name}!'

console.log(greet(language))
```

Расширение файла — `.jn`. Блоки обозначаются отступами.

## Основы синтаксиса

### Отступы

После `=`, условия, цикла или ветки ожидается indented block:

```junoscript
fun absolute(value: number): number =
    if value < 0
        return -value
    return value
```

Пустые строки перед и внутри блоков разрешены.

### Комментарии

Комментарий начинается с `#`:

```junoscript
# Обычный комментарий.
const answer = 42

# В Tests так записаны негативные проверки:
# const invalid: number = 'text'
```

Точки с запятой не нужны.

## Переменные и inference

`const` создаёт неизменяемую привязку, `let` — изменяемую:

```junoscript
const name = 'Ada'
let age = 36
age = age + 1
```

Тип можно указать явно или вывести:

```junoscript
const title: string = 'Engineer'
let scores = [10, 20, 30]    # number[]
let second = scores[1]       # number
```

Многострочный initializer:

```junoscript
let person =
    {
        name: 'Ada'
        age: 36
        active: true
    }
```

См. [`Tests/testTypeInference.jn`](./Tests/testTypeInference.jn).

## Типы

### Карта типов JunoScript

| Категория | Синтаксис | Пример значения | Назначение |
| --- | --- | --- | --- |
| Строка | `string` | `'Juno'` | Текст и последовательность символов |
| Число | `number` | `42`, `3.14` | Целые и дробные IEEE-754 числа |
| Большое целое | `BigInt` | `1n` | Целые произвольной точности |
| Логическое значение | `boolean` | `true`, `false` | Условия и логические операции |
| Пустое значение | `null` | `null` | Отсутствующее значение |
| Любой тип | `any` | любое значение | Отключает обычную статическую конкретизацию; требует narrowing перед доступом к членам |
| Неизвестный тип | `unknown` | любое значение | Безопасный верхний тип для ещё не проверенных значений |
| Невозможный тип | `never` | — | Значение, которое не может существовать |
| Отсутствующий результат | `void` | — | Функция не возвращает полезного значения |
| Общий объект | `object` | `{ name: 'Ada' }` | Любое объектное значение |
| Массив | `T[]`, `Array<T>` | `[1, 2, 3]` | Изменяемая последовательность элементов `T` |
| Readonly-массив | `ReadonlyArray<T>` | `[1, 2].asReadonly()` | Последовательность без mutating methods |
| Tuple | `Tuple<A, B>` | `Tuple('id', 42)` | Последовательность с отдельным типом каждой позиции |
| Объектный тип | `{ name: string }` | `{ name: 'Ada' }` | Структурный набор полей, methods и accessors |
| Функция | `(A, B) -> R` | `(a, b) => a + b` | Вызываемое значение |
| RegEx | `RegEx` | `/hello/i` | Регулярное выражение |
| Range | `Range` | `Range(5)` | Итерируемый диапазон `number` |
| Result | `Result<T, E>` | `ok(42)` | Успешное значение или ошибка |
| Коллекции | `Set<T>`, `Map<K, V>`, `Queue<T>` | `Queue(1, 2)` | Типизированные стандартные коллекции |

Помимо runtime-типов система типов поддерживает конструкции, которые существуют только во время анализа:

| Конструкция | Пример |
| --- | --- |
| Literal type | `'ready'`, `42`, `true` |
| Union | `string | number` |
| Intersection | `Named & Active` |
| Nullable | `User?` |
| Generic type | `Box<string>` |
| Indexed access | `User['name']` |
| `typeof` type | `typeof<value>` |
| Mapped/index signature | `{ [key: Keys]: number }` |
| Conditional type | `T is string ? true : false` |
| Utility type | `Pick<User, 'name'>` |

### Примитивы

```junoscript
const text: string = 'Juno'
const count: number = 42
const enabled: boolean = true
const large: BigInt = 1n
const empty: null = null
```

В type expressions также применяются `any`, `unknown`, `never`, `void` и `object`.

### Literal, union и intersection types

```junoscript
type Direction = 'left' | 'right'
type Status = 0 | 1 | -1
type Identifier = string | number

type Named = { name: string }
type Active = { active: boolean }
type ActiveUser = Named & Active
```

Примеры: [`Tests/testTyping.jn`](./Tests/testTyping.jn).

### Nullable types

`T?` — сокращение nullable-типа:

```junoscript
let selected: number? = null

fun findValue(): string? =
    return null
```

Nullable-операции:

```junoscript
const display = selectedName ?? 'Guest'
const forced = selectedName!
const length = selectedName?.length
```

Перед обычным обращением nullable-значение нужно проверить. Примеры: [`Tests/test1.jn`](./Tests/test1.jn) и [`Tests/testBoolean.jn`](./Tests/testBoolean.jn).

### Object types

```junoscript
type User = {
    name: string
    age: number?
    readonly id: number
    greet(prefix: string): string
}
```

Члены типа могут иметь default implementation:

```junoscript
type Named = {
    name: string

    toString(): string =
        return this.name
}
```

Object type является структурным: значение совместимо с типом, если содержит необходимые члены подходящих типов. Имя constructor или prototype само по себе не требуется.

### Function types

```junoscript
type Mapper = (number, number) -> number

fun calculate(callback: Mapper, left: number, right: number): number =
    return callback(left, right)
```

### Проверка и сужение типа

```junoscript
const value: any = 42

if isType<number>(value)
    console.log(value + 1)
```

Свойства `any` нельзя безопасно использовать до проверки через `isType<T>()` или `has()`. См. [`Tests/testTyping.jn`](./Tests/testTyping.jn).

### Операторы

Поддерживаются арифметические `+ - * / %`, сравнения `== != < <= > >=`, `&`, `|`, `!`, `??`, ternary expression, compound assignments и increment/decrement:

```junoscript
let count = 0
++count
count += 2

const label = count > 1 ? 'many' : 'one'
```

Типы операндов проверяются анализатором.

## Функции

### Объявление и return type inference

```junoscript
fun add(left: number, right: number): number =
    return left + right

fun greet(name: string) =
    return 'Hello, ${name}'
```

### Default и rest parameters

```junoscript
fun greet(name: string = 'friend'): string =
    return 'Hello, ${name}'

fun sum(first: number, ...rest: number[]): number =
    let result = first
    for const value of rest
        result += value
    return result
```

### Arrow functions

```junoscript
const double = (value: number): number => value * 2

const normalize = (value: number): number? =>
    if value < 0
        return null
    return value
```

Callback parameters выводятся из контекста:

```junoscript
const doubled = [1, 2, 3].map((value) => value * 2)
```

Функции являются значениями:

```junoscript
fun apply(callback: (number) -> number, value: number): number =
    return callback(value)

const result = apply((value) => value + 1, 41)
```

Полные примеры default/rest/arrow functions: [`Tests/test1.jn`](./Tests/test1.jn).

## Условия, циклы и match

### If/else

```junoscript
if score >= 90
    console.log('excellent')
else
    console.log('keep going')
```

### While, for-of и break

```junoscript
let count = 0
while count < 3
    count++

for const value of [1, 2, 3, 4]
    if value == 3
        break
    console.log(value)
```

Тип binding в `for-of` выводится из iterable. Для `array.indices` он равен `number`.

### Match expression

`match` возвращает значение и поддерживает literal/type/object patterns, guards и bindings:

```junoscript
fun describe(value: string | number) = match value
    case 'Juno'
        return 'language'
    case string
        return 'text'
    case number
        return 'number'
```

```junoscript
const result = match { error: 'failed', code: 500 }
    case { error, code } when code >= 500
        return '${error}: server error'
```

Если ветка не совпала, результат может быть nullable. См. [`Tests/test1.jn`](./Tests/test1.jn).

## Массивы, Tuple и destructuring

### Массивы и spread

```junoscript
const numbers = [10, 20, 30]
const first: number = numbers[0]
numbers.push(40)

const combined = [0, ...numbers, 50]
```

Массивы поддерживают TypeScript-подобные методы, `indices`, методы `Iterable`, `pick`, `omit`, `asReadonly` и `asMutable`.

### Array constructor

```junoscript
import { Array } from 'juno:types'

const filled = Array<number>(3, {
    fill: (element, index) => index
})

const copied = Array.from([10, 20, 30])
const mapped = Array.from([10, 20], (value, index) => value + index)
const values = Array.of(4, 5, 6)
```

### Tuple

```junoscript
import { Tuple } from 'juno:types'

const tuple = Tuple('first', 2, true)
const text = tuple[0]       # string
const number = tuple[1]     # number
const flag = tuple[2]       # boolean
```

Tuple readonly по умолчанию и сохраняет тип каждой позиции.

### Destructuring

```junoscript
const [first, , third, ...rest] = [10, 20, 30, 40, 50]
const [text, number,] = Tuple('value', 42)

const source = { name: 'Ada', age: 36 }
const { name, age } = source
```

См. [`Tests/testArray.jn`](./Tests/testArray.jn) и [`Tests/testGenericTypes4.jn`](./Tests/testGenericTypes4.jn).

## Объявления type

`type` создаёт именованный тип. Это compile-time declaration, но объектный type также может использоваться как runtime factory для применения defaults и проверки формы.

### Alias простого или составного типа

```junoscript
type Identifier = string | number
type OptionalIdentifier = Identifier?
type Callback = (number) -> string
```

### Структурный object type

```junoscript
type Person = {
    readonly id: number
    name: string
    age: number?

    greet(prefix: string): string
}

const ada: Person = {
    id: 1
    name: 'Ada'
    age: 36

    greet(prefix: string): string =
        return '${prefix}, ${this.name}'
}
```

Обязательный член должен присутствовать. `?` делает поле nullable/optional в поддерживаемых контекстах, а `readonly` запрещает присваивание после создания.

### Default fields и methods

```junoscript
type Entity = {
    active: boolean = true

    describe(): string =
        return this.active ? 'active' : 'inactive'
}

const entity = Entity()
```

Вызов object type как функции создаёт/адаптирует объект и применяет default members:

```junoscript
type Greeting = { text: string }

const text = 'Hello'
const greeting = Greeting({ text })
```

Пример такого вызова есть в [`Tests/testImportExports.jn`](./Tests/testImportExports.jn).

### Generic type

```junoscript
type Box<T is string | number = string> = {
    value: T
}

const defaultBox: Box = { value: 'text' }
const numberBox: Box<number> = { value: 42 }
```

Generic parameters поддерживают constraint через `is` и default через `=`.

### Type с index signature

```junoscript
type Dictionary<T> = {
    [key: string]: T
}
```

Mapped key может быть union литералов:

```junoscript
type Coordinates = {
    [key: 'x' | 'y']: number
}
```

### Type с callable member

```junoscript
type Formatter = {
    fun (value: string | number): string
    description: string
}
```

Такой тип описывает объект, который одновременно содержит свойства и вызывается как функция.

## Конструкторы

`constructor` связывает одно или несколько call overloads, общий inherited type и статические methods.

### Базовая форма

```junoscript
type PointShape = {
    x: number
    y: number
}

export constructor Point: PointShape {
    fun (x: number, y: number): Point =
        return { x, y }
}

const point = Point(10, 20)
```

После имени constructor через `:` указывается тип создаваемых значений. Anonymous `fun (...)` внутри фигурных скобок задаёт call overload.

### Generic constructor

```junoscript
export constructor Container<T>: {
    value: T
} {
    fun (value: T): Container<T> =
        return { value }
}

const inferred = Container(42)          # Container<number>
const explicit = Container<string>('x')
```

Как и у generic functions/types, доступны constraints и defaults:

```junoscript
constructor TextContainer<T is string = string>: {
    value: T
} {
    fun (value: T): TextContainer<T> =
        return { value }
}
```

### Несколько overloads

Constructor block может содержать несколько anonymous `fun` с разными parameters:

```junoscript
constructor Coordinate: { x: number, y: number } {
    fun (value: number): Coordinate =
        return { x: value, y: value }

    fun (x: number, y: number): Coordinate =
        return { x, y }
}
```

### Статические методы constructor

Named functions в constructor block вызываются через имя constructor:

```junoscript
constructor Pair<T>: { first: T, second: T } {
    fun (first: T, second: T): Pair<T> =
        return { first, second }

    fun from<T>(items: T[]): Pair<T> =
        return Pair(items[0], items[1])
}

const pair = Pair.from([10, 20])
```

Так устроены методы наподобие `Array.from`, `Array.of`, `Set.from`, `Map.from` и `Object.from`.

### Inherited/default members

Constructor может наследовать object type или intersection:

```junoscript
constructor NumberQueue<T>: Iterable<T> & {
    push(...items: T[]): number
    pop(): T?
} {
    fun (...items: T[]) =
        # Возвращаемый object получает default members Iterable<T>.
        return { ... }
}
```

Runtime применяет default fields/methods inherited-типа к возвращённому объекту. Реальные примеры: [`types/array.jn`](./types/array.jn), [`types/range.jn`](./types/range.jn), [`types/queue.jn`](./types/queue.jn) и [`Tests/testGenericTypes3.jn`](./Tests/testGenericTypes3.jn).

## Объекты

В JunoScript `object` — это структурное runtime-значение. Оно может одновременно содержать данные, methods, getters/setters, index signatures и anonymous call member.

### Поля

```junoscript
const user = {
    name: 'Ada'
    age: 36
    nested: { active: true }
}
```

Доступ возможен через точку и индекс:

```junoscript
const name1 = user.name
const name2 = user['name']
```

Index access проверяется по известным полям или index signature. Некорректный key type создаёт diagnostic.

### Object literal и методы

```junoscript
const person = {
    name: 'Ada'
    age: 36

    greet(prefix: string): string =
        return '${prefix}, ${this.name}'
}
```

Методы видят тип `this` и остальные члены объекта.

Named method можно объявить и с ключевым словом `fun`:

```junoscript
const object = {
    value: 42

    fun describe(prefix: string): string =
        return '${prefix}:${this.value}'
}
```

Generic object methods:

```junoscript
const selectors = {
    sealed fun identity<T>(value: T): T =
        return value
}
```

### Getter и setter

```junoscript
const counter = {
    value: 1

    get doubled(): number =
        return this.value * 2

    set current(value: number) =
        this.value = value
}
```

### Readonly, sealed и spread

```junoscript
const base = {
    readonly id: 1
    sealed value: 42

    sealed fun describe(): string =
        return this.value.toString()
}

const extended = { ...base, name: 'object' }
```

`readonly` запрещает запись, `sealed` — переопределение члена, включая spread override.

### Index signatures

```junoscript
const numericObject = {
    [index: number]: string
    length: 0
}
```

Index signature описывает тип допустимого ключа и тип значения при индексном доступе. В type declaration используется тот же синтаксис.

### Callable objects

```junoscript
const adder = {
    offset: 10

    fun (left: number, right: number): number =
        return this.offset + left + right
}

const result = adder(3, 4)
```

Callable-объекты поддерживают `call`, `apply` и `bind`, если не переопределяют их. См. [`Tests/testObject.jn`](./Tests/testObject.jn).

### Structural casts

`as<T>()` создаёт typed view, не удаляя дополнительные runtime-поля:

```junoscript
type HasName = { name: string }

const extended = { name: 'Ada', role: 'admin', employeeId: 42 }
const person = extended.as<HasName>()
```

### Boolean/string conversion

Объект может переопределить conversion methods:

```junoscript
const value = {
    count: 0

    fun toBoolean(): boolean =
        return this.count > 0

    fun toString(): string =
        return 'count=${this.count}'
}
```

`toBoolean()` используется в boolean context, `toString()` — при interpolation и текстовом выводе.

### Object helpers

```junoscript
const source = { name: 'Ada', age: 36, language: 'Juno' }

const picked = source.pick('name', 'age')  # { name, age }
const omitted = source.omit('age')         # { name, language }
const keys = source.keys()
const values = source.values()
const entries = source.entries()

const clone = source.deepClone()
const readonlyCopy = source.asReadonly()
const mutableCopy = readonlyCopy.asMutable()
const frozen = source.deepFreeze()
const frozenCopy = source.toDeepFreezed()
```

Также доступны `has`, `toJSON`, `toJson` и `toString`.

## Generics

### Functions, constraints и defaults

```junoscript
fun identity<T>(value: T): T =
    return value

fun identityScalar<T is string | number>(value: T): T =
    return value

fun choose<T is string | number = string>(value: T): T =
    return value
```

Generic argument можно передать явно или вывести:

```junoscript
const number = identity(42)
const text = identity<string>('Juno')
```

### Generic aliases и constructors

```junoscript
type Box<T> = {
    value: T
}

const box: Box<string> = { value: 'text' }
```

```junoscript
constructor Formatter<T is string = string>: {
    value: T
} {
    fun (value: T): Formatter<T> =
        return { value }
}
```

Generic inference отображается в hover:

```junoscript
const queue = Queue(1, 2, 3)  # Queue<number>
```

См. [`Tests/testGenericTypes3.jn`](./Tests/testGenericTypes3.jn) и [`Tests/testGenericTypes4.jn`](./Tests/testGenericTypes4.jn).

## Utility types

```junoscript
import {
    Partial, Required, Readonly,
    Pick, Omit, KeyOf, Exclude
} from 'juno:types'
```

```junoscript
type User = {
    name: string
    age: number
    active: boolean
}

type PartialUser = Partial<User>
type RequiredUser = Required<PartialUser>
type ReadonlyUser = Readonly<User>
type NamedUser = Pick<User, 'name'>
type UserWithoutAge = Omit<User, 'age'>
type UserKey = KeyOf<User>
type NonAgeKey = Exclude<UserKey, 'age'>
```

### Indexed access и typeof

```junoscript
type UserName = User['name']
type UserValue = User[KeyOf<User>]

const box = { value: 7 }
type BoxType = typeof<box>
type ValueType = typeof<box['value']>
```

### Mapped/index signatures

```junoscript
type Keys = 'primary' | 'secondary'

type Values = {
    [key: Keys]: number
}
```

### Conditional types

```junoscript
type IsString<T> = T is string ? true : false
type Result = IsString<'Juno'>
```

Примеры: [`Tests/testGenericTypes.jn`](./Tests/testGenericTypes.jn), [`Tests/TestGenericTypes2.jn`](./Tests/TestGenericTypes2.jn), [`Tests/testGenericTypes3.jn`](./Tests/testGenericTypes3.jn), [`Tests/testGenericTypes4.jn`](./Tests/testGenericTypes4.jn).

## Iterable и коллекции

### Iterable

Объект `Iterable<T>` предоставляет `iterator()` или `toArray()`:

```junoscript
import { Iterable } from 'juno:types'

type Numbers = Iterable<number> & {
    toArray(): number[]
}

const numbers: Numbers = {
    toArray(): number[] =
        return [1, 2, 3]
}

for const value of numbers
    console.log(value)
```

`Iterable` добавляет `length`, `at`, `concat`, `every`, `filter`, `find`, `map`, `reduce`, `slice`, `some` и другие методы. См. [`Tests/testIterable.jn`](./Tests/testIterable.jn).

### Range

```junoscript
import { Range } from 'juno:types'

for const index of Range(5)
    console.log(index)
```

`Range` является `Iterable<number>`.

### Set и ValueSet

```junoscript
import { Set, ValueSet } from 'juno:types'

const numbers = Set(1, 2, 3)       # Set<number>
numbers.add(4)

const union = numbers.union(Set(3, 4, 5))
const intersection = numbers.intersection([2, 3, 10])
```

`ValueSet` сохраняет глубокие frozen snapshots и сравнивает структурные значения. См. [`Tests/testSet.jn`](./Tests/testSet.jn).

### Map и ValueMap

```junoscript
import { Map, ValueMap } from 'juno:types'

const map = Map(['one', 1], ['two', 2])
map.set('three', 3)

const value = map.get('two')
const exists = map.hasKey('one')
```

`ValueMap` использует структурное сравнение frozen snapshots ключей. См. [`Tests/testMap.jn`](./Tests/testMap.jn).

### Queue

```junoscript
import { Queue } from 'juno:types'

const queue = Queue(1, 2, 3)  # Queue<number>
const first = queue.pop()     # number | null
queue.push(4, 5)

const copy = queue.copy()
const values = queue.toArray()
```

Queue реализован поверх массива и наследует `Iterable<T>`. См. [`Tests/testQueue.jn`](./Tests/testQueue.jn).

## Обработка ошибок

JunoScript использует `Result<T, E>` и `try` expression:

```junoscript
import { Error, Result, ok } from 'juno:types'

const successful: Result<number> = ok(42)
const failed: Result<number, Error> = Error.result(Error('failed'))
```

```junoscript
const value: number | string = try successful
catch error: Error
    return error.message
finally
    finalized++
```

Try может содержать блок:

```junoscript
const result = try
    const value = 40
    return ok(value + 2)
catch error
    return 0
```

Тип catch binding выводится из `Result`, если не указан явно. См. [`Tests/testTryExpression.jn`](./Tests/testTryExpression.jn).

## Строки и RegEx

### Интерполяция и multiline strings

```junoscript
const name = 'Ada'
const greeting = 'Hello, ${name}!'

const message = `Hello, ${name}!
Welcome to JunoScript.`
```

Строки являются iterable и предоставляют TypeScript-подобный API:

```junoscript
for const char of 'Juno'
    console.log(char)

const upper = 'Juno'.toUpperCase()
```

### RegEx

```junoscript
const literal: RegEx = /<([a-z]+)>/i
const constructed: RegEx = RegEx('<([a-z]+)>', 'i')

console.log(literal.test('<tag>'))
```

См. [`Tests/testStrings.jn`](./Tests/testStrings.jn) и [`Tests/testRegEx.jn`](./Tests/testRegEx.jn).

## Модули и TypeScript

### Import и export

```junoscript
import { console } from 'juno'
import { Queue, Map } from 'juno:types'
import { helper } from './helper'
```

```junoscript
export const answer = 42

export fun greet(name: string): string =
    return 'Hello, ${name}'

export type Greeting = {
    text: string
}
```

Destructured export и re-export:

```junoscript
const source = { first: 'one', second: 2 }
export const { first, second } = source

export import { fromCharCode } from '../types/string.ts'
```

См. [`Tests/testExports.jn`](./Tests/testExports.jn) и [`Tests/testImportExports.jn`](./Tests/testImportExports.jn).

### TypeScript interop

Можно импортировать `.ts` и `.js`:

```junoscript
import {
    createProfile,
    scaleNumbers,
    applyMapper
} from './native-module.ts'

const profile = createProfile('Ada', [10, 20, 30])
const scaled = scaleNumbers(profile.scores, 2)
```

Type declarations экспортированных TypeScript-значений используются для hover и inference. Примеры: [`Tests/testJnTs`](./Tests/testJnTs).

## Стандартные модули

### `juno`

```junoscript
import { console, Math, Number, String, Boolean } from 'juno'
```

### `juno:node`

```junoscript
import { console } from 'juno:node'

const line = console.read()
const lines = console.readLines()
const args = console.args
```

### `juno:node:fs`

Файловые операции без суффикса возвращают `Promise`. Для синхронного вызова добавьте `Sync` к имени функции.

```junoscript
import { mkdirSync, writeFileSync, readFile } from 'juno:node:fs'

mkdirSync('data', true)
writeFileSync('data/example.txt', 'JunoScript')

fun loadExample(): string =
    return await readFile('data/example.txt')
```

`statSync` возвращает `FileStat`, а `stat` возвращает `Promise<FileStat>`. Поля `FileStat` включают `size`, `createdAt`, `modifiedAt`, `isFile`, `isDirectory` и `isSymbolicLink`.

### `juno:types`

```junoscript
import {
    Iterable, Range, Array, Tuple,
    Set, ValueSet, Map, ValueMap, Queue,
    Object, Random,
    Error, Result, ok,
    Partial, Required, Readonly,
    Pick, Omit, KeyOf, Exclude
} from 'juno:types'
```

### `juno:async`

```junoscript
import { Promise, TimerHandle, setTimeout, clearTimeout, fetch } from 'juno:async'

fun delayedValue(): number =
    return await Promise<number>((resolve) =>
        setTimeout(() => resolve(42), 10)
    )
```

Функцию не нужно помечать как `async`: наличие `await` определяется автоматически, а её внешний тип результата становится `Promise<T>`. Вложенные типы `Promise<Promise<T>>` нормализуются до `Promise<T>`. Модуль также экспортирует `setInterval`, `clearInterval`, `setImmediate`, `clearImmediate`, `queueMicrotask` и `fetch`, а его TypeScript-типы `TimerHandle`, `ImmediateHandle`, `AsyncCallback`, `FetchInput`, `FetchOptions` и `FetchResponse` доступны как обычные Juno-типы, включая runtime-проверки через `isType<T>()`.

`Promise` использует упрощённую модель Juno: конструктор получает один executor, executor получает только `resolve`, а `then` принимает только fulfilled-callback. Ошибки направляются в `catch` через Result-значение `{ ok: false, error }`:

```junoscript
const chain = Promise.resolve(2)
    .then(value => value + 3).
    then((value) => delayed(value * 2, 5)).
    then((value) => Promise.resolve({
        ok: false,
        error: `chain failed after ${value}`
    }))
    .catch((error) => 20)
    .then((value) => value + 1)
```

Цепочки методов допускают оба варианта переноса: точку в начале следующей строки (`\n    .then`) и точку в конце предыдущей (`.\n    then`). Отступ продолжения не создаёт отдельный блок.

Однострочный arrow callback является expression-body и не требует `return`: `value => value + 3` возвращает вычисленный результат. Для многострочного callback используется блок с явным `return`.

Одно выражение можно перенести на строку после `=>`; оно также остаётся expression-body с неявным возвратом:

```junoscript
chain.then((value) =>
    console.log('promise chain result:', value)
    )
```

Закрывающая скобка внешнего вызова может находиться как в конце строки выражения, так и на следующей строке с тем же отступом. Если indented body содержит statements (`return`, объявления, условия и другие операторы), он разбирается как обычный блок.

Такое преобразование ошибки работает для executor-функции `Promise`, `Promise.resolve` и `Promise.withResolvers().resolve`. Второй callback у `then` и второй параметр executor-функции запрещены. Полный пример с синхронными вызовами, цепочкой Promise и таймерами находится в [`Tests/testPromise.jn`](./Tests/testPromise.jn).

## VS Code

Расширение в [`vscode-junoscript`](./vscode-junoscript) предоставляет:

- syntax highlighting `.jn`;
- diagnostics;
- hover для значений, типов, функций, методов и generic inference;
- inlay hints для типов и имён параметров;
- completion для imports и индексного доступа;
- semantic highlighting методов.

Настройки:

- `junoscript.inlayHints.variableTypes.enabled`;
- `junoscript.inlayHints.parameterNames.enabled`.

Анализатор восстанавливается после нескольких синтаксических ошибок, поэтому hover и inference продолжают работать в остальных частях файла.

## Тестовые программы

| Файл | Содержание |
| --- | --- |
| [`test.jn`](./Tests/test.jn) | Общий smoke test синтаксиса и runtime |
| [`test1.jn`](./Tests/test1.jn) | Arrow functions, nullable, defaults, rest, loops, break, match |
| [`testTypeInference.jn`](./Tests/testTypeInference.jn) | Inference переменных, массивов и объектов |
| [`testTyping.jn`](./Tests/testTyping.jn) | Примитивы, conversions, unions, narrowing `any` |
| [`testArray.jn`](./Tests/testArray.jn) | Array, Range, Tuple, destructuring, readonly arrays |
| [`testObject.jn`](./Tests/testObject.jn) | Accessors, sealed, callable objects, helpers |
| [`testIterable.jn`](./Tests/testIterable.jn) | Iterable API и spread |
| [`testSet.jn`](./Tests/testSet.jn) | Set и ValueSet |
| [`testMap.jn`](./Tests/testMap.jn) | Map и ValueMap |
| [`testQueue.jn`](./Tests/testQueue.jn) | Queue и generic inference |
| [`testGenericTypes.jn`](./Tests/testGenericTypes.jn) | Базовые utility types |
| [`TestGenericTypes2.jn`](./Tests/TestGenericTypes2.jn) | Required, Readonly, generic aliases |
| [`testGenericTypes3.jn`](./Tests/testGenericTypes3.jn) | Constraints, defaults, KeyOf, typeof, indexed types |
| [`testGenericTypes4.jn`](./Tests/testGenericTypes4.jn) | Conditional types, Tuple, readonly/mutable copies |
| [`testTryExpression.jn`](./Tests/testTryExpression.jn) | Result, try, catch, finally |
| [`testAsync.jn`](./Tests/testAsync.jn) | await, Promise, implicit async functions, timers и microtasks |
| [`testPromise.jn`](./Tests/testPromise.jn) | Многоступенчатые resolve/then/catch, setTimeout и порядок sync/async вызовов |
| [`testStrings.jn`](./Tests/testStrings.jn) | Строки, interpolation и string API |
| [`testRegEx.jn`](./Tests/testRegEx.jn) | RegEx literals и constructor |
| [`testImportExports.jn`](./Tests/testImportExports.jn) | Imports, exports, re-exports |
| [`testJnTs`](./Tests/testJnTs) | JunoScript/TypeScript interop |
| [`testBuild`](./Tests/testBuild) | `junode --build`, generated JS/TS и межмодульный interop |

Запуск отдельного примера:

```sh
npm start -- Tests/testObject.jn
```

Некоторые тесты содержат закомментированные негативные проверки. Их можно раскомментировать по одной, чтобы увидеть соответствующие diagnostics или runtime errors.
