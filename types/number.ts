const {
    EPSILON,
    MAX_SAFE_INTEGER,
    MAX_VALUE,
    MIN_SAFE_INTEGER,
    MIN_VALUE,
    NEGATIVE_INFINITY,
    POSITIVE_INFINITY,
    NaN,
    isFinite,
    isInteger,
    isNaN,
    isSafeInteger,
    parseFloat,
    parseInt
} = globalThis.Number

const NumberConstructor = Object.assign(
    (value ?: any) : number => {
        if (value == null) {
            return NaN;
        }
        if (value && typeof value === 'object') {
            if ('valueOf' in value && typeof value.valueOf === 'function') {
                const _valueOf = value.valueOf()

                return globalThis.Number(_valueOf)
            }
            return NaN;
        }

        return globalThis.Number(value)
    },
    {
        EPSILON,
        MAX_SAFE_INTEGER,
        MAX_VALUE,
        MIN_SAFE_INTEGER,
        MIN_VALUE,
        NEGATIVE_INFINITY,
        POSITIVE_INFINITY,
        NaN,
        isFinite,
        isInteger,
        isNaN,
        isSafeInteger,
        parseFloat,
        parseInt
    }
)

export const Number = NumberConstructor;