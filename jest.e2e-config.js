// eslint-disable-next-line @typescript-eslint/no-var-requires
let config = require('./jest.config')
config.testRegex = '^[^\\.]+(\\.)?(e2e)\\.(test|spec)\\.(ts|js)?$'

console.log('RUNNING E2E TESTS')
module.exports = config