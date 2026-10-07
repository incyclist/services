import { DESKTOP_MATRIX } from './__tests__/desktop-matrix'

// The matrix rows themselves are bound to real, executable tests in service-desktop.unit.test.ts
// (CP8). This file only guards that the matrix's area coverage doesn't silently shrink.
describe('DesktopPairingPageService behaviour matrix', ()=> {

    test('the matrix covers every area listed in the plan', ()=> {
        const areas = new Set(DESKTOP_MATRIX.map( r=>r.area))
        expect([...areas].sort()).toEqual(['buttons','device-list','interfaces','ok-navigation','simulate','simulator','skip','tiles'])
    })
})
