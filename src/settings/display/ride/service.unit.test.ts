import { RideSettingsDisplayService } from './service'
import { AvailabilityResult } from '../../../api/mapAvailability/types'

describe('RideSettingsDisplayService', () => {

    let service: RideSettingsDisplayService

    const setup = (props: { rideView?: string, mapAvailability?: { isAvailable: (key: string) => AvailabilityResult | undefined } | undefined, isMobile?: boolean } = {}) => {
        service = new RideSettingsDisplayService()
        ;(service as any).getUserSettings = jest.fn().mockReturnValue({
            get: jest.fn().mockReturnValue(props.rideView ?? 'sv'),
            set: jest.fn()
        })
        ;(service as any).getBindings = jest.fn().mockReturnValue({
            mapAvailability: props.mapAvailability,
            appInfo: { getChannel: () => (props.isMobile ? 'mobile' : 'desktop') }
        })
    }

    describe('getRideViewOptions', () => {

        test('binding absent (non-mobile / not yet implemented): all keys included, none disabled', () => {
            setup({ mapAvailability: undefined })

            const res = service.getRideViewOptions()

            expect(res.get('sv')).toEqual({ label: 'Street View' })
            expect(res.get('map')).toEqual({ label: 'Map' })
            expect(res.get('sat')).toEqual({ label: 'Satellite View' })
        })

        test('map is always present and never disabled, regardless of availability', () => {
            setup({
                mapAvailability: { isAvailable: () => ({ status: 'unavailable', messageKey: 'x' }) }
            })

            const res = service.getRideViewOptions()

            expect(res.get('map')).toEqual({ label: 'Map' })
        })

        test('status "available": key included, not disabled', () => {
            setup({
                mapAvailability: { isAvailable: () => ({ status: 'available' }) }
            })

            const res = service.getRideViewOptions()

            expect(res.get('sv')).toEqual({ label: 'Street View' })
            expect(res.get('sat')).toEqual({ label: 'Satellite View' })
        })

        test('status "unavailable": key included, disabled, messageKey passed through', () => {
            setup({
                mapAvailability: { isAvailable: () => ({ status: 'unavailable', messageKey: 'need.playservices' }) }
            })

            const res = service.getRideViewOptions()

            expect(res.get('sv')).toEqual({ label: 'Street View', disabled: true, messageKey: 'need.playservices' })
            expect(res.get('sat')).toEqual({ label: 'Satellite View', disabled: true, messageKey: 'need.playservices' })
        })

        test('status "not-supported": key omitted entirely', () => {
            setup({
                mapAvailability: { isAvailable: () => ({ status: 'not-supported' }) }
            })

            const res = service.getRideViewOptions()

            expect(res.has('sv')).toBe(false)
            expect(res.has('sat')).toBe(false)
            expect(res.get('map')).toEqual({ label: 'Map' })
        })

        test('mixed results per key', () => {
            setup({
                mapAvailability: {
                    isAvailable: (key: string) => {
                        if (key === 'sv') return { status: 'available' }
                        if (key === 'sat') return { status: 'not-supported' }
                        return undefined
                    }
                }
            })

            const res = service.getRideViewOptions()

            expect(res.get('sv')).toEqual({ label: 'Street View' })
            expect(res.has('sat')).toBe(false)
            expect(res.get('map')).toEqual({ label: 'Map' })
        })

        test('non-mobile: binding is always undefined, behavior unchanged (all included, none disabled)', () => {
            setup({ mapAvailability: undefined, isMobile: false })

            const res = service.getRideViewOptions()

            expect(res.get('sv')).toEqual({ label: 'Street View' })
            expect(res.get('map')).toEqual({ label: 'Map' })
            expect(res.get('sat')).toEqual({ label: 'Satellite View' })
        })
    })

    describe('getRideView', () => {

        test('binding absent: returns the stored value unchanged', () => {
            setup({ rideView: 'sat', mapAvailability: undefined })
            expect(service.getRideView()).toBe('sat')
        })

        test('status "available": returns the stored value unchanged', () => {
            setup({ rideView: 'sat', mapAvailability: { isAvailable: () => ({ status: 'available' }) } })
            expect(service.getRideView()).toBe('sat')
        })

        test('status "unavailable": falls back to "map"', () => {
            setup({ rideView: 'sat', mapAvailability: { isAvailable: () => ({ status: 'unavailable', messageKey: 'x' }) } })
            expect(service.getRideView()).toBe('map')
        })

        test('status "not-supported": falls back to "map"', () => {
            setup({ rideView: 'sv', mapAvailability: { isAvailable: () => ({ status: 'not-supported' }) } })
            expect(service.getRideView()).toBe('map')
        })

        test('non-mobile: binding always undefined, behavior unchanged', () => {
            setup({ rideView: 'sat', mapAvailability: undefined, isMobile: false })
            expect(service.getRideView()).toBe('sat')
        })
    })

    describe('setRideView', () => {
        test('always sets the value, no restriction guard', () => {
            setup({})
            const setSpy = (service as any).getUserSettings().set

            service.setRideView('sat')

            expect(setSpy).toHaveBeenCalledWith('preferences.rideView', 'sat')
        })
    })

})
