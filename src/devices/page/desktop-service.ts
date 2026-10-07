// side-effect only: devices/pairing (needed below) reaches back into this whole module via a
// deep, pre-existing require cycle (pairing -> ride -> workouts -> ... -> coaches/ride-display ->
// devices -> page). Loading ./service (mobile) first makes devices/page/service.ts the original
// entry point for that cycle, so any reentry into it further down is a harmless self-reference
// instead of a collateral half-loaded module - see MobilePairingPageService's own safe case.
import './service'

import { Injectable, Singleton } from '../../base/decorators'

import type { DesktopInterfaceDisplayProps, DesktopPairingDisplayProps, DeviceSelectionItemProps, DeviceSelectionProps, PairingExitVia, TConnectState } from './types'
import { EnrichedInterfaceSetting, useDeviceAccess } from '../access'
import { IncyclistCapability } from 'incyclist-devices'
import type { IncyclistDeviceSettings, InterfaceSetting } from '../configuration'
import type { IObserver, PairingButtonProps } from '../../types'
import { PairingPageService } from './pairing-page-service'
import { createDirectOrchestrator } from './orchestrator'
import type { PairingOrchestrator } from './orchestrator'
import type { DevicePairingData, DeviceSelectState } from '../pairing'
import type { RouteListService } from '../../routes/list'
import type { WorkoutListService } from '../../workouts/list'

/**
 * Pairing page for desktop (web-ui/Electron). Desktop uses the direct orchestrator (today's
 * `DevicePairingService` `usage:'direct'` loop, unchanged), shows every interface (ANT+, BLE,
 * serial, TCP/IP, WiFi) and drives the device list directly rather than through the orchestrator.
 *
 * Not wired to web-ui yet (that's CP10): this class is built and tested standalone first.
 */
@Singleton
export class DesktopPairingPageService extends PairingPageService {

    /** where Skip/Cancel return to - passed into openPage, not persisted anywhere else */
    protected source: string|undefined

    /** canEnforceSimulator() is only evaluated once, at open, and only matters in ride mode -
     * matches today's `page.jsx` (`simRef`), which never re-checks it on every render */
    protected showSimulateCache: boolean = false

    protected deviceSelectState: DeviceSelectState|undefined

    protected createOrchestrator(): PairingOrchestrator {
        return createDirectOrchestrator()
    }

    protected getUsageMode(): 'page' | 'direct' {
        return 'direct'
    }

    openPage(forRide?:boolean, source?:string):IObserver {
        this.source = source
        this.showSimulateCache = forRide ? this.getDeviceRide().canEnforceSimulator() : false
        return super.openPage(forRide)
    }

    getPageDisplayProperties():DesktopPairingDisplayProps {

        const title = this.isPairingForRide ? 'Paired Devices for Ride' : 'Paired Devices'
        const labelOK = this.isPairingForRide ? 'Start' : 'OK'
        const labelSkip = this.isPairingForRide ? 'Cancel' : 'Skip'

        try {
            const caps = this.state.capabilities??[]
            const ifs = this.state.interfaces??[]
            this.getDeviceAccess().enrichWithAccessState(ifs)

            const interfaces = ifs.map( i=>this.getInterfaceDisplayProps(i))
            const capProps = caps.map( c=>this.getCapabilityDisplayProps(c,false))

            const CP = (cap:IncyclistCapability) => capProps.find( c=>c.capability===cap)

            const top = [
                CP(IncyclistCapability.Control),
                CP(IncyclistCapability.Power),
                CP(IncyclistCapability.Speed)
            ].filter( c=>c!==null && c!==undefined)
            const bottom = [
                CP(IncyclistCapability.HeartRate),
                CP(IncyclistCapability.Cadence),
                CP(IncyclistCapability.AppControl)
            ].filter( c=>c!==null && c!==undefined)

            const buttons = this.getButtonsDisplayProps()

            return {
                title, labelOK, labelSkip,
                readyToStart: this.canStartRide(),
                showSimulate: this.isPairingForRide && this.showSimulateCache,
                capabilities: { top, bottom },
                interfaces,
                deviceSelection: this.getDeviceListDisplayProps(),
                buttons,
                showInterfaceSettings: undefined,
            }
        }
        catch(err) {
            this.logError(err,'getPageDisplayProperties')
            return {
                title, labelOK, labelSkip,
                capabilities: { top:[], bottom:[] },
                interfaces: [],
                buttons: [{ label:labelSkip, primary:true, onClick:this.onSkip.bind(this) }],
                showInterfaceSettings: undefined,
            }
        }
    }

    protected getButtonsDisplayProps(): PairingButtonProps {
        const labelOK = this.isPairingForRide ? 'Start' : 'OK'
        const labelSkip = this.isPairingForRide ? 'Cancel' : 'Skip'

        if (this.canStartRide()) {
            return [
                { label:labelOK, primary:true, onClick:this.onOK.bind(this) },
                { label:labelSkip, primary:false, onClick:this.onSkip.bind(this) },
            ]
        }

        if (this.isPairingForRide && this.showSimulateCache) {
            return [
                { label:'Simulate', primary:true, onClick:this.onSimulate.bind(this) },
                { label:labelSkip, primary:false, onClick:this.onSkip.bind(this) },
            ]
        }

        return [
            { label:labelSkip, primary:true, onClick:this.onSkip.bind(this) },
        ]
    }

    // device list: unlike mobile (which goes through the orchestrator's
    // onDeviceSelectionOpened/Closed), desktop drives startDeviceSelection()/stopDeviceSelection()
    // directly on DevicePairingService - the orchestrator plays no part in this (architecture 2.6).

    protected openDeviceSelection(cap:IncyclistCapability) {
        this.logEvent( {message:'capability clicked', capability:cap, eventSource:'user'})

        this.openedCapability = cap
        this.deviceSelectState = this.getDevicePairing().startDeviceSelection( cap, (newState)=>{
            this.deviceSelectState = newState
            this.updatePage()
        })
        this.updatePage()
    }

    protected onDeviceSelected (d:DevicePairingData,addAll?:boolean) {
        const capability = this.openedCapability
        this.logEvent( {message:'device selected', capability, device:d.name})

        // matches today's DeviceSelector/wrapper.jsx: "change for all" defaults on for Resistance,
        // off for every other capability, unless the caller (the list's checkbox) overrides it
        const changeForAll = addAll ?? (capability===IncyclistCapability.Control)

        this.closeDeviceSelection()
        this.getDevicePairing().selectDevice( capability, d.udid, changeForAll)

        this.updatePage()
    }

    // closing the list never unselects: unselecting is done from the tile
    protected closeDeviceSelection() {
        this.logEvent( {message:'capability closed', capability:this.openedCapability})

        this.getDevicePairing().stopDeviceSelection()
        this.openedCapability = undefined
        this.deviceSelectState = undefined
        this.updatePage()
    }

    protected getDeviceListDisplayProps():DeviceSelectionProps|undefined {

        if (!this.openedCapability)
            return

        const capDevices = this.deviceSelectState?.devices??[]
        const devices: Array<DeviceSelectionItemProps> = capDevices.map( d=> ({
            connectState:d.connectState as TConnectState,
            deviceName: d.name,
            value: d.value,
            interface: d.interface,
            isSelected: d.selected,
            onClick: (addAll?:boolean)=> {this.onDeviceSelected(d,addAll) },
            onDelete: ()=> {this.onDeviceDelete(d) }
        }))

        const disabled = devices.length>0 && !devices.some( d=> d.isSelected)
        const canSelectAll = this.openedCapability===IncyclistCapability.Control

        return {
            capability: this.openedCapability,
            devices,
            isScanning: Boolean(this.deviceSelectState?.isScanning),
            changeForAll: canSelectAll,
            canSelectAll,
            disabled,
            onClose: ()=>{ this.closeDeviceSelection()},
        }
    }

    // interfaces: desktop shows every interface (ANT+, BLE, serial, TCP/IP, WiFi) with its raw
    // state, not mobile's 4-value display mapping (architecture 2.6)
    protected getInterfaceDisplayProps( info:EnrichedInterfaceSetting):DesktopInterfaceDisplayProps {
        const {name,state,isScanning,enabled,protocol,port} = info
        return {
            name, state, isScanning, enabled, protocol, port,
            onClick: ()=>{ this.logEvent({message:'interface clicked', interface:name, eventSource:'user'}) }
        }
    }

    public onInterfaceSettingsChanged( name:string, settings:InterfaceSetting):void {
        this.logEvent( {message:'interface settings changed', interface:name})
        this.getDevicePairing().changeInterfaceSettings(name,settings)
        this.updatePage()
    }

    /** Shift+S on desktop: adds a Simulator device, same as today's page.jsx onAddSimulator */
    public addSimulator():void {
        this.getDeviceConfiguration().add({name:'Simulator', interface:'simulator'} as IncyclistDeviceSettings)
        this.updatePage()
    }

    // navigation: desktop's decision logic (what "ride ready" means, which route to go to, and
    // returning to `source` instead of `prevPage`) differs structurally from mobile's, not just in
    // route strings, so these are fully overridden rather than routed through a shared hook
    // (architecture 2.6's `resolveRoute(target)`). `moveTo()` does not yet accept a navigation
    // `state` - that's CP9 - so `source` is stored but not yet passed through.

    protected onOK():void {
        this.closeVisit('ok')
        this.getDevicePairing().prepareStart()
        this.getDevicePairing().setReadyToStart()
        this.getAppState().setState('paired',true)

        const pathname = this.isRideReady()
            ? (this.hasRouteOrWorkout() ? '/rideOK' : '/rideDeviceOK')
            : `/${this.getPrevContentPage()}`

        this.moveTo(pathname)
    }

    protected onSkip():void {
        const via:PairingExitVia = this.isPairingForRide ? 'cancel' : 'skip'
        this.closeVisit(via)
        this.getDevicePairing().stop()

        const pathname = this.source ?? `/${this.getPrevContentPage()}`
        this.moveTo(pathname)
    }

    protected onSimulate():void {
        this.closeVisit('simulate')
        const simulator = this.getDeviceConfiguration().getSimulatorAdapterId()
        this.getDevicePairing().prepareStart([simulator])

        const pathname = this.isRideReady() ? '/rideSimulate' : `/${this.getPrevContentPage()}`
        this.moveTo(pathname)
    }

    protected isRideReady():boolean {
        const startSettings = this.getRouteListService().getStartSettings()
        return Boolean(this.hasRouteOrWorkout() || startSettings?.type==='Free-Ride')
    }

    protected hasRouteOrWorkout():boolean {
        return Boolean(this.getRouteListService().getSelected() || this.getWorkoutListService().getSelected())
    }

    @Injectable
    protected getDeviceAccess() {
        return useDeviceAccess()
    }

    @Injectable
    protected getRouteListService():RouteListService {
        // required lazily: routes/list transitively imports back into devices/page (via
        // workouts/calendar -> apps -> activities -> coaches -> devices), so importing it at
        // module load time here would create a require cycle
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { getRouteList } = require('../../routes/list')
        return getRouteList()
    }

    @Injectable
    protected getWorkoutListService():WorkoutListService {
        // required lazily, see getRouteListService() above
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { useWorkoutList } = require('../../workouts/list')
        return useWorkoutList()
    }
}
