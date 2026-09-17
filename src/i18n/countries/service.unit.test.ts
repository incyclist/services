import { Inject } from '../../base/decorators'
import { Countries } from './service'
import { CountryOverpassResult } from './model'

const makeResult = (isos: (string | undefined)[]): CountryOverpassResult => ({
    version: 1,
    elements: isos.map((iso, i) => ({
        type: 'relation' as const,
        id: i,
        tags: iso ? { 'ISO3166-1:alpha2': iso } : {},
    })),
})

describe('Countries', () => {
    let service: Countries

    afterEach(() => {
        if (service) {
            service.reset()
        }
    })

    describe('getCountryFromIso', () => {
        beforeEach(() => {
            service = new Countries()
        })

        test('returns country name for valid ISO code', () => {
            const result = service.getCountryFromIso('DE')
            expect(result).toBe('Germany')
        })

        test('handles lowercase ISO codes', () => {
            const result = service.getCountryFromIso('de')
            expect(result).toBe('Germany')
        })

        test('handles mixed case ISO codes', () => {
            const result = service.getCountryFromIso('Us')
            expect(result).toBe('United States of America')
        })

        test('returns undefined for invalid ISO code', () => {
            const result = service.getCountryFromIso('XX')
            expect(result).toBeUndefined()
        })

        test('uses default language when locale not specified', () => {
            const result = service.getCountryFromIso('FR')
            expect(result).toBeDefined()
            expect(typeof result).toBe('string')
        })
    })

    describe('getCountiesFromIsos', () => {
        beforeEach(() => {
            service = new Countries()
        })

        test('returns country names for multiple ISO codes', () => {
            const result = service.getCountiesFromIsos(['DE', 'FR', 'IT'])
            expect(result).toEqual(['Germany', 'France', 'Italy'])
        })

        test('handles empty array', () => {
            const result = service.getCountiesFromIsos([])
            expect(result).toEqual([])
        })

        test('handles mixed valid and invalid ISO codes', () => {
            const result = service.getCountiesFromIsos(['DE', 'XX', 'FR'])
            expect(result).toHaveLength(3)
            expect(result[0]).toBe('Germany')
            expect(result[1]).toBeUndefined()
            expect(result[2]).toBe('France')
        })

        test('preserves order of input ISO codes', () => {
            const result = service.getCountiesFromIsos(['US', 'DE', 'FR'])
            expect(result[0]).toBe('United States of America')
            expect(result[1]).toBe('Germany')
            expect(result[2]).toBe('France')
        })
    })

    describe('getIsoFromCountry', () => {
        beforeEach(() => {
            service = new Countries()
        })

        test('returns ISO code for valid country name', () => {
            const result = service.getIsoFromCountry('Germany')
            expect(result).toBe('DE')
        })

        test('returns ISO code for United States', () => {
            const result = service.getIsoFromCountry('United States')
            expect(result).toBe('US')
        })

        test('returns undefined for invalid country name', () => {
            const result = service.getIsoFromCountry('Atlantis')
            expect(result).toBeUndefined()
        })

        test('is case-sensitive', () => {
            const result = service.getIsoFromCountry('germany')
            expect(result).toBeUndefined()
        })

        test('finds country by exact name', () => {
            const result = service.getIsoFromCountry('France')
            expect(result).toBe('FR')
        })
    })

    describe('getIsosFromCountries', () => {
        beforeEach(() => {
            service = new Countries()
        })

        test('returns ISO codes for multiple country names', () => {
            const result = service.getIsosFromCountries(['Germany', 'France', 'Italy'])
            expect(result).toEqual(['DE', 'FR', 'IT'])
        })

        test('handles empty array', () => {
            const result = service.getIsosFromCountries([])
            expect(result).toEqual([])
        })

        test('handles mixed valid and invalid country names', () => {
            const result = service.getIsosFromCountries(['Germany', 'Atlantis', 'France'])
            expect(result).toHaveLength(3)
            expect(result[0]).toBe('DE')
            expect(result[1]).toBeUndefined()
            expect(result[2]).toBe('FR')
        })

        test('preserves order of input country names', () => {
            const result = service.getIsosFromCountries(['United States', 'Germany', 'France'])
            expect(result[0]).toBe('US')
            expect(result[1]).toBe('DE')
            expect(result[2]).toBe('FR')
        })
    })

})
