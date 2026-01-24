import { Injectable, Singleton } from "../../base/decorators";
import { IncyclistService } from "../../base/service";
import { useUserSettings } from "../../settings/service/service";
import { UnitConversionRules, ConvertProps, Unit, Dimension, UnitType } from "./types";

@Singleton
export class UnitConverterService extends IncyclistService{

    constructor() {
        super('UnitConverter')
    }

    protected readonly metric: Record<Dimension,Unit> = {
        distance: 'km',
        elevation: 'm',
        speed: 'km/h',
        weight: 'kg'
    }
    protected readonly imperial: Record<Dimension,Unit> = {
        distance: 'mi',
        elevation: 'ft',
        speed: 'mph',
        weight: 'lbs'
    }

    protected readonly appDefault = this.metric

    protected readonly formulas:UnitConversionRules = {

        distance: {
            unit: 'm',     
            formulas: {      
                'km': 1/1000,
                'mi': 1/1609.344,
                'yd': 1.0936132983,
                'ft': 3.280839895
            }
        },
        elevation: {
            unit: 'm',
            formulas: {
                'km': 1/1000,
                'mi': 1/1609.344,
                'yd': 1.0936132983,
                'ft': 3.280839895
            }
        },
        speed: {
            unit: 'km/h',
            formulas: {
                'mph': 0.621371,
                'm/s': 1/3.6
            }
        },
        weight: {
            unit: 'kg',
            formulas: {
                'lbs': 2.20462,
            }

        }


    }



    convert( value:number, dimension:Dimension, props?:ConvertProps ): number {

        if (value===undefined || value===null || Number.isNaN(value)) 
            return undefined

        try {
            const units = this.getUnits() === 'metric' ? this.metric : this.imperial
            const from = props?.from??this.formulas[dimension].unit
            const to   = props?.to??units[dimension]

            const round = (val:number, digits:number) => {
                const factor = Math.pow(10,digits)
                return  Math.round( val * factor  ) / factor 
            }


            if (from===to) {
                return props?.digits===undefined ? value : round(value,props.digits)
            }

            let res = value
            if (from!==this.formulas[dimension].unit ) {
                const factor = this.formulas[dimension].formulas[from]
                res = res/factor
            }
            if (to!==this.formulas[dimension].unit) {
                const factor = this.formulas[dimension].formulas[to]
                res = res*factor
            }

            return props?.digits===undefined ? res : round(res,props.digits)        

        }
        catch(err) {
            const p = props??{}
            this.logError( err,'convert', {convertArgs: {value, dimension, ...p}})
            return value
        }
    }

    getUnit(dimension:Dimension) {
        try {
            const units = this.getUnits() === 'metric' ? this.metric : this.imperial
            return units[dimension]
        }
        catch(err) {
            this.logError(err,'getUnit')
            return
        }

    }

    getUnits():UnitType {
        const type = this.getUserSettings().getValue('preferences.units','metric') as UnitType
        return type
    }

    getUnitConversionShortcuts = ()=> {
        const C = this.convert.bind(this)
        const U = this.getUnit.bind(this)
        return [C,U]
    }    

    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

}

export const useUnitConverter = ()=> new UnitConverterService()


export const getUnitConversionShortcuts = ()=> {
    const c = useUnitConverter()
    const C = useUnitConverter().convert.bind(c)
    const U = useUnitConverter().getUnit.bind(c)
    return [C,U]
}
