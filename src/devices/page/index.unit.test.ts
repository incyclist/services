import { getDevicesPageService } from './index'
import { getBindings } from '../../api'

// Checks the constructor name rather than `instanceof` against a separately-imported class: the
// `@Singleton` decorator returns the *inner*, undecorated instance, so `instanceof` against the
// decorated (exported) class reference does not hold in general - unrelated to this file. It also
// avoids importing DesktopPairingPageService directly at module scope: devices/ride transitively
// loops back into devices/page through a wider pre-existing barrel-import tangle (see index.ts's
// comment), so production code only ever reaches that class through its own lazy require, and a
// second, separate top-level import here would resolve to a divergent copy of the class.
describe('devices/page - getDevicesPageService (platform dispatch)', ()=> {

    afterEach( ()=> {
        (getBindings() as any).reset?.()
    })

    test('channel "mobile" returns the mobile page service', ()=> {
        (getBindings() as any).appInfo = { getChannel: ()=>'mobile' }

        expect(getDevicesPageService().constructor.name).toBe('MobilePairingPageService')
    })

    test('channel "desktop" returns the desktop page service', ()=> {
        (getBindings() as any).appInfo = { getChannel: ()=>'desktop' }

        expect(getDevicesPageService().constructor.name).toBe('DesktopPairingPageService')
    })

    test('channel "web" also returns the desktop page service', ()=> {
        (getBindings() as any).appInfo = { getChannel: ()=>'web' }

        expect(getDevicesPageService().constructor.name).toBe('DesktopPairingPageService')
    })
})
