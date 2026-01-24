import {UserSettingsService} from './service'

describe('UserSettingsService',()=>{

    let us:any;

    describe('get',()=>{
        beforeEach( ()=>{
            us = new UserSettingsService()
            us.isInitialized = true;
        })

        test('key not found, with default value',()=>{
            let res;
            us.settings={ a:1, b:'2'}

            res = us.get('c',true)
            expect(res).toBe(true)
            
            res = us.get('c',false)
            expect(res).toBe(false)
            
            res = us.get('c',{})
            expect(res).toEqual({})

            res = us.get('c',4)
            expect(res).toBe(4)
        })

        test('key not found, with default=null',()=>{
            us.settings={ a:1, b:'2'}

            const res = us.get('c',null)
            expect(res).toBeNull()
        })

        test('key not found, with default=undefined',()=>{
            us.settings={ a:1, b:'2'}

            const res = us.get('c',null)
            expect(res).toBeNull()
        })
        
        

    })
})