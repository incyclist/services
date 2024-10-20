export type CountryDefinition = string|Array<string>

export type CountryList = {
    locale:string,
    countries: { [index:string]:CountryDefinition  }
}

export type CountryOverpassElement = { 
    type: string
    id: number,
    tags: { [index:string]:string}
}


export type CountryOverpassResult = {
    version,
    elements:Array<CountryOverpassElement>
}