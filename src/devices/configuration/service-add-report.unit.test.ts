/* eslint-disable @typescript-eslint/no-explicit-any */
import { AdapterFactory, IncyclistCapability, SerialPortProvider } from "incyclist-devices"
import { AddDeviceResult, ExtendedIncyclistCapability } from "./model"
import { DeviceConfigurationService } from "./service"

const Trainer = (id: string) => ({ interface: 'ble', name: `trainer-${id}`, address: id, protocol: 'fm' })
const PowerMeter = (id: string) => ({ interface: 'ble', name: `pwr-${id}`, address: id, protocol: 'cp' })
const Hrm = (id: string) => ({ interface: 'ble', name: `hrm-${id}`, address: id, protocol: 'hr' })
const ZwiftPlay = (id: string) => ({ interface: 'ble', name: `zp-${id}`, address: id, protocol: 'zwift-play' })

const WITHOUT_CONTROLLER: ExtendedIncyclistCapability[] = [
    IncyclistCapability.Control, IncyclistCapability.Power, IncyclistCapability.Cadence,
    IncyclistCapability.Speed, IncyclistCapability.HeartRate
]

describe('DeviceConfigurationService.add()', () => {

    let service: DeviceConfigurationService

    const setCapabilities = (capabilities: ExtendedIncyclistCapability[]) => {
        service.settings = {
            devices: [],
            capabilities: capabilities.map(capability => ({ capability, devices: [], selected: undefined, disabled: false }))
        }
    }

    const addWithReport = (settings: any): AddDeviceResult => {
        let report: AddDeviceResult | undefined
        service.add(settings, { onAdded: (r) => { report = r } })
        return report as AddDeviceResult
    }

    const selectedOf = (capability: IncyclistCapability) =>
        service.settings.capabilities.find(c => c.capability === capability)?.selected

    beforeEach(() => {
        service = new DeviceConfigurationService()
        setCapabilities([...WITHOUT_CONTROLLER, IncyclistCapability.AppControl])
        service.adapters = {}
        ;(service as any).updateUserSettings = jest.fn()
        ;(service as any).emitCapabiltyChanged = jest.fn()
        SerialPortProvider.getInstance().getBinding = jest.fn().mockReturnValue({})
    })

    afterEach(() => {
        AdapterFactory.reset()
        service.reset()
        jest.clearAllMocks()
    })

    afterAll(() => {
        (SerialPortProvider as any)._instance = undefined
    })

    describe('onAdded report', () => {

        test('reports the capabilities a new device is now known for, and the empty slots it filled', () => {
            const report = addWithReport(PowerMeter('1'))

            expect(report.udid).toBeDefined()
            expect([...report.newlyKnown].sort()).toEqual([IncyclistCapability.Cadence, IncyclistCapability.Power, IncyclistCapability.Speed].sort())
            expect(report.autoSelected.map(a => a.capability).sort()).toEqual([IncyclistCapability.Cadence, IncyclistCapability.Power, IncyclistCapability.Speed].sort())
        })

        test('a re-detected device is not newly known for anything', () => {
            service.add(PowerMeter('1'))
            const report = addWithReport(PowerMeter('1'))

            expect(report.newlyKnown).toEqual([])
            expect(report.autoSelected).toEqual([])
        })

        test('a device meeting an occupied slot is newly known for it but does not fill it', () => {
            const trainer = service.add(Trainer('1'))
            const report = addWithReport(PowerMeter('2'))

            expect(report.newlyKnown).toContain(IncyclistCapability.Power)
            expect(report.autoSelected.map(a => a.capability)).not.toContain(IncyclistCapability.Power)
            expect(selectedOf(IncyclistCapability.Power)).toBe(trainer)
        })

        test('the fill rule is "control" for a trainer, "heartrate" for a heart-rate monitor and "new-rule" for any other device', () => {
            const trainer = addWithReport(Trainer('1'))
            expect(new Set(trainer.autoSelected.map(a => a.rule))).toEqual(new Set(['control']))

            const hrm = addWithReport(Hrm('2'))
            expect(hrm.autoSelected).toEqual([{ capability: IncyclistCapability.HeartRate, rule: 'heartrate' }])

            setCapabilities(WITHOUT_CONTROLLER)
            const pwr = addWithReport(PowerMeter('3'))
            expect(new Set(pwr.autoSelected.map(a => a.rule))).toEqual(new Set(['new-rule']))
        })

        test('add() without onAdded still just returns the udid', () => {
            const udid = service.add(PowerMeter('1'))
            expect(typeof udid).toBe('string')
        })
    })

    describe('Controller slot', () => {

        test('a newly detected controller fills an empty Controller slot, with rule "new-rule"', () => {
            const report = addWithReport(ZwiftPlay('1'))

            expect(selectedOf(IncyclistCapability.AppControl)).toBe(report.udid)
            expect(report.autoSelected).toEqual([{ capability: IncyclistCapability.AppControl, rule: 'new-rule' }])
        })

        test('a controller does not fill a switched-off Controller slot', () => {
            service.disableCapability(IncyclistCapability.AppControl, true)

            const report = addWithReport(ZwiftPlay('1'))

            expect(selectedOf(IncyclistCapability.AppControl)).toBeUndefined()
            expect(report.autoSelected).toEqual([])
        })

        test('a controller never replaces a different controller already selected', () => {
            const first = service.add(ZwiftPlay('1'))
            const report = addWithReport(ZwiftPlay('2'))

            expect(selectedOf(IncyclistCapability.AppControl)).toBe(first)
            expect(report.newlyKnown).toEqual([IncyclistCapability.AppControl])
            expect(report.autoSelected).toEqual([])
        })

        test('the Controller slot is created if it does not exist yet, so a controller can fill it', () => {
            setCapabilities(WITHOUT_CONTROLLER)

            const report = addWithReport(ZwiftPlay('1'))

            expect(selectedOf(IncyclistCapability.AppControl)).toBe(report.udid)
        })

        test('the Controller slot is not created by adding a device that is not a controller', () => {
            setCapabilities(WITHOUT_CONTROLLER)

            service.add(PowerMeter('1'))

            expect(service.settings.capabilities.some(c => c.capability === IncyclistCapability.AppControl)).toBe(false)
        })
    })
})
