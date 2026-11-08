import { getPairingStatusDisplay, PairingStatusSource, toPairingInterfaceStates } from "./status"
import { getPairingGuidanceText, getPairingRowLabelId, PARTIAL_OUTAGE_DEBOUNCE_MS } from "./guidance"

const base: PairingStatusSource = {
    platform: 'mobile',
    interfaces: [{ id: 'ble', enabled: true, available: true }, { id: 'wifi', enabled: true, available: true }],
    capabilities: [],
    canStartRide: false,
    loading: false,
    rideMode: false,
}

describe('getPairingStatusDisplay', () => {
    it('S4 while the page is opening, even if interfaces are not yet connected', () => {
        const status = getPairingStatusDisplay({ ...base, loading: true, interfaces: [{ id: 'ble', enabled: true, available: false }] })
        expect(status.id).toBe('S4')
        expect(status.text).toBe('Getting ready to search…')
        expect(status.dot).toBe('amber')
    })

    it('S1 on mobile when Bluetooth is the only interface and it is off', () => {
        const status = getPairingStatusDisplay({ ...base, interfaces: [{ id: 'ble', enabled: true, available: false }] })
        expect(status.id).toBe('S1')
        expect(status.text).toBe("Can't search: Bluetooth is off.")
        expect(status.shortText).toBe('Bluetooth is off.')
        expect(status.link).toBe('Bluetooth settings')
        expect(status.dot).toBe('red')
    })

    it('S1 on desktop only when Bluetooth and ANT+ are both unavailable', () => {
        const desktop: PairingStatusSource = {
            ...base,
            platform: 'desktop',
            interfaces: [
                { id: 'ble', enabled: true, available: false },
                { id: 'ant', enabled: true, available: false },
                { id: 'serial', enabled: true, available: true },
            ],
        }
        expect(getPairingStatusDisplay(desktop).id).toBe('S1')
    })

    it('desktop: not S1 when Wi-Fi (implicitly on outside Windows) can still scan, even with ANT+ and Bluetooth both off', () => {
        const desktop: PairingStatusSource = {
            ...base,
            platform: 'desktop',
            interfaces: [
                { id: 'ble', enabled: false, available: false },
                { id: 'ant', enabled: false, available: false },
                { id: 'wifi', enabled: true, available: true },
            ],
        }
        const status = getPairingStatusDisplay(desktop)
        expect(status.id).not.toBe('S1')
    })

    it('desktop: a ride made ready purely via Wi-Fi (e.g. the simulator) reports S2, not S1', () => {
        const desktop: PairingStatusSource = {
            ...base,
            platform: 'desktop',
            canStartRide: true,
            capabilities: [{ capability: 'control', selected: 'udid-1', deviceName: 'DCSIM FTMS', connectState: 'connected' }],
            interfaces: [
                { id: 'ble', enabled: false, available: false },
                { id: 'ant', enabled: false, available: false },
                { id: 'wifi', enabled: true, available: true },
            ],
        }
        expect(getPairingStatusDisplay(desktop).id).toBe('S2')
    })

    it('S2 names the ready device and offers OK outside ride mode', () => {
        const status = getPairingStatusDisplay({
            ...base,
            canStartRide: true,
            capabilities: [{ capability: 'control', selected: 'udid-1', deviceName: 'Neo', connectState: 'connected' }],
        })
        expect(status.id).toBe('S2')
        expect(status.text).toBe('Ready to ride with Neo. You can add optional sensors, or press OK.')
        expect(status.shortText).toBe('Ready to ride with Neo.')
        expect(status.dot).toBe('green')
    })

    it('S2 offers Start in ride mode', () => {
        const status = getPairingStatusDisplay({
            ...base,
            rideMode: true,
            canStartRide: true,
            capabilities: [{ capability: 'power', selected: 'udid-2', deviceName: 'PM', connectState: 'connected' }],
        })
        expect(status.text).toContain('press Start.')
    })

    it('S3 names the configured trainer while it connects', () => {
        const status = getPairingStatusDisplay({
            ...base,
            capabilities: [{ capability: 'control', selected: 'udid-1', deviceName: 'Neo', connectState: 'connecting' }],
        })
        expect(status.id).toBe('S3')
        expect(status.text).toBe('Connecting to your trainer Neo…')
        expect(status.shortText).toBe('Connecting to Neo…')
    })

    it('S5 while searching with nothing found, without the first-use hint', () => {
        const status = getPairingStatusDisplay({ ...base, interfaces: [{ id: 'ble', enabled: true, available: true }] })
        expect(status.id).toBe('S5')
        expect(status.text).toBe('Searching for devices… Tip: pedal a few strokes to wake up your trainer.')
        expect(status.dot).toBe('amber')
    })

    describe('the first-use partial-outage hint', () => {
        const antMissing: PairingStatusSource = {
            ...base,
            platform: 'desktop',
            interfaces: [{ id: 'ant', enabled: true, available: false }, { id: 'ble', enabled: true, available: true }],
        }

        it('is shown once it has held long enough, amber with no link on desktop', () => {
            const status = getPairingStatusDisplay({ ...antMissing, partialOutageSince: 1000, now: 1000 + PARTIAL_OUTAGE_DEBOUNCE_MS })
            expect(status).toMatchObject({
                id: 'S1b',
                text: 'ANT+ stick not found. If you use one, plug it in, try another USB port, or close other apps that use it.',
                dot: 'amber',
            })
            expect(status.link).toBeUndefined()
        })

        it('carries the settings link for Bluetooth off on mobile', () => {
            const status = getPairingStatusDisplay({
                ...base,
                interfaces: [{ id: 'ble', enabled: true, available: false }, { id: 'wifi', enabled: true, available: true }],
                partialOutageSince: 0, now: PARTIAL_OUTAGE_DEBOUNCE_MS,
            })
            expect(status).toMatchObject({ id: 'S1b', link: 'Bluetooth settings', shortText: 'Bluetooth is off.', shortLink: 'Settings' })
        })

        it('is not shown before it has held long enough', () => {
            expect(getPairingStatusDisplay(antMissing).id).toBe('S5')
        })

        it('is not shown while the page is getting ready', () => {
            expect(getPairingStatusDisplay({ ...antMissing, loading: true, partialOutageSince: 0, now: PARTIAL_OUTAGE_DEBOUNCE_MS }).id).toBe('S4')
        })
    })

    it('a disabled Control capability does not count as ready, even with a connected device', () => {
        const status = getPairingStatusDisplay({
            ...base,
            canStartRide: false,
            capabilities: [{ capability: 'control', selected: 'udid-1', disabled: true, deviceName: 'Neo', connectState: 'connected' }],
        })
        expect(status.id).not.toBe('S2')
    })

    it('a disabled Control capability does not count as connecting', () => {
        const status = getPairingStatusDisplay({
            ...base,
            capabilities: [{ capability: 'control', selected: 'udid-1', disabled: true, deviceName: 'Neo', connectState: 'connecting' }],
        })
        expect(status.id).not.toBe('S3')
    })

    it('an excluded capability does not count as ready, even with a connected device', () => {
        const status = getPairingStatusDisplay({
            ...base,
            canStartRide: false,
            capabilities: [{ capability: 'control', selected: 'udid-1', excluded: { reason: 'not-available', scope: 'until-next-pairing' }, deviceName: 'Neo', connectState: 'connected' }],
        })
        expect(status.id).not.toBe('S2')
    })
})

describe('getPairingStatusDisplay - the configured trainer', () => {
    const trainer = (connectState: string) => ({ capability: 'control', selected: 'udid-1', deviceName: 'Tacx Flux', connectState })
    const trainerPower = (connectState: string) => ({ ...trainer(connectState), capability: 'power' })
    const hrm = (connectState: string) => ({ capability: 'heartrate', selected: 'udid-3', deviceName: 'HRM', connectState })

    it('S7 names the trainer and carries the not-available link once it is unavailable', () => {
        const status = getPairingStatusDisplay({ ...base, trainerPhase: 'unavailable', capabilities: [trainer('waiting'), trainerPower('waiting')] })
        expect(status).toEqual({
            id: 'S7',
            text: "Can't reach your trainer Tacx Flux. Pedal a few strokes to wake it up.",
            shortText: "Can't reach Tacx Flux. Pedal to wake it",
            link: 'Not available today?',
            shortLink: 'Not available?',
            dot: 'amber',
        })
    })

    it.each(['connecting', 'waiting', 'connecting', 'failed', 'connecting'])('S7 holds while the unavailable trainer is %s', (connectState) => {
        const status = getPairingStatusDisplay({ ...base, trainerPhase: 'unavailable', capabilities: [trainer(connectState), trainerPower(connectState)] })
        expect(status.id).toBe('S7')
        expect(status.link).toBe('Not available today?')
    })

    it('S7 holds while another selected device connects', () => {
        const status = getPairingStatusDisplay({ ...base, trainerPhase: 'unavailable', capabilities: [trainer('waiting'), hrm('connecting')] })
        expect(status.id).toBe('S7')
        expect(status.link).toBe('Not available today?')
    })

    it.each(['connecting', 'waiting'])('S3 names the trainer while its attempt still runs and it is %s', (connectState) => {
        const status = getPairingStatusDisplay({ ...base, trainerPhase: 'connecting', capabilities: [trainer(connectState), hrm('connecting')] })
        expect(status.id).toBe('S3')
        expect(status.text).toBe('Connecting to your trainer Tacx Flux…')
        expect(status.shortText).toBe('Connecting to Tacx Flux…')
        expect(status.link).toBeUndefined()
    })

    it('S2 once the trainer is connected and the row is ready', () => {
        const status = getPairingStatusDisplay({ ...base, trainerPhase: 'connected', canStartRide: true, capabilities: [trainer('connected')] })
        expect(status.id).toBe('S2')
    })
})

describe('getPairingStatusDisplay - switched-off capabilities', () => {
    const pwr = { capability: 'power', selected: 'udid-2', deviceName: 'Stages Power', connectState: 'connected' }
    const off = (capability: string, deviceName?: string) => ({ capability, selected: deviceName ? `udid-${capability}` : undefined, deviceName, disabled: true })

    it('S2d: Resistance switched off with its trainer remembered, and a connected power meter', () => {
        const status = getPairingStatusDisplay({ ...base, canStartRide: true, capabilities: [off('control', 'Tacx Neo'), pwr] })
        expect(status).toMatchObject({
            id: 'S2d',
            text: 'Ready to ride with Stages Power, without resistance control (Resistance is switched off).',
            shortText: 'Ready with Stages Power. No resistance control.',
            dot: 'green',
        })
    })

    it('S2: Resistance switched off with nothing remembered, and a connected power meter', () => {
        const status = getPairingStatusDisplay({ ...base, canStartRide: true, capabilities: [off('control'), pwr] })
        expect(status.id).toBe('S2')
        expect(status.text).toBe('Ready to ride with Stages Power. You can add optional sensors, or press OK.')
    })

    it('S8: Resistance, Power and Speed all switched off, one of them still with a switch', () => {
        const status = getPairingStatusDisplay({ ...base, capabilities: [off('control', 'Tacx Neo'), off('power'), off('speed')] })
        expect(status).toMatchObject({
            id: 'S8',
            text: 'Resistance, Power and Speed are all switched off. Switch one back on to ride.',
            shortText: 'To ride: all switched off. Switch one on.',
            dot: 'amber',
        })
    })

    it('S8: all switched off with nothing remembered', () => {
        const status = getPairingStatusDisplay({ ...base, capabilities: [off('control'), off('power'), off('speed')] })
        expect(status.text).toBe('Resistance, Power and Speed are all switched off. Tap one to choose a device.')
        expect(status.shortText).toBe('To ride: all switched off. Tap one to choose.')
    })

    it('no S8 while one of them is still on', () => {
        const status = getPairingStatusDisplay({ ...base, capabilities: [off('control', 'Tacx Neo'), off('power'), { capability: 'speed', disabled: false }] })
        expect(status.id).not.toBe('S8')
    })

    it('S1 still wins over S8', () => {
        const status = getPairingStatusDisplay({ ...base, interfaces: [{ id: 'ble', enabled: true, available: false }], capabilities: [off('control'), off('power'), off('speed')] })
        expect(status.id).toBe('S1')
    })
})

describe('toPairingInterfaceStates', () => {
    it('treats disconnected and unavailable as not available, and missing enabled flag as enabled', () => {
        expect(toPairingInterfaceStates([
            { name: 'ble', state: 'connected' },
            { name: 'ant', state: 'disconnected', enabled: true },
            { name: 'wifi', state: 'unavailable', enabled: false },
        ])).toEqual([
            { id: 'ble', enabled: true, available: true },
            { id: 'ant', enabled: true, available: false },
            { id: 'wifi', enabled: false, available: false },
        ])
    })
})

describe('getPairingStatusDisplay - the page search', () => {
    const pwr = { capability: 'power', selected: 'udid-2', deviceName: 'Stages Power', connectState: 'connected' }
    const neo = { capability: 'control', selected: 'udid-1', deviceName: 'Tacx Neo 2T', connectState: 'connected' }

    it('names the trainer as missing first, with the wake-up tip', () => {
        const status = getPairingStatusDisplay({ ...base, stillLooking: true, missing: ['control', 'heartrate'], capabilities: [pwr] })
        expect(status.id).toBe('S2w')
        expect(status.text).toBe('Found Stages Power. Still looking for a smart trainer: if you have one, pedal a few strokes to wake it up. No trainer? Stop searching.')
        expect(status.shortText).toBe('Found Stages Power. Looking for a trainer…')
        expect(status.dot).toBe('amber')
    })

    it('names the one sensor still missing, after the found trainer', () => {
        const status = getPairingStatusDisplay({ ...base, stillLooking: true, missing: ['heartrate'], capabilities: [neo, pwr] })
        expect(status.text).toBe("Found Tacx Neo 2T. Still looking for a heart-rate monitor. Don't have one? Stop searching.")
        expect(status.shortText).toBe('Found Tacx Neo 2T. Looking for a heart-rate monitor…')
    })

    it('with several sensors missing, names the first one in tile order as an example', () => {
        const status = getPairingStatusDisplay({ ...base, stillLooking: true, missing: ['cadence', 'heartrate', 'speed'], capabilities: [neo] })
        expect(status.text).toBe('Found Tacx Neo 2T. Still looking for other sensors, like a speed sensor. No more sensors? Stop searching.')
        expect(status.shortText).toBe('Found Tacx Neo 2T. Looking for other sensors…')
    })

    it('names the device found even before it is connected', () => {
        const status = getPairingStatusDisplay({ ...base, stillLooking: true, missing: ['control'], capabilities: [{ ...pwr, connectState: 'waiting' }] })
        expect(status.text).toMatch(/^Found Stages Power\./)
    })

    it('says no trainer was found in the ready text after a search without one', () => {
        const status = getPairingStatusDisplay({ ...base, canStartRide: true, searchEndedWithoutTrainer: true, capabilities: [pwr] })
        expect(status.id).toBe('S2e')
        expect(status.text).toBe('Ready to ride with Stages Power. No smart trainer found. Have one? Wake it up, then search again.')
        expect(status.shortText).toBe('Ready with Stages Power. No trainer found.')
        expect(status.dot).toBe('green')
    })

    it('keeps the plain ready text when a trainer was found', () => {
        const status = getPairingStatusDisplay({ ...base, canStartRide: true, capabilities: [neo] })
        expect(status.id).toBe('S2')
    })
})

describe('getPairingRowLabelId', () => {
    it('while the search is still looking, says whether the trainer has been found', () => {
        expect(getPairingGuidanceText(getPairingRowLabelId(false, true))).toEqual({ text: 'TO RIDE', subtext: 'still looking for a trainer' })
        expect(getPairingGuidanceText(getPairingRowLabelId(true, true))).toEqual({ text: 'TO RIDE', subtext: 'trainer found' })
    })

    it('otherwise keeps the existing labels', () => {
        expect(getPairingRowLabelId(false)).toBe('row-required')
        expect(getPairingRowLabelId(true)).toBe('row-required-trainer')
    })
})
