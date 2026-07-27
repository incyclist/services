module.exports = {
    roots: ['<rootDir>/src'],
    transform: {
      // tsconfig.jest.json sets isolatedModules: true, so ts-jest transpiles each file
      // independently (ts.transpileModule) instead of building a full TS Program/LanguageService
      // per worker - much lower memory, at the cost of not catching type errors here. That's
      // fine: `tsc --noEmit` against the real tsconfig.json already runs separately as the
      // type-checking step, so re-type-checking during test runs is redundant. A dedicated
      // tsconfig (rather than setting isolatedModules on the main tsconfig.json) keeps this
      // test-only setting from affecting the real esm/cjs production builds.
      '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }],
      '^.+\\.js$': ['ts-jest', { diagnostics: false, tsconfig: 'tsconfig.jest.json' }],
    },
    transformIgnorePatterns: [
        '/node_modules/(?!@garmin/fitsdk)',
    ],
    moduleNameMapper: {
        // Force Jest to use the CommonJS version of uuid
        //'^uuid$': require.resolve('uuid'),
        '^uuid$': '<rootDir>/test/uuid.ts',
    },
    globalSetup: './jest-setup.js',
    testRegex: '^.+(\\.)?(test|spec)\\.(ts|js)?$',
    moduleFileExtensions: ['ts', 'js', 'json', 'node'],
    // Caps peak memory on multi-core machines: each worker loads its own ts-jest transform
    // state and coverage instrumentation, so worker count directly multiplies memory use.
    maxWorkers: '50%',
    // Recycles a worker if it grows past this - bounds memory growth over a long test run
    // regardless of maxWorkers.
    workerIdleMemoryLimit: '512MB',
    collectCoverageFrom: [
      "src/**/*.{js,ts}",
      "!src/**/*.d.ts",
      "!src/**/index.ts",
      "!src/**/model.ts",
      "!src/**/types.ts",
      "!src/**/mock.ts",
      "!src/Device.ts",
      "!src/**/*.e2e.{test,tests}.{js,ts}",
      "!src/**/*.integ.{test,tests}.{js,ts}",
      "!src/**/*.unit.{test,tests}.{js,ts}",
      "!src/**/*.test.util.{js,ts}"
    ]
  }
  