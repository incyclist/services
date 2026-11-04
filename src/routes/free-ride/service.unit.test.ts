import { Inject } from '../../base/decorators'
import { DEFAULT_POSITION, DEFAULT_RADIUS } from '../../maps/MapArea/consts'
import { MapArea } from '../../maps/MapArea/MapArea'
import { useMapArea } from '../../maps/MapArea/service'
import { getBounds } from '../../maps/MapArea/utils'
import { FreeRideService } from './service'
import defaultLocation from '../../../__tests__/data/overpass/default-location.json'

describe('FreeRideService', () => {

    // At the default position "North" leaves the start crossing towards node 99836339, where
    // way 82696507 continues north (A) and way 11236601 branches west (B)
    const NORTH = '82696507:crossing-99836339'
    const SOUTH = '82696507:crossing-99887567'
    const OPTION_A = '82696507:99836339-99746466'
    const OPTION_B = '11236601:99836339-99649655'

    const deferred = <T>() => {
        let resolve!: (value: T) => void
        const promise = new Promise<T>(res => { resolve = res })
        return { promise, resolve }
    }

    let service: FreeRideService
    let map: MapArea
    let load: jest.Mock

    const UserSettingsMock = {
        get: jest.fn((_key: string, defValue: unknown) => defValue),
        set: jest.fn()
    }

    beforeEach(() => {
        const mapData = useMapArea().createMapData(defaultLocation as unknown as JSON)
        const boundary = getBounds(DEFAULT_POSITION.lat, DEFAULT_POSITION.lng, DEFAULT_RADIUS)
        map = new MapArea(mapData, DEFAULT_POSITION, boundary)

        // the OptionManager calls useMapArea() directly, so the real service has to be patched as well
        load = jest.fn(async () => map)
        useMapArea().load = load
        Inject('MapArea', { load, getMap: jest.fn(() => map) })
        Inject('UserSettings', UserSettingsMock)

        service = new FreeRideService()
    })

    afterEach(() => {
        Inject('MapArea', null)
        Inject('UserSettings', null)
        service.reset()
        useMapArea().reset()
        jest.clearAllMocks()
    })

    describe('init', () => {

        beforeEach(() => { jest.useFakeTimers() })
        afterEach(() => { jest.useRealTimers() })

        test('does not repeat the start position selection once the first attempt succeeded', async () => {
            const select = jest.spyOn(service, 'selectStartPosition')

            service.init()
            await jest.advanceTimersByTimeAsync(40000)

            expect(select).toHaveBeenCalledTimes(1)
            expect(service.isInitialized()).toBe(true)
        })

        test('retries once if the first attempt failed', async () => {
            load.mockRejectedValueOnce(new Error('overpass not available'))
            const select = jest.spyOn(service, 'selectStartPosition')

            service.init()
            await jest.advanceTimersByTimeAsync(40000)

            expect(select).toHaveBeenCalledTimes(2)
            expect(service.isInitialized()).toBe(true)
        })
    })

    describe('ensureInitialized', () => {

        test('retries when an earlier attempt failed and the map is available again', async () => {
            load.mockResolvedValue(undefined)   // overpass down: MapArea.load() resolves without a map
            await service.selectStartPosition()
            expect(service.isInitialized()).toBe(false)

            load.mockResolvedValue(map)         // overpass back up
            const res = await service.ensureInitialized()

            expect(res).toBe(true)
            expect(service.isInitialized()).toBe(true)
        })

        test('returns false if the map still can not be loaded', async () => {
            load.mockResolvedValue(undefined)

            expect(await service.ensureInitialized()).toBe(false)
            expect(service.isInitialized()).toBe(false)
        })

        test('returns false if loading the map throws', async () => {
            load.mockRejectedValue(new Error('overpass not available'))

            expect(await service.ensureInitialized()).toBe(false)
        })

        test('does not reload the map if already initialized', async () => {
            await service.selectStartPosition()
            load.mockClear()

            expect(await service.ensureInitialized()).toBe(true)
            expect(load).not.toHaveBeenCalled()
        })

        test('shares one attempt between concurrent calls', async () => {
            load.mockResolvedValue(undefined)

            await Promise.all([service.ensureInitialized(), service.ensureInitialized()])

            expect(load).toHaveBeenCalledTimes(1)
        })
    })

    describe('start options', () => {

        test('default position offers North and South as start options', async () => {
            const { options } = await service.selectStartPosition()

            expect(options.map(o => o.id).sort()).toEqual([NORTH, SOUTH].sort())
            expect(options.find(o => o.id === NORTH).text).toBe('North')
            expect(options.find(o => o.id === SOUTH).text).toBe('South')
        })

        test('applying North offers the two junction options with a numeric direction', async () => {
            await service.selectStartPosition()
            service.applyStartOption({ id: NORTH } as never)
            await service.getNextOptions(true)

            const options = service.buildUIOptions()

            expect(options.map(o => o.id)).toEqual([OPTION_B, OPTION_A])
            expect(options.every(o => Number.isFinite(o.direction))).toBe(true)
            expect(options.find(o => o.id === OPTION_A).selected).toBe(true)
            expect(options.find(o => o.id === OPTION_B).selected).toBe(false)
        })
    })

    describe('option buttons', () => {

        const startNorth = async () => {
            await service.selectStartPosition()
            service.applyStartOption({ id: NORTH } as never)
            await service.getNextOptions(true)
        }

        test('start options carry compass, heading and road label and use no green', async () => {
            const { options } = await service.selectStartPosition()

            expect(options.every(o => o.roadLabel?.length > 0)).toBe(true)
            expect(options.every(o => Number.isFinite(o.heading))).toBe(true)
            expect(options.find(o => o.id === NORTH).compass).toBe('North')
            expect(options.some(o => ['green', 'yellow'].includes(o.color))).toBe(false)
        })

        test('ride options are numbered left to right, with exactly one default that is selected automatically', async () => {
            await startNorth()
            const options = service.buildUIOptions()

            expect(options.map(o => o.index)).toEqual([1, 2])
            expect(options[0].direction).toBeLessThan(options[1].direction)
            expect(options.filter(o => o.isDefault)).toHaveLength(1)

            const selected = options.find(o => o.id === OPTION_A)
            expect(selected).toMatchObject({ isDefault: true, selected: true, selectedBy: 'auto', color: '#8dc100' })
            expect(options.every(o => o.maneuverText?.length > 0 && o.roadLabel?.length > 0 && o.degraded === false)).toBe(true)
        })

        test('a choice by the rider is remembered and survives applying it', async () => {
            await startNorth()

            service.selectOptionByUser(OPTION_B)
            let options = service.buildUIOptions()
            expect(options.find(o => o.id === OPTION_B)).toMatchObject({ selected: true, selectedBy: 'user', isDefault: false })
            expect(options.find(o => o.id === OPTION_A).selected).toBe(false)

            service.applyOption(service.getSelectedOption())
            options = service.buildUIOptions()
            expect(options.find(o => o.id === OPTION_B).selectedBy).toBe('user')
        })

        test('a new set of options starts with the automatic selection again', async () => {
            await startNorth()
            service.selectOptionByUser(OPTION_B)

            await service.getNextOptions()

            const selected = service.buildUIOptions().find(o => o.selected)
            expect(selected.selectedBy).toBe('auto')
        })

        test('an option is never shown twice', async () => {
            await startNorth()
            const raw = service.getOptions()

            const options = service.buildUIOptions([...raw, raw[0]])

            expect(options).toHaveLength(raw.length)
        })
    })

    describe('segment-update listener', () => {
        test('is removed when the next level options are loaded, so listeners do not pile up per junction', async () => {
            await service.selectStartPosition()
            service.applyStartOption({ id: NORTH } as never)

            for (let i = 0; i < 12; i++) {
                await service.getNextOptions(true)
            }

            // the next level is also pre-calculated in the background: let it finish
            for (let i = 0; i < 100 && service.listenerCount('segment-update') > 0; i++) {
                await new Promise(resolve => setImmediate(resolve))
            }

            expect(service.listenerCount('segment-update')).toBe(0)
        })

        test('is removed when loading stops because the segment changed', async () => {
            await service.selectStartPosition()
            service.applyStartOption({ id: NORTH } as never)

            const pending = service.getNextOptions(true)
            service.setCurrentSegment(service.getSelectedOption())
            await pending

            expect(service.listenerCount('segment-update')).toBe(0)
        })
    })

    describe('selectStartPosition', () => {

        // Reproduces the "grey options" bug: the start dialog re-runs selectStartPosition() when the user
        // clicks Start (and init() does so once more after 15s). With a slow map load (throttled network)
        // this second call finishes after the ride has started and the junction options were calculated.
        // It must not replace the junction options of the running ride by the (direction-less) start options.
        test('a start position update that finishes after the ride started keeps the junction options', async () => {
            await service.selectStartPosition()

            const slowMap = deferred<MapArea>()
            load.mockReturnValueOnce(slowMap.promise)
            const rebuild = service.selectStartPosition()

            service.applyStartOption({ id: NORTH } as never)
            await service.getNextOptions(true)

            slowMap.resolve(map)
            await rebuild

            const options = service.buildUIOptions()

            expect(options.map(o => o.id)).toEqual([OPTION_B, OPTION_A])
            expect(options.every(o => Number.isFinite(o.direction))).toBe(true)
            expect(options.find(o => o.id === OPTION_A).selected).toBe(true)
        })

        test('a start position update that finishes before the ride started does not touch the options of the ride', async () => {
            await service.selectStartPosition()
            await service.selectStartPosition()

            service.applyStartOption({ id: NORTH } as never)
            await service.getNextOptions(true)

            const options = service.buildUIOptions()

            expect(options.map(o => o.id)).toEqual([OPTION_B, OPTION_A])
            expect(options.every(o => Number.isFinite(o.direction))).toBe(true)
        })
    })
})
