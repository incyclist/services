import JSONFileBindig from './json'

describe ('JSONFileBindig',()=>{

    describe('set',()=>{

        describe('JSONFileBindig', () => {
            describe('set', () => {

                let json:JSONFileBindig

                beforeEach( ()=>{
                    json = new JSONFileBindig()
                    json.settings = {}
                    json.save = jest.fn()
                })

                test('object', () => {

                    const input = { key: 'value' };
                    json.set('test', input);
                    expect(json.settings.test).toEqual(input);
                });

                test('number', () => {
                    const input = 42;
                    json.set('test', input);
                    expect(json.settings.test).toEqual(input);
                });

                test('string', () => {
                    const input = 'test string';
                    json.set('test', input);
                    expect(json.settings.test).toEqual(input);
                });

                test('null', () => {
                    
                    json.set('test', null);
                    expect(json.settings.test).toBeUndefined()

                    json.settings = { test:'123'}
                    json.set('test', null);
                    expect(json.settings.test).toBeUndefined()

                });

                test('undefined', () => {
                    const input = undefined;
                    json.set('test', input);
                    expect(json.settings.test).toEqual(input);
                });

                test('boolean true', () => {
                    const input = true;
                    json.set('test', input);
                    expect(json.settings.test).toEqual(input);
                });

                test('boolean false', () => {
                    const input = false;
                    json.set('test', input);
                    expect(json.settings.test).toEqual(input);
                });

                test('array', () => {
                    const input = [1, 2, 3];
                    json.set('test', input);
                    expect(json.settings.test).toEqual(input);
                });

                test('empty object', () => {
                    const input = {};
                    json.set('test', input);
                    expect(json.settings.test).toEqual(input);
                });

                test('empty array', () => {
                    const input:any = [];
                    json.set('test', input);
                    expect(json.settings.test).toEqual(input);
                });
            });
        });
    })
    

})