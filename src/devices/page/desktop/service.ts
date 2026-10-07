// side-effect only: devices/pairing (needed below) reaches back into this whole module via a
// deep, pre-existing require cycle spanning devices/ride, routes, workouts, activities and
// coaches (several of them import each other's whole barrel instead of a specific submodule).
// Loading mobile/service.ts first makes it the original entry point for that cycle, so any
// reentry into devices/page further down the chain is a harmless self-reference instead of a
// collateral half-loaded module - see MobilePairingPageService's own safe case.
import '../mobile/service'

import { Injectable, Singleton } from '../../../base/decorators'

import type { DeviceSelectionItemProps, DeviceSelectionProps, PairingExitVia, TConnectState } from '../base/types'
import type { DesktopInterfaceDisplayProps, DesktopPairingDisplayProps } from './types'
import { EnrichedInterfaceSetting, useDeviceAccess } from '../../access'
import { IncyclistCapability } from 'incyclist-devices'
import type { IncyclistDeviceSettings, InterfaceSetting } from '../../configuration'
import type { IObserver } from '../../../types'
import { PairingPageService } from '../base/service'
import { createDirectOrchestrator } from './orchestrator'
import type { PairingOrchestrator } from '../base/orchestrator'
import type { DevicePairingData, DeviceSelectState } from '../../pairing'

/**
 * Pairing page for desktop (web-ui/Electron). Desktop uses the direct orchestrator (today's
 * `DevicePairingService` `usage:'direct'` loop, unchanged), shows every interface (ANT+, BLE,
 * serial, TCP/IP, WiFi) and drives the device list directly rather than through the orchestrator.
 *
 * Not wired to web-ui yet: this class is built and tested standalone first.
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

    // navigation: whether to head for the ride or back to the content page is decided purely from
    // `isPairingForRide` - the same single flag mobile's onSimulate/onSkip already use - not from
    // any route/workout lookup. `onOK` still needs its own override (desktop returns to `source`,
    // not `prevPage`, and targets `/rideOK` instead of mobile's `/rideDeviceOK`); `onSimulate` is
    // inherited unchanged from the base class since it's now identical on both platforms.

    protected onOK():void {
        this.closeVisit('ok')
        this.getDevicePairing().prepareStart()
        this.getDevicePairing().setReadyToStart()
        this.getAppState().setState('paired',true)

        const pathname = this.isPairingForRide ? '/rideOK' : `/${this.getPrevContentPage()}`
        this.moveTo(pathname)
    }

    protected onSkip():void {
        const via:PairingExitVia = this.isPairingForRide ? 'cancel' : 'skip'
        this.closeVisit(via)
        this.getDevicePairing().stop()

        const pathname = this.source ?? `/${this.getPrevContentPage()}`
        this.moveTo(pathname)
    }

    @Injectable
    protected getDeviceAccess() {
        return useDeviceAccess()
    }
}
