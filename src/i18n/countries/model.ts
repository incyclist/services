export type CountryDefinition = string|Array<string>

export type CountryList = {
    locale:string,
    countries: { [index:string]:CountryDefinition  }
}

export type CountryOverpassElement = {
    type: 'relation';
    id: number;
    tags: {
        'ISO3166-1:alpha2'?: string;
        'boundary'?: string;
        'admin_level'?: string;
        [key: string]: string | undefined;
    }
}

export type CountryOverpassResult = {
    version: number;
    elements: Array<CountryOverpassElement>;
}