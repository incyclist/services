import { EventLogger } from 'gd-eventlog'
import { Injectable, Singleton } from '../../base/decorators'
import { IncyclistPageService } from '../../base/pages'
import { useDevicePairing } from '../pairing'

import type { CapabilityDisplayProps, DeviceListDisplayProps, DeviceSelectionItemProps, DeviceSelectionProps, InterfaceDisplayProps, InterfaceDisplayState, IObserver, PairingButtonProps, PairingDisplayProps, TConnectState, TDisplayCapability, TIncyclistCapability } from '../../types'
import type { CapabilityData, InternalPairingState, PairingState} from '../pairing'
import { PairingPageStateMachine } from './statemachine'
import { PageLogObserver } from './logobserver'
import { EnrichedInterfaceSetting, InterfaceState } from '../access'
import { IncyclistCapability } from 'incyclist-devices'
import { useDeviceConfiguration } from '../configuration'
import { getBindings } from '../../api'



@Singleton
export class DevicesPageService extends IncyclistPageService { 

    protected promiseOpen:Promise<void>|undefined
    protected stateMachine: PairingPageStateMachine
    protected logObserver:PageLogObserver
    protected activeSelection: IncyclistCapability|undefined
    protected timeOutSelection: NodeJS.Timeout|undefined

    constructor() {
        super('Pairing')
        this.stateMachine = new PairingPageStateMachine()
        this.logObserver = new PageLogObserver('Pairing')
    }

    openPage():IObserver {

        this.logEvent({message:'page shown', page:'Pairing'})

        EventLogger.setGlobalConfig('page','Pairing')
        super.openPage()

        // shielding against duplicate calls
        if (this.promiseOpen!==undefined)  {
            return this.getPageObserver()
        }
       
        this.stateMachine.start( ()=>{
            this.getPageObserver().emit('page-update')
        })

        this.promiseOpen = new Promise<void> ((done)=> {
            this.start()
            .catch( (err)=>{this.logError(err,'openPage')})
            .finally(done)
        })
        .then( ()=>{delete this.promiseOpen})

        return this.getPageObserver()
    }

    closePage() {
        super.closePage()
        this.stop()
        this.stateMachine.stop()
    }

    pausePage() {
        console.log('# pause Pairing Page')
        this.stateMachine.pause()

    }
    resumePage() {
        console.log('# resume Pairing Page')
        this.stateMachine.resume()
    }


    getPageDisplayProperties():PairingDisplayProps {

        const caps = this.state.capabilities??[]
        const ifs = this.state.interfaces

        const interfaces = ifs.map( i=>this.getInterfaceDisplayProps(i) )
        const capProps = caps.map( c=>this.getCapabilityDisplayProps( c ))

        const loading = this.promiseOpen!=undefined
        const title = 'Devices'

        const CP = (cap:TIncyclistCapability) => capProps.find( c => c.capability===cap)

        const top = [
            CP('control'),
            CP('power'),
            CP('heartrate')
        ].filter( c=>c!==null && c!==undefined)
        const bottom = [
            CP('cadence'),
            CP('speed'),
            CP('app_control')
        ].filter( c=>c!==null && c!==undefined)


        const buttons = this.getButtonsDisplayProps()

        const onExit = ()=> {
            console.log('# Exit button clicked')
        }
        return {

            title,
            capabilities: { top, bottom},
            interfaces,
            deviceSelection: this.getDeviceListDisplayProps(),
            buttons,
            onExit
        }
    }


    protected getCapabilityDisplayProps(data:CapabilityData):CapabilityDisplayProps {
        const {capability:cap,deviceName, connectState,value,unit} = data

        const capability = this.getTCapability(cap)

        const adapaters = this.state.adapters

        const adapter = adapaters.find( ai=>data.selected && ai.udid===data.selected) 
        const ifName = adapter?.adapter?.getInterface()


        const header = { title:capability }
        const onClick = ()=> { this.openDeviceSelection(cap)}

        
        return {
            header, capability,deviceName, connectState,value:value?.toString(),unit,interface:ifName,
            onClick
        }

    }

    protected getInterfaceDisplayProps( info:EnrichedInterfaceSetting):InterfaceDisplayProps {
        const {name,state} = info

        const mapping:Record<InterfaceState,InterfaceDisplayState> = {
            connected: 'scanning',
            connecting: "idle",
            disconnected: "idle",
            disconnecting: 'idle',
            unavailable: 'error',
            unknown:'idle'
        
        }

        return {
            name, 
            state: mapping[state],             
        }

    }

    protected getDeviceListDisplayProps():DeviceSelectionProps|undefined {
        if (!this.activeSelection)
            return 

        const all = this.state.capabilities??[]
        const requested = all.find( c=>c.capability === this.activeSelection)

        const devices: Array<DeviceSelectionItemProps> = requested.devices.map( d=> ({
            connectState:d.connectState as TConnectState,
            deviceName: d.name,
            value: d.value,
            interface: d.interface,
            isSelected: d.selected,
            onClick: ()=> { this.getDevicePairing().selectDevice( this.activeSelection, d.udid)}

        }))

        return {
            capability: this.activeSelection,            
            devices,
            isScanning: this.stateMachine.state==='CapabilityScan',
            changeForAll: false,
            canSelectAll: this.activeSelection==='control',
            
            onClose: ()=>{ this.onCloseDeviceSelection()}

        }


    }

    protected startCapabilityScan( capability:IncyclistCapability) {

    }

    protected stopCapabilityScan() {

    }


    protected updatePage() {
        this.getPageObserver().emit('page-update')        
    }

    protected openDeviceSelection(cap:IncyclistCapability) {

        this.activeSelection = cap;
        //this.getDevicePairing().startDeviceSelection(cap,(state)=> {
        this.updatePage()
    }

    protected startDeviceSelectionTimeout() {
        this.stopDeviceSelectionTimeout()
        this.timeOutSelection = setTimeout( this.onDeviceSelectionTimeout.bind(this), 3000)

    }

    protected stopDeviceSelectionTimeout() {
        if (this.timeOutSelection) 
            clearTimeout(this.timeOutSelection)
        delete this.timeOutSelection
    }

    protected onDeviceSelectionTimeout() {
        delete this.timeOutSelection
    }

    protected async onCloseDeviceSelection() {
        this.activeSelection = undefined
        //await this.getDevicePairing().stopDeviceSelection()
        this.updatePage()
    }

    protected getButtonsDisplayProps() : PairingButtonProps{
        if (this.state.canStartRide) 
            return [
                { label:'OK', primary:true, onClick:this.onOK.bind(this) }
            ]

        
        return [
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


    protected onSkip():void {
        const nextPage = this.getAppState().getPersistedState('page')??'routes'        
        this.moveTo(`/${nextPage}`)

    }

    protected onOK():void {
        this.getDevicePairing().prepareStart()
        this.getDevicePairing().setReadyToStart()
        this.getAppState().setState('paired',true)
        
        this.moveTo('/rideDeviceOK')
    }

    protected onSimulate():void {

        const simulator = this.getDeviceConfiguration().getSimulatorAdapterId()
        this.getDevicePairing().prepareStart([simulator])

        this.moveTo('/rideSimulate')
    }

    protected onCancel():void {
        
        const nextPage = this.getAppState().getState('prevPage')
        this.moveTo(`/${nextPage}`)
    }


    protected moveTo( route:string, close:boolean=true) {
        if (!this.getUIBinding()) {
            console.log('# navigate to ',route)
        }
            

        this.getUIBinding().openPage(route)
        if (close) {
            this.closePage()
        }
    }



    protected async start( ) { 
        this.getDevicePairing().usage = 'page'
        await this.getDevicePairing().start( ()=>{})
    }

    async stop(adapters:Array<string>=[],forExit:boolean=false ):Promise<void> {
        return await this.getDevicePairing().stop(adapters,forExit)
    }

    protected get state():InternalPairingState {
        return this.getDevicePairing().getState()
    }

    protected getUIBinding() {
        return this.getBindings().ui
    }


    @Injectable
    protected getDevicePairing() {
        return useDevicePairing()
    }

    @Injectable
    protected getDeviceConfiguration() {
        return useDeviceConfiguration()
    }

    @Injectable 
    protected getBindings() {
        return getBindings()

    }
}

export const getDevicesPageService = ()=> new DevicesPageService()
