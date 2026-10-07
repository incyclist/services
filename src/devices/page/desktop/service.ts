import { IncyclistCapability } from 'incyclist-devices'

import { Injectable, Singleton } from '../../../base/decorators'

import { PairingPageService } from '../base/service'
import { createDirectOrchestrator } from './orchestrator'
import type { PairingOrchestrator } from '../base/orchestrator'

import type { IObserver } from '../../../types'
import type { DeviceSelectionItemProps, DeviceSelectionProps, PairingExitVia, TConnectState } from '../base/types'
import type { DesktopInterfaceDisplayProps, DesktopInterfaceSettingsDisplayProps, DesktopPairingDisplayProps } from './types'

import { EnrichedInterfaceSetting, useDeviceAccess } from '../../access'
import { getPairingGuidanceText, getPairingRowLabelId, getPairingStatusDisplay, toPairingInterfaceStates } from '../../pairing'
import type { IncyclistDeviceSettings, InterfaceSetting } from '../../configuration/model'
import type { DevicePairingData, DeviceSelectState } from '../../pairing/model'

/**
 * Pairing page for desktop (web-ui/Electron). Desktop uses the direct orchestrator (today's
 * `DevicePairingService` `usage:'direct'` loop, unchanged), shows every interface (ANT+, BLE,
 * serial, TCP/IP, WiFi) and drives the device list directly rather than through the orchestrator.
 */
@Singleton
export class DesktopPairingPageService extends PairingPageService {

    /** where Skip/Cancel return to - passed into openPage, not persisted anywhere else */
    protected source: string|undefined

    protected deviceSelectState: DeviceSelectState|undefined

    /** the interface whose settings dialog is currently shown (ant/ble/serial/tcpip/wifi), or none */
    protected interfaceSettingsFor: string|undefined

    protected createOrchestrator(): PairingOrchestrator {
        return createDirectOrchestrator()
    }

    protected getUsageMode(): 'page' | 'direct' {
        return 'direct'
    }

    openPage(forRide?:boolean, source?:string):IObserver {
        this.source = source
        return super.openPage(forRide)
    }

    getPageDisplayProperties():DesktopPairingDisplayProps {

        const title = 'Devices'

        try {
            const caps = this.state.capabilities??[]
            const allIfs = this.state.interfaces??[]
            // `invisible` (set by DeviceConfigurationService for wifi on non-Windows, where it's
            // implicitly always on) is stripped before the tiles are built - the rider never sees a
            // Wi-Fi icon there - but the status line still needs Wi-Fi's real state (allIfs, below):
            // it's one of the interfaces S1 asks "can anything scan?" about, just never named in
            // the text (ux rev. 6).
            const ifs = allIfs.filter( i=>!i.invisible)
            this.getDeviceAccess().enrichWithAccessState(ifs)

            const interfaces = ifs.map( i=>this.getInterfaceDisplayProps(i))

            const status = getPairingStatusDisplay({
                platform: 'desktop',
                interfaces: toPairingInterfaceStates(allIfs),
                capabilities: caps,
                canStartRide: this.canStartRide(),
                loading: this.promiseOpen!==undefined,
                rideMode: this.isPairingForRide,
            })
            const capProps = caps.map( c=>this.getCapabilityDisplayProps(c, status.id==='S1'))

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

            const trainerSelected = Boolean(caps.find( c=>c.capability===IncyclistCapability.Control)?.selected)
            const rowLabels = {
                top: getPairingGuidanceText(getPairingRowLabelId(trainerSelected)),
                bottom: getPairingGuidanceText('row-optional'),
            }

            const buttons = this.getButtonsDisplayProps()

            return {
                title,
                readyToStart: this.canStartRide(),
                status,
                capabilities: { top, bottom, rowLabels },
                interfaces,
                deviceSelection: this.getDeviceListDisplayProps(),
                buttons,
                showInterfaceSettings: this.getInterfaceSettingsDisplayProps(),
            }
        }
        catch(err) {
            this.logError(err,'getPageDisplayProperties')
            return {
                title,
                capabilities: { top:[], bottom:[] },
                interfaces: [],
                buttons: [{ label:'Skip', primary:true, onClick:this.onSkip.bind(this) }],
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
            .catch( err=>{ this.logError(err,'onDeviceSelected') })

        this.updatePage()
    }

    // closing the list never unselects: unselecting is done from the tile
    protected closeDeviceSelection() {
        this.logEvent( {message:'capability closed', capability:this.openedCapability})

        this.getDevicePairing().stopDeviceSelection()
            .catch( err=>{ this.logError(err,'closeDeviceSelection') })
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
            onClick: ()=>{ this.openInterfaceSettings(name) }
        }
    }

    protected openInterfaceSettings(name:string):void {
        this.logEvent( {message:'interface clicked', interface:name, eventSource:'user'})
        this.interfaceSettingsFor = name
        this.updatePage()
    }

    protected closeInterfaceSettings():void {
        this.interfaceSettingsFor = undefined
        this.updatePage()
    }

    protected getInterfaceSettingsDisplayProps():DesktopInterfaceSettingsDisplayProps|undefined {
        const name = this.interfaceSettingsFor
        if (!name)
            return undefined

        const current = (this.state.interfaces??[]).find( i=>i.name===name)
        return {
            name,
            protocols: this.getDeviceAccess().getProtocols(name),
            enabled: current?.enabled??false,
            protocol: current?.protocol,
            port: current?.port,
            onOK: (settings:InterfaceSetting)=>{ this.onInterfaceSettingsChanged(name,settings) },
            onClose: ()=>{ this.closeInterfaceSettings() },
        }
    }

    public onInterfaceSettingsChanged( name:string, settings:InterfaceSetting):void {
        this.logEvent( {message:'interface settings changed', interface:name})
        this.getDevicePairing().changeInterfaceSettings(name,settings)
            .catch( err=>{ this.logError(err,'onInterfaceSettingsChanged') })
        this.closeInterfaceSettings()
    }

    /** Shift+S on desktop: adds a Simulator device, same as today's page.jsx onAddSimulator */
    public addSimulator():void {
        this.getDeviceConfiguration().add({name:'Simulator', interface:'simulator'} as IncyclistDeviceSettings)
        this.updatePage()
    }

    // navigation: whether to head for the ride or back to the content page is decided purely from
    // `isPairingForRide` - the same single flag mobile's onSimulate/onSkip already use - not from
    // any route/workout lookup. `onOK`/`onSimulate` still need their own override: desktop returns
    // to `source` (not `prevPage`), targets `/rideOK`/`/rideSimulate` instead of mobile's
    // `/rideDeviceOK`, and - unlike mobile - passes `source` on as router state, which RidePage
    // reads for its own Back/Delete/New-ride navigation (without it, those fall back to browser
    // history, landing back on this Pairing page instead of where "Start" was pressed from).

    protected onOK():void {
        this.closeVisit('ok')
        this.prepareForRide()
        this.getDevicePairing().setReadyToStart()
        this.getAppState().setState('paired',true)

        const pathname = this.isPairingForRide ? '/rideOK' : `/${this.getPrevContentPage()}`
        this.moveTo(pathname, true, {source:this.source})
    }

    protected onSimulate():void {
        this.closeVisit('simulate')
        const simulator = this.getDeviceConfiguration().getSimulatorAdapterId()
        this.prepareForRide([simulator])

        const pathname = this.isPairingForRide ? '/rideSimulate' : `/${this.getPrevContentPage()}`
        this.moveTo(pathname, true, {source:this.source})
    }

    protected onSkip():void {
        const via:PairingExitVia = this.isPairingForRide ? 'cancel' : 'skip'
        this.closeVisit(via)
        this.getDevicePairing().stop()
            .catch( err=>{ this.logError(err,'onSkip') })

        const pathname = this.source ?? `/${this.getPrevContentPage()}`
        this.moveTo(pathname)
    }

    @Injectable
    protected getDeviceAccess() {
        return useDeviceAccess()
    }
}
