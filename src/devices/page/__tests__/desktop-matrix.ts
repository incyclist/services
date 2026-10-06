// Desktop Pairing behaviour matrix. Derived from web-ui pairing/page.jsx and
// PairingInfo/DeviceSelector/wrapper.jsx. Rows are bound to DesktopPairingPageService in a
// later checkpoint; until then each row is a todo.
//
// `flag` marks a row that still needs a decision before it's bound.

export type DesktopMatrixRow = {
    area: string
    name: string
    given: string
    expected: string
    flag?: string
}

export const DESKTOP_MATRIX: Array<DesktopMatrixRow> = [
    // button matrix: canStartRide x ride mode x simulate (simulate evaluated once at open, ride mode only)
    { area:'buttons', name:'ready, ride mode', given:'canStartRide, mode=start', expected:'primary "Start" (labelOK), secondary "Cancel" (labelSkip)' },
    { area:'buttons', name:'ready, normal mode', given:'canStartRide, mode=normal', expected:'primary "OK", secondary "Skip"' },
    { area:'buttons', name:'not ready, ride mode, simulator enforceable', given:'!canStartRide, mode=start, canEnforceSimulator at open', expected:'primary "Simulate", secondary "Cancel"' },
    { area:'buttons', name:'not ready, ride mode, no simulator', given:'!canStartRide, mode=start, canEnforceSimulator false', expected:'primary "Cancel"' },
    { area:'buttons', name:'not ready, normal mode', given:'!canStartRide, mode=normal', expected:'primary "Skip", no Simulate (simulate is ride-mode only)' },

    // OK navigation (page.jsx onOKClicked): the destination depends on what is selected, not on the mode
    { area:'ok-navigation', name:'OK with a route selected', given:'selectedRoute set', expected:'navigate "/rideOK" with state {source}' },
    { area:'ok-navigation', name:'OK with a workout selected', given:'selectedWorkout set', expected:'navigate "/rideOK" with state {source}' },
    { area:'ok-navigation', name:'OK with free ride', given:'startSettings.type==="Free-Ride"', expected:'navigate "/rideDeviceOK" with state {source}' },
    { area:'ok-navigation', name:'OK with nothing selected', given:'no route, workout or free ride', expected:'navigate "/<persisted page ?? routes>" with state {source}' },
    { area:'ok-navigation', name:'OK closes the visit as ok', given:'any', expected:'closeVisit("ok") then devicePairing.prepareStart() and setReadyToStart()' },

    // Skip and Cancel
    { area:'skip', name:'Skip in normal mode returns to the source', given:'mode=normal, location.state.source set', expected:'navigate(source); closeVisit("skip")' },
    { area:'skip', name:'Skip in normal mode without a source', given:'mode=normal, no source', expected:'navigate("/<persisted page ?? routes>"); closeVisit("skip")' },
    { area:'skip', name:'Cancel in ride mode returns to the source', given:'mode=start', expected:'navigate(source); closeVisit("cancel")' },

    // Simulate (only offered when the button matrix says so; canEnforceSimulator already requires a route or workout)
    { area:'simulate', name:'Simulate with a route selected', given:'ride mode, route set', expected:'prepareStart([simulatorId]); navigate "/rideSimulate"; closeVisit("simulate")' },

    // Shift+S adds the simulator, in any mode
    { area:'simulator', name:'Shift+S adds the simulator', given:'Shift+S pressed', expected:'deviceConfig.add({name:"Simulator", interface:"simulator"}); the key is disabled afterwards' },

    // tiles and the device list
    { area:'tiles', name:'Tile ✕ unselects the capability', given:'a selected tile', expected:'devicePairing.unselectDevices(capability)' },
    { area:'device-list', name:'Opening a tile opens its device list', given:'tile clicked', expected:'DeviceSelector opens for that capability' },
    { area:'device-list', name:'Select with changeForAll default for Resistance', given:'capability=control, device clicked', expected:'selectDevice(control, udid, true); the dialog closes' },
    { area:'device-list', name:'Select with changeForAll default for other capabilities', given:'capability!=control, device clicked', expected:'selectDevice(capability, udid, false); the dialog closes' },
    { area:'device-list', name:'Select-all is offered for Resistance only', given:'capability=control', expected:'canSelectAll true; other capabilities false' },
    { area:'device-list', name:'Delete a device in the list', given:'delete clicked on a device', expected:'devicePairing.deleteDevice(capability, udid); the list stays open' },
    { area:'device-list', name:'Cancel the device list keeps the selection', given:'Cancel in the list', expected:'stopDeviceSelection(); onCancel closes the dialog; no unselect', flag:'Mobile has a "Don\'t use" tick that unselects. Desktop has no tick and uses the tile ✕. The product owner wants an alternative on mobile; a UX suggestion is pending.' },

    // interfaces
    { area:'interfaces', name:'Interface settings change', given:'OK in interface settings', expected:'devicePairing.changeInterfaceSettings(ifName, settings); the dialog closes' },
]
