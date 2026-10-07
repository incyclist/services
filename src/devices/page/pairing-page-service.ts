import { EventLogger } from 'gd-eventlog'
import { Injectable } from '../../base/decorators'
import { IncyclistPageService } from '../../base/pages'
import { useDevicePairing, PAIRING_CAPABILITY_ROLES, getCapabilityHelpText, getEmptyTileFooterText } from '../pairing'

import type { CapabilityDisplayProps, DeviceSelectionItemProps, DeviceSelectionProps, IObserver, PairingButtonProps, PairingDisplayProps, TConnectState, TDisplayCapability, TIncyclistCapability } from '../../types'
import type { CapabilityData, DevicePairingData, InternalPairingState } from '../pairing'
import { PageLogObserver } from './logobserver'
import { IncyclistCapability } from 'incyclist-devices'
import { useDeviceConfiguration } from '../configuration'
import { useIncyclist } from '../../ui'
import { useDeviceRide } from '../ride'
import { usePairingVisitTracker } from './visit-log-factory'
import type { PairingVisitTracker } from './visit-log'
import type { PairingExitVia } from './types'
import type { PairingOrchestrator } from './orchestrator'

/**
 * Pairing page logic shared by all platforms: page lifecycle, device list, tile and button props,
 * navigation handlers and visit tracking.
 *
 * Platform differences live in the abstract hooks: the orchestrator, the page display props and
 * any platform-only handlers in the subclass.
 */
export abstract class PairingPageService extends IncyclistPageService {

    protected promiseOpen:Promise<void>|undefined
    protected stateMachine: PairingOrchestrator
    protected logObserver:PageLogObserver
    protected openedCapability: IncyclistCapability|undefined
    protected isPairingForRide: boolean = false
    protected isVisitOpen: boolean = false

    constructor() {
        super('pairing')
        this.stateMachine = this.createOrchestrator()
        this.logObserver = new PageLogObserver('Pairing')
    }

    /** The orchestrator that drives the pairing lifecycle for this platform. */
    protected abstract createOrchestrator(): PairingOrchestrator

    /** The display props for this platform's pairing screen. */
    abstract getPageDisplayProperties(): PairingDisplayProps

    openPage(forRide?:boolean):IObserver {
        try {
            this.logEvent({message:'page shown', page:'Pairing', forRide})
            this.isPairingForRide = forRide??false
            this.openVisit()

            EventLogger.setGlobalConfig('page','Pairing')
            super.openPage()

            // shielding against duplicate calls
            if (this.promiseOpen!==undefined)  {
                return this.getPageObserver()
            }

            const onStateMachineUpdate = ()=>{
                this.getPageObserver().emit('page-update')
            }

            this.stateMachine.start( onStateMachineUpdate)

            // self-heal: start() is a no-op (and logs an error) if the state machine wasn't
            // in 'Closed' state - this can happen if a previous session got stuck (e.g. an
            // earlier pairing/scanning reentrancy issue) and was never cleanly stopped. Without
            // this, openPage() would silently continue without ever wiring up
            // stateChangeCallback, leaving the Pairing screen stuck with no further updates.
            if (this.stateMachine.state!=='Idle') {
                this.logEvent({message:'state machine was not in expected state on open, resetting', page:'Pairing', state:this.stateMachine.state})
                this.stateMachine.stop()
                this.stateMachine.start( onStateMachineUpdate)
            }

            this.promiseOpen = new Promise<void> ((done)=> {
                this.start()
                .catch( (err)=>{this.logError(err,'openPage')})
                .finally(done)
            })
            .then( ()=>{delete this.promiseOpen})


            }
        catch(err)  {
            this.logError(err,'openPage')

        }
        return this.getPageObserver()

    }

    closePage() {
        try {
            this.logEvent({message:'page closed', page:'Pairing'})
            this.isVisitOpen = false
            EventLogger.setGlobalConfig('page',null)
            this.isPairingForRide =false
            super.closePage()
            this.stop()
            this.stateMachine.stop()

        }
        catch(err) {
            this.logError(err,'closePage')
        }
    }

    async pausePage() {
        try {
            this.trackVisit( t=>t.onBackground({canStartRide:this.canStartRide()}), 'onBackground')
            await this.stateMachine.pause()
            this.logEvent({message:'page paused', page:'Pairing'})
        }
        catch(err) {
            this.logError(err,'pausePage')
        }
    }

    async resumePage() {
        try {
            this.trackVisit( t=>t.onForeground(), 'onForeground')
            this.stateMachine.resume()

            if (this.promiseOpen!==undefined)
                return;

            this.promiseOpen = new Promise<void> ((done)=> {
                this.start()
                .catch( (err)=>{this.logError(err,'openPage')})
                .finally(done)
            })


            await this.promiseOpen

            delete this.promiseOpen
            this.logEvent({message:'page resumed', page:'Pairing'})

        }
        catch(err) {
            this.logError(err,'pausePage')
        }

    }

    protected getCapabilityDisplayProps(data:CapabilityData, noSearch:boolean=false):CapabilityDisplayProps {
        const {capability:cap,deviceName, connectState,value,unit,disabled} = data

        const capability = this.getTCapability(cap)

        const adapaters = this.state.adapters??[]

        const adapter = adapaters.find( ai=>data.selected && ai.udid===data.selected)
        const ifName = adapter?.adapter?.getInterface()


        const title = this.getDisplayCapability(cap)
        const onClick = ()=> { this.openDeviceSelection(cap)}
        const onUnselect = data.selected ? ()=> { this.onCapabilityUnselect(cap) } : undefined


        const role = PAIRING_CAPABILITY_ROLES.find( r=>r.capability===cap)?.role
        const helpText = {
            full: getCapabilityHelpText(capability, 'full') ?? '',
            short: getCapabilityHelpText(capability, 'short') ?? '',
        }
        let emptyFooter: string | undefined = undefined
        if (noSearch)
            emptyFooter = 'Not searching'
        else if (role)
            emptyFooter = getEmptyTileFooterText(role)

        return {
            title, capability,deviceName:!disabled?deviceName:undefined, disabled, connectState,value:value?.toString(),unit,interface:ifName,
            role, helpText, emptyFooter,
            onClick, onUnselect
        }

    }

    protected getDeviceListDisplayProps():DeviceSelectionProps|undefined {

        if (!this.openedCapability)
            return

        const all = this.state.capabilities??[]
        const requested = all.find( c=>c.capability === this.openedCapability)
        const capDevices = requested?.devices??[]

        const devices: Array<DeviceSelectionItemProps> = capDevices.map( d=> ({
            connectState:d.connectState as TConnectState,
            deviceName: d.name,
            value: d.value,
            interface: d.interface,
            isSelected: d.selected,
            onClick: (addAll:boolean)=> {this.onDeviceSelected(d,addAll) },
            onDelete: ()=> {this.onDeviceDelete(d) }

        }))

        const disabled = devices.length>0 && !devices.some( d=> d.isSelected)

        return {
            capability: this.openedCapability,
            devices,
            isScanning: this.stateMachine.selectState==='Active',
            changeForAll: false,
            canSelectAll: this.openedCapability==='control',
            disabled,

            onClose: ()=>{ this.closeDeviceSelection()},

        }


    }

    protected updatePage() {
        this.getPageObserver().emit('page-update')
    }

    protected onEnableCapability(enabled:boolean) {
        const all = this.state.capabilities??[]
        const requested = all.find( c=>c.capability === this.openedCapability)
        requested.disabled = !enabled
        this.updatePage()

    }

    protected openDeviceSelection(cap:IncyclistCapability) {
        this.logEvent( {message:'capability clicked', capability:cap, eventSource:'user'})

        // the rider is searching this capability again, so it may pick up a device even if the
        // rider had turned the capability off before; other disabled capabilities stay off
        this.getDeviceConfiguration().disableCapability(cap,false)

        this.openedCapability = cap;
        this.stateMachine.onDeviceSelectionOpened( ()=>{ this.updatePage() })
        this.updatePage()
    }

    protected onDeviceSelected (d:DevicePairingData,addAll?:boolean) {
        const capability = this.openedCapability
        this.logEvent( {message:'device selected', capability, device:d.name})

        this.closeDeviceSelection()
        this.getDevicePairing().selectDevice( capability, d.udid,addAll)

        this.updatePage()
    }

    protected onCapabilityUnselect(cap:IncyclistCapability) {
        this.logEvent( {message:'capability unselect clicked', capability:cap, eventSource:'user'})

        this.getDevicePairing().unselectDevices(cap)

        this.updatePage()
    }

    protected onDeviceDelete (d:DevicePairingData) {
        const capability = this.openedCapability
        this.logEvent( {message:'device delete requested', capability, device:d.name})

        this.getDevicePairing().deleteDevice( capability, d.udid)

        this.updatePage()
    }


    // closing the list never unselects: unselecting is done from the tile
    protected closeDeviceSelection() {
        // diagnostic: production logs have shown this firing multiple times while the
        // Pairing screen was reportedly not the active page - the caller could not be
        // confirmed from static analysis alone, so capture the call stack to identify it
        // the next time this is captured in production.
        this.logEvent( {message:'capability closed', capability:this.openedCapability, caller:new Error().stack})

        this.openedCapability = undefined
        this.stateMachine.onDeviceSelectionClosed()
        this.updatePage()
    }

    protected getButtonsDisplayProps() : PairingButtonProps{
        if (this.state?.canStartRide)
            return [
                { label:'OK', primary:true, onClick:this.onOK.bind(this) }
            ]

        if (this.getDeviceRide().canEnforceSimulator()) {
            return [
                { label:'Simulate', primary:true, onClick:this.onSimulate.bind(this) },
                { label:'Skip', primary:false, onClick:this.onSkip.bind(this) }
            ]
        }

        return  [
            { label:'Skip', primary:true, onClick:this.onSkip.bind(this) }
        ]

    }

    protected getTCapability(capabability:IncyclistCapability):TIncyclistCapability {

        const mapping: Record<IncyclistCapability,TIncyclistCapability> = {
            'app_control': 'app_control',
            'cadence': 'cadence',
            'control': 'control',
            'heartrate' : 'heartrate',
            'power': 'power',
            'speed' : 'speed'
        }
        return mapping[capabability]

    }

    protected getDisplayCapability(capabability:IncyclistCapability):TDisplayCapability {
        const mapping: Record<IncyclistCapability,TDisplayCapability> = {
            'app_control': 'controller',
            'cadence': 'cadence',
            'control': 'resistance',
            'heartrate' : 'heartrate',
            'power': 'power',
            'speed' : 'speed'
        }
        return mapping[capabability]

    }


    protected trackVisit( fn:(tracker:PairingVisitTracker)=>void, name:string):void {
        try {
            fn(this.getPairingVisitTracker())
        }
        catch(err) {
            this.logError(err,name)
        }
    }

    protected openVisit():void {
        if (this.isVisitOpen)
            return
        this.trackVisit( t=>t.openVisit({forRide:this.isPairingForRide}), 'openVisit')
        this.isVisitOpen = true
    }

    protected closeVisit(via:PairingExitVia):void {
        this.trackVisit( t=>t.closeVisit(via,{canStartRide:this.canStartRide()}), 'closeVisit')
        this.isVisitOpen = false
    }

    protected canStartRide():boolean {
        return this.state?.canStartRide ?? false
    }

    protected onSkip():void {
        this.closeVisit('skip')
        const nextPage = this.getAppState().getPersistedState('page')??'routes'
        this.moveTo(`/${nextPage}`)

    }

    protected onOK():void {
        this.closeVisit('ok')
        this.getDevicePairing().prepareStart()
        this.getDevicePairing().setReadyToStart()
        this.getAppState().setState('paired',true)

        const prevContentPage = this.getPrevContentPage()
        const prevPage = this.getAppState().getState('prevPage')
        if (!prevPage) { // we just launched, go to content selection page
            this.moveTo(`/${prevContentPage}`)
        }
        else { // we were called from somewhere
            if (this.isPairingForRide)
                this.moveTo('/rideDeviceOK')
            else
                this.moveTo(`/${prevContentPage}`)

        }

    }

    protected onSimulate():void {
        this.closeVisit('simulate')
        const simulator = this.getDeviceConfiguration().getSimulatorAdapterId()
        this.getDevicePairing().prepareStart([simulator])

        const prevContentPage = this.getPrevContentPage()

        if (this.isPairingForRide)
            this.moveTo('/rideSimulate')
        else
            this.moveTo(`/${prevContentPage}`)
    }

    protected onCancel():void {
        this.closeVisit('cancel')
        const nextPage = this.getAppState().getState('prevPage')
        this.moveTo(`/${nextPage}`)
    }



    protected async start( ) {
        this.getDevicePairing().usage = 'page'
        this.getDevicePairing().start( ()=>{
            this.updatePage()
        })
    }

    async stop(adapters:Array<string>=[],forExit:boolean=false ):Promise<void> {
        return await this.getDevicePairing().stop(adapters,forExit)
    }

    protected get state():InternalPairingState {
        return this.getDevicePairing().getState()
    }



    @Injectable
    protected getDevicePairing() {
        return useDevicePairing()
    }
    @Injectable
    protected getDeviceRide() {
        return useDeviceRide()
    }

    @Injectable
    protected getDeviceConfiguration() {
        return useDeviceConfiguration()
    }


    @Injectable
    protected getIncyclist() {
        return useIncyclist()
    }

    @Injectable
    protected getPairingVisitTracker():PairingVisitTracker {
        return usePairingVisitTracker()
    }
}
