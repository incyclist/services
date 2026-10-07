import { IncyclistCapability } from 'incyclist-devices'

import { Injectable, Singleton } from '../../../base/decorators'

import { PairingPageService } from '../base/service'
import { createStateMachineOrchestrator } from './orchestrator'
import type { PairingOrchestrator } from '../base/orchestrator'

import { Observer } from '../../../base/types'
import type { InterfaceDisplayProps, InterfaceDisplayState, InterfaceSettingsDisplayProps, PairingDisplayProps, TIncyclistCapability, TInterface } from '../../../types'

import { EnrichedInterfaceSetting, InterfaceState, useDeviceAccess } from '../../access'
import { getPairingGuidanceText, getPairingRowLabelId, getPairingStatusDisplay, toPairingInterfaceStates } from '../../pairing'
import { useIncyclist } from '../../../ui'

/**
 * Pairing page for mobile. Mobile uses the state machine orchestrator and shows the Android exit
 * action and the BLE/WiFi interface states.
 */
@Singleton
export class MobilePairingPageService extends PairingPageService {

    protected openedInterfaceSettings!: TInterface
    protected interfaceSettingsObserver: Observer|undefined

    protected createOrchestrator(): PairingOrchestrator {
        return createStateMachineOrchestrator()
    }

    protected getUsageMode(): 'page' | 'direct' {
        return 'page'
    }

    getPageDisplayProperties():PairingDisplayProps {

        const title = 'Devices'

        const onExit = ()=> {
            try {
                const ui = this.getBindings().ui
                this.getIncyclist().onAppExit()
                    .then( ()=>{
                        ui.quit()
                    })
                    .catch( ()=>{})
            }
            catch(err) {
                this.logError(err,'onExit')
            }
        }

        try {
            const caps = this.state.capabilities??[]
            const ifs = this.state.interfaces??[]
            useDeviceAccess().enrichWithAccessState(ifs)

            const interfaces = ifs.map( i=>{ return this.getInterfaceDisplayProps(i) })

            const loading = this.promiseOpen!=undefined
            const status = getPairingStatusDisplay({
                platform: 'mobile',
                interfaces: toPairingInterfaceStates(ifs),
                capabilities: caps,
                canStartRide: this.canStartRide(),
                loading,
                rideMode: this.isPairingForRide,
            })
            const capProps = caps.map( c=>this.getCapabilityDisplayProps( c, status.id==='S1' ))

            const CP = (cap:TIncyclistCapability) => capProps.find( c => c.capability===cap)

            const top = [
                CP('control'),
                CP('power'),
                CP('speed')
            ].filter( c=>c!==null && c!==undefined)
            const bottom = [
                CP('heartrate'),
                CP('cadence'),
                CP('app_control')
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
                showInterfaceSettings: this.openedInterfaceSettings,
                buttons,
                onExit
            }

        }
        catch(err) {
            this.logError(err,'getPageDisplayProperties')
            return {
                title,
                capabilities: { top:[], bottom:[]},
                interfaces:[],
                buttons: [{ label:'Skip', primary:true, onClick:this.onSkip.bind(this) }],
                showInterfaceSettings: this.openedInterfaceSettings,
                onExit
            }

        }

    }


    public getInterfaceSettingsObserver():Observer {
        this.interfaceSettingsObserver = this.interfaceSettingsObserver??new Observer()
        return this.interfaceSettingsObserver

    }

    public getInterfaceSettingsDisplayProps():InterfaceSettingsDisplayProps {
        if (!this.openedInterfaceSettings)
            return

        const ifs = this.state.interfaces??[]
        const info = ifs.find( isd => isd.name == this.openedInterfaceSettings)

        return {
            state: this.mapInterfaceState(info.state),
            enabled: info.enabled,
        }

    }

    // not yet implemented: BleInterfaceSettings already calls these, but mobile has no backing
    // action for enable/disable/reconnect/refresh yet - pre-existing no-ops, unchanged by this move
    enableInterface( i?:TInterface) { /* not yet implemented */ }
    disableInterface( i?:TInterface) { /* not yet implemented */ }
    reconnectInterface( i?:TInterface) { /* not yet implemented */ }
    refreshInterface( i?:TInterface) { /* not yet implemented */ }


    closeInterfaceSettings() {
        this.openedInterfaceSettings = undefined
        this.interfaceSettingsObserver?.stop()
        this.updatePage()
    }

    protected mapInterfaceState( state:InterfaceState ):InterfaceDisplayState {
        const mapping:Record<InterfaceState,InterfaceDisplayState> = {
            connected: 'scanning',
            connecting: "idle",
            disconnected: "error",
            disconnecting: 'idle',
            unavailable: 'error',
            unknown:'idle'
        }

        return mapping[state]
    }

    protected getInterfaceDisplayProps( info:EnrichedInterfaceSetting):InterfaceDisplayProps {

        const {name,state} = info
        return {
            name,
            state: this.mapInterfaceState(state),
            onClick: ()=>{ this.openInterfaceSettings(name as TInterface)}
        }

    }

    protected openInterfaceSettings( i:TInterface) {
        this.openedInterfaceSettings = i
        this.updatePage()
    }

    @Injectable
    protected getIncyclist() {
        return useIncyclist()
    }
}

/** The pairing page service for mobile. Kept under its original name for existing callers. */
export { MobilePairingPageService as DevicesPageService }
