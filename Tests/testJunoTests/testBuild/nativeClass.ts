export class NativeAccumulator {
    value: number

    constructor(value: number) {
        this.value = value
    }

    add(amount: number): number {
        this.value += amount
        return this.value
    }

    static zero(): NativeAccumulator {
        return new NativeAccumulator(0)
    }
}
