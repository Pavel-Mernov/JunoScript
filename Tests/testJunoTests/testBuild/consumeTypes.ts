import {
    answer,
    greet,
    Counter
} from './.generated/basic'

const numericAnswer: number = answer
const greeting: string = greet('TypeScript')
const counter = Counter(1)
const next: number = counter.increment(2)
const zero: number = Counter.zero().value

export {
    numericAnswer,
    greeting,
    next,
    zero
}
