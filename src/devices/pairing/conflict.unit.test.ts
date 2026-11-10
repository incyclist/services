import { getCapabilityTitle, getConflictKeepLabel, getConflictQueuedText, getConflictReplaceLabel, getConflictStepSubline, getConflictStepTitle } from './conflict'

describe('conflict step copy', () => {

    test('the title names the device that can measure more', () => {
        expect(getConflictStepTitle('Tacx Neo 2T')).toBe('Tacx Neo 2T can also measure more')
    })

    test.each([
        ['control', 'Resistance'], ['power', 'Power'], ['speed', 'Speed'], ['cadence', 'Cadence'], ['heartrate', 'Heartrate'], ['app_control', 'Controller'],
    ])('%s is called %s', (capability, title) => {
        expect(getCapabilityTitle(capability)).toBe(title)
    })

    test.each<[string[], { full: string, short: string }]>([
        [['speed', 'cadence'], { full: 'We just found your Tacx Neo 2T. Nothing changes until you choose. Speed and Cadence were free and now use Tacx Neo 2T.', short: 'Just found Tacx Neo 2T. Nothing changes until you choose.' }],
        [['control'], { full: 'We just found your Tacx Neo 2T. Nothing changes until you choose. Resistance was free and now uses Tacx Neo 2T.', short: 'Just found Tacx Neo 2T. Nothing changes until you choose.' }],
        [[], { full: 'We just found your Tacx Neo 2T. Nothing changes until you choose.', short: 'Just found Tacx Neo 2T. Nothing changes until you choose.' }],
    ])('the dialog of a found device, free slots %p', (filled, expected) => {
        expect(getConflictStepSubline('detection', 'Tacx Neo 2T', filled)).toEqual(expected)
    })

    test.each<[string[], string]>([
        [['speed', 'cadence'], 'Choose which device to use for each. Speed and Cadence were free and now use Tacx Neo 2T.'],
        [[], 'Choose which device to use for each.'],
    ])('the step of a pick in the list, free slots %p', (filled, full) => {
        expect(getConflictStepSubline('manual', 'Tacx Neo 2T', filled)).toEqual({ full, short: 'Choose which device to use for each.' })
    })

    test('the choices name the devices', () => {
        expect(getConflictKeepLabel('Stages Power')).toBe('Keep Stages Power')
        expect(getConflictReplaceLabel('Tacx Neo 2T')).toBe('Use Tacx Neo 2T')
    })

    test.each<[number, { full: string, short: string } | undefined]>([
        [0, undefined],
        [1, { full: '1 more device to check', short: '1 more to check' }],
        [3, { full: '3 more devices to check', short: '3 more to check' }],
    ])('%i waiting behind the dialog: %p', (queued, text) => {
        expect(getConflictQueuedText(queued)).toEqual(text)
    })
})
