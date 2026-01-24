
import {UnitType} from './types'
import {UnitConverterService} from './converter'
import { Inject } from '../../base/decorators'


const MockUserSettings = (units: UnitType = 'metric')  => {
    
    return {

        getValue: (key:string, defValue:any) => {
            if (key==='preferences.units') return units
            return defValue
        }

    }
}


describe('UnitConverterService',()=> {

    const setupMocks = ( units?: UnitType)=> {
        Inject( 'UserSettings', MockUserSettings(units))
    }

    const cleanupMocks = ()=> {
        Inject( 'UserSettings', null)
    }

    let svc: UnitConverterService
    beforeEach( ()=>{
        svc = new UnitConverterService()
        setupMocks()
    })

    afterEach( ()=> {
        cleanupMocks()
    })

    test('distance to imperial',()=> {
        setupMocks('imperial')
        expect( svc.convert(1000,'distance',{digits:3} )).toBe(0.621)
        expect( svc.convert(1,'distance',{from:'km',digits:3} )).toBe(0.621)
        expect( svc.convert(1000,'distance',{to:'km'} )).toBe(1)
        expect( svc.convert(1000,'distance',{to:'yd',digits:0} )).toBe(1094)
        expect( svc.convert(10,'distance',{from:'mi'} )).toBe(10)
        expect( svc.convert(1000,'distance',{from:'yd',digits:3} )).toBe(0.568)
        expect( svc.convert(1,'distance',{to:'ft',digits:2} )).toBe(3.28)
    })

    test('weight to imperial',()=> {
        setupMocks('imperial')
        expect( svc.convert(75,'weight',{digits:1} )).toBe(165.3)
    })
    
})