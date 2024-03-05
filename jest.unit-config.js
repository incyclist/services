// eslint-disable-next-line @typescript-eslint/no-var-requires
var config = require('./jest.config')
config.testRegex = '^[^\\.]+(\\.)?(unit)\\.(test|spec)\\.(ts|js)?$',

console.log('RUNNING UNIT TESTS')
module.exports = config