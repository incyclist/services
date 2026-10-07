// Desktop Pairing behaviour matrix. Derived from web-ui pairing/page.jsx and
// PairingInfo/DeviceSelector/wrapper.jsx. Rows are bound to real, executable tests in
// ./service.unit.test.ts; ./matrix.unit.test.ts only guards area coverage.
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
    // button matrix: canStartRide x ride mode. Simulate is always offered when not ready - it used
    // to be gated on DeviceRideService.canEnforceSimulator() (a maps-API-key abuse guard for GPX
    // routes); that guard now belongs on the ride page's own fallback, not here (user decision,
    // 2026-10-07) - shared with mobile, so getButtonsDisplayProps() lives only in the base class.
    { area:'buttons', name:'ready, ride mode', given:'canStartRide, mode=start', expected:'primary "Start" (labelOK)' },
    { area:'buttons', name:'ready, normal mode', given:'canStartRide, mode=normal', expected:'primary "OK"' },
    { area:'buttons', name:'not ready, ride mode', given:'!canStartRide, mode=start', expected:'primary "Simulate", secondary "Cancel" (labelSkip)' },
    { area:'buttons', name:'not ready, normal mode', given:'!canStartRide, mode=normal', expected:'primary "Simulate", secondary "Skip" (labelSkip)' },

    // OK navigation: simplified to use the same single `isPairingForRide` flag mobile already
    // uses (ux/user decision, 2026-10-07) - the pairing page does not query RouteListService/
    // WorkoutListService itself, matching mobile's page service, which never did either.
    { area:'ok-navigation', name:'OK in ride mode starts the ride', given:'isPairingForRide', expected:'navigate "/rideOK"' },
    { area:'ok-navigation', name:'OK outside ride mode returns to the content page', given:'!isPairingForRide', expected:'navigate "/<persisted page ?? routes>"' },
    { area:'ok-navigation', name:'OK closes the visit as ok', given:'any', expected:'closeVisit("ok") then devicePairing.prepareStart() and setReadyToStart()' },

    // Skip and Cancel
    { area:'skip', name:'Skip in normal mode returns to the source', given:'mode=normal, location.state.source set', expected:'navigate(source); closeVisit("skip")' },
    { area:'skip', name:'Skip in normal mode without a source', given:'mode=normal, no source', expected:'navigate("/<persisted page ?? routes>"); closeVisit("skip")' },
    { area:'skip', name:'Cancel in ride mode returns to the source', given:'mode=start', expected:'navigate(source); closeVisit("cancel")' },

    // Simulate (only offered when the button matrix says so; canEnforceSimulator already requires a route or workout).
    // Identical to mobile's onSimulate, so it's inherited from the shared base class, not overridden.
    { area:'simulate', name:'Simulate in ride mode', given:'isPairingForRide', expected:'prepareStart([simulatorId]); navigate "/rideSimulate"; closeVisit("simulate")' },

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
