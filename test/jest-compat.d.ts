import type { Mock, MockInstance } from 'vitest'

declare global {
    const jest: typeof import('vitest').vi

    namespace jest {
        type Mock<T = any, Y extends any[] = any> = Mock<(...args: Y) => T>
        type Mocked<T> = {
            [K in keyof T]: T[K] extends (...args: infer A) => infer R ? Mock<(...args: A) => R> & T[K] : T[K]
        } & T
        type SpyInstance<T = any, Y extends any[] = any> = MockInstance<(...args: Y) => T>
    }
}

export {}
