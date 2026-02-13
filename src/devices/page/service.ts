import { EventLogger } from 'gd-eventlog'
import { Injectable, Singleton } from '../../base/decorators'
import { IncyclistPageService } from '../../base/pages'
import { useDevicePairing } from '../pairing'

import type { CapabilityDisplayProps, DeviceListDisplayProps, DeviceSelectionItemProps, DeviceSelectionProps, InterfaceDisplayProps, InterfaceDisplayState, IObserver, PairingButtonProps, PairingDisplayProps, TConnectState, TDisplayCapability, TIncyclistCapability } from '../../types'
import type { CapabilityData, DevicePairingData, InternalPairingState, PairingState} from '../pairing'
import { PairingPageStateMachine } from './statemachine'
import { PageLogObserver } from './logobserver'
import { EnrichedInterfaceSetting, InterfaceState, useDeviceAccess } from '../access'
import { IncyclistCapability } from 'incyclist-devices'
import { useDeviceConfiguration } from '../configuration'
import { getBindings } from '../../api'



@Singleton
export class DevicesPageService extends IncyclistPageService { 

    protected promiseOpen:Promise<void>|undefined
    protected stateMachine: PairingPageStateMachine
    protected logObserver:PageLogObserver
    protected openedCapability: IncyclistCapability|undefined

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
        this.logEvent({message:'page closed', page:'Pairing'})        
        EventLogger.setGlobalConfig('page',null)
        super.closePage()
        this.stop()
        this.stateMachine.stop()
    }

    async pausePage() {
        await this.stateMachine.pause()
        this.logEvent({message:'page paused', page:'Pairing'})            
    }
    async resumePage() {
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


    getPageDisplayProperties():PairingDisplayProps {

        const caps = this.state.capabilities??[]
        const ifs = this.state.interfaces??[]
        useDeviceAccess().enrichWithAccessState(ifs)

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
        const {capability:cap,deviceName, connectState,value,unit,disabled} = data

        const capability = this.getTCapability(cap)

        const adapaters = this.state.adapters??[]

        const adapter = adapaters.find( ai=>data.selected && ai.udid===data.selected) 
        const ifName = adapter?.adapter?.getInterface()


        const title = this.getDisplayCapability(cap)
        const onClick = ()=> { this.openDeviceSelection(cap)}

        
        return {
            title, capability,deviceName:!disabled?deviceName:undefined, disabled, connectState,value:value?.toString(),unit,interface:ifName,
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
            onClick: (addAll:boolean)=> {this.onDeviceSelected(d,addAll) }

        }))

        const disabled = devices.length>0 && !devices.find( d=> d.isSelected)

        return {
            capability: this.openedCapability,            
            devices,
            isScanning: this.stateMachine.selectState==='Active',
            changeForAll: false,
            canSelectAll: this.openedCapability==='control',
            disabled,
            
            onClose: (enabled)=>{ this.closeDeviceSelection(enabled)},
            

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
        this.logEvent( {message:'capability clicked', capability:cap})

        this.openedCapability = cap;
        this.stateMachine.onDeviceSelectionOpened( ()=>{ this.updatePage() })       
        this.updatePage()
    }

    protected onDeviceSelected (d:DevicePairingData,addAll?:boolean) { 
        const capability = this.openedCapability
        this.logEvent( {message:'device selected', capability, device:d.name})       

        this.closeDeviceSelection(true)
        this.getDevicePairing().selectDevice( capability, d.udid,addAll)

        this.updatePage()
    }


    protected async closeDeviceSelection( enabled: boolean) {
        this.logEvent( {message:'capability closed', capability:this.openedCapability})

        if (!enabled) {
            const all = this.state.capabilities??[]
            const requested = all.find( c=>c.capability === this.openedCapability)
            this.getDevicePairing().unselectDevices(requested.capability)
        }

        this.openedCapability = undefined       
        this.stateMachine.onDeviceSelectionClosed()
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
