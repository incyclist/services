import { getPairingStatusDisplay, PairingStatusSource, toPairingInterfaceStates } from "./status"

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

    it('never returns the first-use hint state in this checkpoint', () => {
        const status = getPairingStatusDisplay({
            ...base,
            platform: 'desktop',
            interfaces: [{ id: 'ant', enabled: true, available: false }, { id: 'ble', enabled: true, available: true }],
        })
        expect(status.id).toBe('S5')
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
