// Desktop Pairing behaviour matrix. Derived from web-ui pairing/page.jsx and
// PairingInfo/DeviceSelector/wrapper.jsx as they are today. Rows are bound to
// DesktopPairingPageService in a later checkpoint; until then each row is a todo.
//
// `observed` describes what the current desktop code does. A row marked `flag` disagrees
// with the wording of the plan and needs a decision before it's bound.

type MatrixRow = {
    area: string
    name: string
    given: string
    expected: string
    flag?: string
}

export const DESKTOP_MATRIX: Array<MatrixRow> = [
    // button matrix: canStartRide x ride mode x simulate (simulate evaluated once at open, ride mode only)
    { area:'buttons', name:'ready, ride mode', given:'canStartRide, mode=start', expected:'primary "Start" (labelOK), secondary "Cancel" (labelSkip)' },
    { area:'buttons', name:'ready, normal mode', given:'canStartRide, mode=normal', expected:'primary "OK", secondary "Skip"' },
    { area:'buttons', name:'not ready, ride mode, simulator enforceable', given:'!canStartRide, mode=start, canEnforceSimulator at open', expected:'primary "Simulate", secondary "Cancel"' },
    { area:'buttons', name:'not ready, ride mode, no simulator', given:'!canStartRide, mode=start, canEnforceSimulator false', expected:'primary "Cancel"' },
    { area:'buttons', name:'not ready, normal mode', given:'!canStartRide, mode=normal', expected:'primary "Skip", no Simulate (simulate is ride-mode only)' },

    // OK navigation (page.jsx onOKClicked): the destination depends on what is selected, not on the mode
    { area:'ok-navigation', name:'OK with a route selected', given:'selectedRoute set', expected:'navigate "/rideDeviceOK" with state {source}', flag:'Plan says /rideOK for routes. Code goes to /rideDeviceOK for every ride-ready case.' },
    { area:'ok-navigation', name:'OK with a workout selected', given:'selectedWorkout set', expected:'navigate "/rideDeviceOK" with state {source}', flag:'Plan says the workout ride goes to its own page. Code uses /rideDeviceOK.' },
    { area:'ok-navigation', name:'OK with free ride', given:'startSettings.type==="Free-Ride"', expected:'navigate "/rideDeviceOK" with state {source}' },
    { area:'ok-navigation', name:'OK with nothing selected', given:'no route, workout or free ride', expected:'navigate "/<persisted page ?? routes>" with state {source}' },
    { area:'ok-navigation', name:'OK closes the visit as ok', given:'any', expected:'closeVisit("ok") then devicePairing.prepareStart() and setReadyToStart()' },

    // Skip and Cancel
    { area:'skip', name:'Skip in normal mode returns to the source', given:'mode=normal, location.state.source set', expected:'navigate(source); closeVisit("skip")' },
    { area:'skip', name:'Skip in normal mode without a source', given:'mode=normal, no source', expected:'navigate("/<persisted page ?? routes>"); closeVisit("skip")' },
    { area:'skip', name:'Cancel in ride mode returns to the source', given:'mode=start', expected:'navigate(source); closeVisit("cancel")' },

    // Simulate (only offered when the button matrix says so)
    { area:'simulate', name:'Simulate with a route selected', given:'ride mode, route set', expected:'prepareStart([simulatorId]); navigate "/rideSimulate"; closeVisit("simulate")' },
    { area:'simulate', name:'Simulate with nothing selected', given:'ride mode, nothing selected', expected:'prepareStart([simulatorId]); navigate "/<persisted page ?? routes>"; closeVisit("simulate")', flag:'Code falls back to the persisted page. The plan does not say what happens here.' },

    // Shift+S adds the simulator, in any mode
    { area:'simulator', name:'Shift+S adds the simulator', given:'Shift+S pressed', expected:'deviceConfig.add({name:"Simulator", interface:"simulator"}); the key is disabled afterwards' },

    // tiles and the device list
    { area:'tiles', name:'Tile ✕ unselects the capability', given:'a selected tile', expected:'devicePairing.unselectDevices(capability)' },
    { area:'device-list', name:'Opening a tile opens its device list', given:'tile clicked', expected:'DeviceSelector opens for that capability' },
    { area:'device-list', name:'Select with changeForAll default for Resistance', given:'capability=control, device clicked', expected:'selectDevice(control, udid, true); the dialog closes' },
    { area:'device-list', name:'Select with changeForAll default for other capabilities', given:'capability!=control, device clicked', expected:'selectDevice(capability, udid, false); the dialog closes' },
    { area:'device-list', name:'Select-all is offered for Resistance only', given:'capability=control', expected:'canSelectAll true; other capabilities false' },
    { area:'device-list', name:'Delete a device in the list', given:'delete clicked on a device', expected:'devicePairing.deleteDevice(capability, udid); the list stays open' },
    { area:'device-list', name:'Cancel the device list does not unselect', given:'Cancel in the list', expected:'stopDeviceSelection(); onCancel closes the dialog; NO unselect', flag:'Mobile unselects on close(false). Desktop Cancel does not. Decide whether desktop should match before binding.' },

    // interfaces
    { area:'interfaces', name:'Interface settings change', given:'OK in interface settings', expected:'devicePairing.changeInterfaceSettings(ifName, settings); the dialog closes' },
]

describe('DesktopPairingPageService behaviour matrix', ()=> {

    test('the matrix covers every area listed in the plan', ()=> {
        const areas = new Set(DESKTOP_MATRIX.map( r=>r.area))
        expect([...areas].sort()).toEqual(['buttons','device-list','interfaces','ok-navigation','simulate','simulator','skip','tiles'])
    })

    // pending until DesktopPairingPageService exists (CP8)
    DESKTOP_MATRIX.forEach( r=> test.todo(`${r.area}: ${r.name}`))
})
