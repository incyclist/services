module.exports = {
    roots: ['<rootDir>/src'],
    transform: {
      '^.+\\.tsx?$': 'ts-jest',
    },
    testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.(ts|js)?$',
    moduleFileExtensions: ['ts', 'js', 'json', 'node'],
    collectCoverageFrom: [
      "src/**/*.{js,ts}",
      "!src/**/*.d.ts",
      "!src/**/index.ts",
      "!src/Device.ts",
      "!src/**/*.unit.{test,tests}.{js,ts}",
      "!src/**/*.test.util.{js,ts}"
    ]
  }
  