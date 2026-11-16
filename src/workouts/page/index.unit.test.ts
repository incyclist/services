import { getWorkoutListPageService } from './index'
import { getBindings } from '../../api'

// Compares the constructor name rather than using `instanceof`: the `@Singleton` decorator
// returns the inner, undecorated class, so `instanceof` against the exported (decorated)
// reference does not hold in general.
describe('workouts/page - getWorkoutListPageService (platform dispatch)', ()=> {

    afterEach( ()=> {
        (getBindings() as any).reset?.()
    })

    test('channel "mobile" returns the mobile page service', ()=> {
        (getBindings() as any).appInfo = { getChannel: ()=>'mobile' }

        expect(getWorkoutListPageService().constructor.name).toBe('MobileWorkoutListPageService')
    })

    test('channel "desktop" returns the desktop page service', ()=> {
        (getBindings() as any).appInfo = { getChannel: ()=>'desktop' }

        expect(getWorkoutListPageService().constructor.name).toBe('DesktopWorkoutListPageService')
    })

    test('channel "web" also returns the desktop page service', ()=> {
        (getBindings() as any).appInfo = { getChannel: ()=>'web' }

        expect(getWorkoutListPageService().constructor.name).toBe('DesktopWorkoutListPageService')
    })
})
