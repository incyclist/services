module.exports = {
    roots: ['<rootDir>/src'],
    transform: {
      '^.+\\.tsx?$': 'ts-jest',
    },
    // transformIgnorePatterns: [
    //     "/node_modules/(?!uuid)" 
    // ],
    moduleNameMapper: {
        // Force Jest to use the CommonJS version of uuid
        //'^uuid$': require.resolve('uuid'),
        '^uuid$': '<rootDir>/test/uuid.ts',
    },
    globalSetup: './jest-setup.js',
    testRegex: '^.+(\\.)?(test|spec)\\.(ts|js)?$',
    moduleFileExtensions: ['ts', 'js', 'json', 'node'],
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
  