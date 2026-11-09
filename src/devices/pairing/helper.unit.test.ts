import {
    getContinueWithoutDeviceAction, getPairingHelperFooter, getPairingHelperReasonLabel, getPairingHelperReasons, getPairingHelperTip,
    getPairingHelperTitle, hasContinueWithoutDeviceAction
} from './helper'

describe('getPairingHelperReasons', ()=> {

    test.each([
        [undefined, ['asleep','other_app','interface','no_device','unsure']],
        ['connecting', ['asleep','other_app','interface','unsure']],
        ['connected', ['asleep','other_app','interface','unsure']],
        ['unavailable', ['asleep','other_app','interface','trainer_unavailable','unsure']],
    ] as const)('trainer phase %s', (trainerPhase, expected)=> {
        expect(getPairingHelperReasons(trainerPhase)).toEqual(expected)
    })
})

describe('getContinueWithoutDeviceAction', ()=> {

    test('Simulate where it is offered', ()=> {
        expect(getContinueWithoutDeviceAction({rideMode:true, canSimulate:true})).toEqual({ target:'simulate', label:'Ride with simulated power' })
    })

    test('ride mode without Simulate goes back', ()=> {
        expect(getContinueWithoutDeviceAction({rideMode:true, canSimulate:false}))
            .toEqual({ target:'cancel', label:'Go back for now', note:"You'll need one of these devices to start a ride." })
    })

    test('outside ride mode browses routes', ()=> {
        expect(getContinueWithoutDeviceAction({rideMode:false, canSimulate:false}))
            .toEqual({ target:'skip', label:'Browse routes for now', note:"You'll need one of these devices to start a ride." })
    })
})

describe('hasContinueWithoutDeviceAction', ()=> {

    test.each([
        ['no_device', undefined, true],
        ['trainer_unavailable', undefined, true],
        ['trainer_unavailable', 'power', false],
        ['asleep', undefined, false],
        ['unsure', undefined, false],
        [undefined, undefined, false],
    ] as const)('%s with separate sensor %s', (reason, sensor, expected)=> {
        expect(hasContinueWithoutDeviceAction(reason, sensor)).toBe(expected)
    })
})

describe('helper copy', ()=> {

    test('title and footer by whether a trainer is configured', ()=> {
        expect(getPairingHelperTitle(false)).toBe("Can't find your trainer?")
        expect(getPairingHelperTitle(true)).toBe("Can't connect to your trainer?")
        expect(getPairingHelperFooter(false)).toBe('Still searching. Your tiles light up as soon as something is found.')
        expect(getPairingHelperFooter(true)).toBe('Still trying to connect to your saved devices.')
    })

    test('the interface answer names what the platform has', ()=> {
        expect(getPairingHelperReasonLabel('interface', 'desktop')).toBe("Bluetooth or ANT+ isn't working")
        expect(getPairingHelperReasonLabel('interface', 'mobile')).toBe("Bluetooth isn't working")
    })

    test('the other-app tip on mobile also mentions another phone or tablet', ()=> {
        expect(getPairingHelperTip('other_app', {platform:'mobile'}).text).toContain('or another phone or tablet')
        expect(getPairingHelperTip('other_app', {platform:'desktop'}).text).not.toContain('phone')
    })

    test('the not-sure tip names the rider\'s device', ()=> {
        expect(getPairingHelperTip('unsure', {platform:'desktop'}).text).toContain('move your computer closer')
        expect(getPairingHelperTip('unsure', {platform:'mobile'}).text).toContain('move your phone closer')
    })

    test('the trainer-unavailable tip depends on a separate sensor', ()=> {
        expect(getPairingHelperTip('trainer_unavailable', {platform:'mobile'}).shortText)
            .toBe('No power meter or speed sensor connected. Have one? Tap Power or Speed to add it.')
        expect(getPairingHelperTip('trainer_unavailable', {platform:'mobile', separateSensor:'speed'}).shortText)
            .toBe("Ride with your speed sensor instead. You won't feel hills or workout changes; use your gears. Until you next open Devices.")
    })
})
