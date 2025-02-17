import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { CountryList, CountryOverpassResult } from "./model";
import defaultList from './countries.json'
import { LatLng } from "../../utils/geo";
import { useOverpassApi } from "../../api";

@Singleton 
export class Countries extends IncyclistService {

    protected language:string
    protected countryLists:{ [index:string]:CountryList  }

    constructor() {
        super('Countries')
        this.language=defaultList.locale
        this.countryLists = {}
        this.countryLists[this.language] = defaultList;
    }

    protected getList(locale:string=this.language): CountryList {
        return this.countryLists[locale]||this.countryLists.en
    }

    getCountryFromIso(iso:string, locale?:string):string {
        const list = this.getList(locale)
        const info = list.countries[iso.toUpperCase()]
        return Array.isArray(info) ? info[0] : info
    }

    getCountiesFromIsos(iso:Array<string>, locale?:string):Array<string> {
        return iso.map( i=>this.getCountryFromIso(i,locale))
    }

    getIsoFromCountry(country:string, locale?:string):string {
        const list = this.getList(locale)

        const isos = Object.keys(list.countries)
        const iso = isos.find( i=> {
            const c = list.countries[i]
            if (Array.isArray(c))
                return c.includes(country)
            return c===country
        } )
        return iso
    }

    getIsosFromCountries(countries:Array<string>, locale?:string):Array<string> {
        return countries.map( c=>this.getIsoFromCountry(c,locale))
    }

    async getIsoFromLatLng(point:LatLng):Promise<string> {
        const {lat,lng}=point
        const query = `[out:json][timeout:25];way['addr:country'](around:20000,${lat},${lng});out tags;`
        
        try {
            const result = await useOverpassApi().query(query) as unknown as CountryOverpassResult
            if (!result?.elements)
                return;

            const isos = []
            result.elements?.forEach( el=> {
                const iso = el.tags['addr:country']
                if (!iso)
                    return;

                if (!isos.includes(iso.toUpperCase())) {
                    isos.push(iso.toUpperCase())
                }
            })

            if (isos.length<2)
                return isos[0]
            return isos.find( iso=> this.getList().countries[iso]!==undefined)
        }
        catch {
            return undefined
        }
    

    }
}

export const getCountries = ()=> new Countries()