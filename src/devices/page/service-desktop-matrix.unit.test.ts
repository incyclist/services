import { DESKTOP_MATRIX } from './__tests__/desktop-matrix'

describe('DesktopPairingPageService behaviour matrix', ()=> {

    test('the matrix covers every area listed in the plan', ()=> {
        const areas = new Set(DESKTOP_MATRIX.map( r=>r.area))
        expect([...areas].sort()).toEqual(['buttons','device-list','interfaces','ok-navigation','simulate','simulator','skip','tiles'])
    })

    // pending until DesktopPairingPageService exists (CP8)
    DESKTOP_MATRIX.forEach( r=> test.todo(`${r.area}: ${r.name}`))
})
