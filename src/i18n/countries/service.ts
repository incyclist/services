import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { CountryList, CountryOverpassResult } from "./model";
import defaultList from './countries.json'
import { LatLng } from "../../utils/geo";
import { useOverpassApi } from "../../services";
import { Injectable } from "../../base/decorators";

/**
 * Service for managing country information and resolving geographic coordinates to country ISO codes.
 *
 * Provides functionality to:
 * - Get country names from ISO codes
 * - Get ISO codes from country names
 * - Resolve geographic coordinates to country ISO codes using the Overpass API
 *
 * Supports multiple languages and maintains a cache of country lists by locale.
 */
@Singleton
export class Countries extends IncyclistService {

    protected language:string
    protected countryLists:{ [index:string]:CountryList  }

    /**
     * Creates a new Countries service instance.
     *
     * As a Singleton, only one instance will be created even if the constructor is called multiple times.
     * The default English country list is loaded automatically.
     */
    constructor() {
        super('Countries')
        this.language=defaultList.locale
        this.countryLists = {}
        this.countryLists[this.language] = defaultList;
    }

    /**
     * Get the country list for the specified locale.
     *
     * Falls back to English ('en') if the requested locale is not available.
     *
     * @param locale - The locale/language code. Defaults to the service's current language
     * @returns The country list for the locale, or English as fallback
     */
    protected getList(locale:string=this.language): CountryList {
        return this.countryLists[locale]||this.countryLists.en
    }

    /**
     * Get the country name from an ISO 3166-1 alpha-2 code.
     *
     * @param iso - The ISO 3166-1 alpha-2 country code (case-insensitive)
     * @param locale - Optional locale for the country name. Defaults to the service's current language
     * @returns The country name in the specified locale, or undefined if the ISO code is not found
     * @example
     * const countryName = countries.getCountryFromIso('DE'); // 'Germany'
     * const countryName = countries.getCountryFromIso('us'); // 'United States'
     */
    getCountryFromIso(iso:string, locale?:string):string {
        const list = this.getList(locale)
        const info = list.countries[iso.toUpperCase()]
        return Array.isArray(info) ? info[0] : info
    }

    /**
     * Get country names for multiple ISO codes.
     *
     * @param iso - Array of ISO 3166-1 alpha-2 country codes
     * @param locale - Optional locale for the country names. Defaults to the service's current language
     * @returns Array of country names in the same order as the input ISO codes
     * @example
     * const names = countries.getCountiesFromIsos(['DE', 'FR', 'IT']); // ['Germany', 'France', 'Italy']
     */
    getCountiesFromIsos(iso:Array<string>, locale?:string):Array<string> {
        return iso.map( i=>this.getCountryFromIso(i,locale))
    }

    /**
     * Get the ISO 3166-1 alpha-2 code from a country name.
     *
     * Performs a case-sensitive search through the country list. If a country has multiple aliases,
     * any matching alias will return the ISO code.
     *
     * @param country - The country name to search for
     * @param locale - Optional locale for the country list. Defaults to the service's current language
     * @returns The ISO 3166-1 alpha-2 code, or undefined if the country name is not found
     * @example
     * const iso = countries.getIsoFromCountry('Germany'); // 'DE'
     * const iso = countries.getIsoFromCountry('United States'); // 'US'
     */
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

    /**
     * Get ISO codes for multiple country names.
     *
     * @param countries - Array of country names
     * @param locale - Optional locale for the country list. Defaults to the service's current language
     * @returns Array of ISO 3166-1 alpha-2 codes in the same order as the input countries.
     *          Returns undefined for country names that are not found
     * @example
     * const isos = countries.getIsosFromCountries(['Germany', 'France', 'Italy']); // ['DE', 'FR', 'IT']
     */
    getIsosFromCountries(countries:Array<string>, locale?:string):Array<string> {
        return countries.map( c=>this.getIsoFromCountry(c,locale))
    }

    /**
     * Resolve geographic coordinates to a country ISO code using the Overpass API.
     *
     * Queries the Overpass API to find administrative boundaries at the given latitude/longitude,
     * then extracts the ISO 3166-1 alpha-2 country code from the results. When multiple countries
     * are found at the given location, returns the one that matches the service's country list.
     *
     * @param point - Geographic point with latitude and longitude
     * @returns Promise resolving to the ISO 3166-1 alpha-2 country code, or undefined if:
     *          - The API query fails or times out
     *          - No administrative boundary is found at the coordinates
     *          - The returned boundaries lack an ISO3166-1:alpha2 tag
     * @throws No direct exceptions; errors from the Overpass API are caught and return undefined
     * @example
     * const iso = await countries.getIsoFromLatLng({ lat: 48.8566, lng: 2.3522 }); // 'FR' (Paris)
     * const iso = await countries.getIsoFromLatLng({ lat: 51.5074, lng: -0.1278 }); // 'GB' (London)
     */
    async getIsoFromLatLng(point: LatLng): Promise<string> {
        const { lat, lng } = point;
        const query = `[out:json][timeout:10];is_in(${lat},${lng})->.a;rel(pivot.a)['admin_level'='2']['boundary'='administrative'];out tags;`;

        try {
            const result = await this.getOverpassApi().query(query) as unknown as CountryOverpassResult;
            if (!result?.elements)
                return undefined;

            const isos = result.elements
                .map(el => el.tags['ISO3166-1:alpha2'])
                .filter((iso): iso is string => !!iso)
                .map(iso => iso.toUpperCase());

            if (isos.length < 2)
                return isos[0];
            return isos.find(iso => this.getList().countries[iso] !== undefined);
        }
        catch {
            return undefined;
        }
    }

    /**
     * Get the Overpass API instance for querying geographic boundaries.
     *
     * Uses the @Injectable decorator to allow dependency injection for testing.
     * In production, returns the default Overpass API client.
     *
     * @returns The Overpass API client instance
     * @internal Used internally for geographic coordinate resolution. Can be mocked during testing.
     */
    @Injectable
    protected getOverpassApi() {
        return useOverpassApi()
    }

}

/**
 * Factory function to get or create the Countries service instance.
 *
 * @returns The singleton Countries service instance
 * @example
 * const countries = getCountries();
 * const germanName = countries.getCountryFromIso('DE');
 */
export const getCountries = ()=> new Countries()