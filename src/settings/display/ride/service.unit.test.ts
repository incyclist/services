import { Inject } from '../../../base/decorators'
import { RideSettingsDisplayService } from './service'
import { AvailabilityResult } from '../../../api/mapAvailability/types'

describe('RideSettingsDisplayService', () => {

    let service: RideSettingsDisplayService

    const setup = (props: { rideView?: string, mapAvailability?: { isAvailable: (key: string) => AvailabilityResult | undefined } | undefined, isMobile?: boolean } = {}) => {
        service = new RideSettingsDisplayService()
        ;(service as any).getUserSettings = jest.fn().mockReturnValue({
            get: jest.fn().mockReturnValue(props.rideView ?? 'sv'),
            getValue: jest.fn().mockReturnValue(false),
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
                mapAvailability: { isAvailable: () => ({ status: 'unavailable', messageKey: 'need.playservices' }) }
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

        test('status "unavailable": key included, disabled, messageKey resolved to display text', () => {
            setup({
                mapAvailability: { isAvailable: () => ({ status: 'unavailable', messageKey: 'need.playservices' }) }
            })

            const res = service.getRideViewOptions()

            expect(res.get('sv')).toEqual({ label: 'Street View', disabled: true, message: 'Install Google Play Services to use this view' })
            expect(res.get('sat')).toEqual({ label: 'Satellite View', disabled: true, message: 'Install Google Play Services to use this view' })
        })

        test('status "unavailable" with an unrecognized messageKey: falls back to a generic message', () => {
            setup({
                mapAvailability: { isAvailable: () => ({ status: 'unavailable', messageKey: 'some.unknown.key' }) }
            })

            const res = service.getRideViewOptions()

            expect(res.get('sv')?.message).toBe('This view is currently unavailable on your device')
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

    describe('ride view restriction', () => {

        const restrictionMock = { getActiveRestriction: jest.fn() }

        const restrict = (preferredView: 'sv' | 'sat' | 'map' = 'sv') => {
            restrictionMock.getActiveRestriction.mockReturnValue({ cause: 'simulation', preferredView })
        }

        beforeEach(() => {
            Inject('RideViewRestriction', restrictionMock)
        })

        afterEach(() => {
            Inject('RideViewRestriction', null)
            restrictionMock.getActiveRestriction.mockReset()
        })

        test('no restriction: all options enabled, no help', () => {
            setup({})
            const props = service.getDisplayProps()

            expect(props.rideViewOptions.get('sv')).toEqual({ label: 'Street View' })
            expect(props.rideViewOptions.get('sat')).toEqual({ label: 'Satellite View' })
            expect(props.rideViewHelp).toBeUndefined()
            expect(props.rideView).toBe('sv')
        })

        test('restricted: street view and satellite view are disabled with the reason, map stays enabled', () => {
            setup({})
            restrict()

            const res = service.getRideViewOptions()

            const expected = { disabled: true, message: 'Not available in simulated rides', reason: 'simulation' }
            expect(res.get('sv')).toEqual({ label: 'Street View', ...expected })
            expect(res.get('sat')).toEqual({ label: 'Satellite View', ...expected })
            expect(res.get('map')).toEqual({ label: 'Map' })
        })

        test('restricted: map is reported as the selected view and help is offered', () => {
            setup({ rideView: 'sat' })
            restrict('sat')

            const props = service.getDisplayProps()

            expect(props.rideView).toBe('map')
            expect(props.rideViewHelp).toEqual({ label: 'How to get Satellite View' })
        })

        test('restricted with map preference: help refers to street view', () => {
            setup({ rideView: 'map' })
            restrict('map')

            expect(service.getDisplayProps().rideViewHelp).toEqual({ label: 'How to get Street View' })
        })

        test('getRideView() still reports the saved preference (it is the input of the restriction)', () => {
            setup({ rideView: 'sv' })
            restrict()

            expect(service.getRideView()).toBe('sv')
        })

        test('platform unavailability takes precedence over the restriction', () => {
            setup({ mapAvailability: { isAvailable: () => ({ status: 'unavailable', messageKey: 'need.playservices' }) } })
            restrict()

            expect(service.getRideViewOptions().get('sv')).toEqual({
                label: 'Street View', disabled: true, message: 'Install Google Play Services to use this view'
            })
        })

        test('not-supported options stay removed', () => {
            setup({ mapAvailability: { isAvailable: () => ({ status: 'not-supported' }) } })
            restrict()

            expect(service.getRideViewOptions().has('sv')).toBe(false)
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
