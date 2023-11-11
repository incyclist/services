import { DeviceAccessService, useDeviceAccess } from "../access/service";
import { AdapterInfo, CapabilityInformation, DeviceConfigurationInfo, DeviceConfigurationService, IncyclistDeviceSettings, InterfaceSetting, useDeviceConfiguration} from "../configuration";
import { CapabilityData, DevicePairingData, DevicePairingStatus, DeviceSelectState,  InternalPairingState,  PairingProps, PairingSettings, PairingState  } from "./model";
import {  DeviceData,  DeviceSettings,  IncyclistCapability, IncyclistDeviceAdapter } from "incyclist-devices";
import { AdapterStateInfo, DeviceRideService, useDeviceRide } from "../ride";
import clone from "../../utils/clone";
import { sleep } from "incyclist-devices/lib/utils/utils";
import { IncyclistService } from "../../base/service";


const Units = [
    { capability:IncyclistCapability.HeartRate, unit:'bpm', value:'heartrate', decimals:0},
    { capability:IncyclistCapability.Power, unit:'W', value:'power', decimals:0},
    { capability:IncyclistCapability.Speed, unit:'km/h', value:'speed', decimals:1},
    { capability:IncyclistCapability.Cadence, unit:'rpm', value:'cadence', decimals:0},
]

export const mappedCapability = (c:CapabilityInformation):CapabilityData => {

    const {devices} = c;

    const mapped = {...c} as unknown  as CapabilityData

    mapped.deviceNames = devices.map(d=>d.name).join(';')
    mapped.selected = devices.find( d => d.selected)?.udid
    mapped.deviceName = devices.find( d => d.selected)?.name
    mapped.interface = devices.find( d => d.selected)?.interface
    mapped.devices = devices as Array<DevicePairingData>

    return mapped
}

export const mappedCapabilities = (capabilities:DeviceConfigurationInfo):Array<CapabilityData>=> {
    const caps = []
    const ci = capabilities ? Object.keys(capabilities) || [] : []
    ci.forEach( name=> {
        const c = capabilities[name]
        caps.push(mappedCapability(c))
    })        
    return caps
}

const getInterfaceSettings = (ifName,v) => {
    if(!v)
        return {}
    return v.find(i=>i.name===ifName)
}

export interface Services{
    configuration?: DeviceConfigurationService
    access?: DeviceAccessService
    ride?: DeviceRideService

}

/**
 * Service to be used by device pairing screens
 * 
 * Device pairing is required to select the devices to be used by the user and verify the connection to all selected devices/sensors and interfaces
 * 
 * If the user already has selected devices (in previous launches) and at least a SmartTrainer or PowerMeter is connected, 
 * then the service will just try to connect with the devices/sensors.
 * 
 * If there are no devices (no SmartTrainer/Powermeter) configured yet, then the service will trigger a full scan
 * 
 * The service also allows to enable/disable the Interfaces (ant, ble,serial, tcpip) that should be used for the scan and verifies the connection state of these interfaces.
 * If an interface gets disabled by the user, then all device/sensors on this interface are exluded from pairing/scanning
 * 
 * This service depends on
 *  - [DeviceConfiguration Service](./doc/classes/DeviceConfigurationService.md)
 *  - [DeviceAccess Service](./doc/classes/DeviceAccessService.md)
 *  - DeviceRide Service
 * 
 * 
 * 
 * @noInheritDoc
 * 
 */
export class DevicePairingService  extends IncyclistService{

    protected static _instance: DevicePairingService

    protected configuration: DeviceConfigurationService
    protected access: DeviceAccessService
    protected rideService: DeviceRideService


    protected settings: PairingSettings={}
    protected state:InternalPairingState = { initialized:false}
    protected deviceSelectState:DeviceSelectState|null = null
    

    protected onPairingStartedHandler = this.onPairingStarted.bind(this)
    protected onPairingSuccessHandler = this.onPairingSuccess.bind(this)
    protected onPairingErrorHandler = this.onPairingError.bind(this)
    protected onDeviceDataHandler = this.onDeviceData.bind(this)
    protected onScanningDataHandler 
    protected onInterfaceConfigChangedHandler  = this.onInterfaceConfigChanged.bind(this)
    protected onConfigurationUpdateHandler = this.onConfigurationUpdate.bind(this)
    protected onInterfaceStateChangedHandler = this.onInterfaceStateChanged.bind(this)
    protected onDeviceDetectedHandler = this.onDeviceDetected.bind(this)

    static getInstance():DevicePairingService{
        if (!DevicePairingService._instance)
        DevicePairingService._instance = new DevicePairingService()
        return DevicePairingService._instance
    }

    constructor( services?:Services) {

        super('Pairing')

        // inject external dependencies
        if (services) {
            this.configuration = services.configuration
            this.access = services.access
            this.rideService = services.ride
        }

        this.state.initialized = false;
    }

   /**
     * Starts the pairing process
     * 
     * It will use the {@link DeviceConfigurationService} to read the current device and interface configuration
     * Depending on the device configuration, it will either trigger Pairing(connection with devices/sensors) 
     * or it will trigger a full scan. The full scan will timeout every 30s and will be repeated until either {@link stop} is called or sufficient devices were detected
     * 
     * @param onStateChanged callback to be called whenever the Pairing state changes which would require a re-rendering
     * 
     * @example 
     * const service = useDevicePairing()
     * service.start( (state:PairingState)=>{ 
     *   console.log('New State:', state)
     * })
     * 
     * @throws  
     * Does not throw errors
     * 
     * 
    */

    async start( onStateChanged: (newState:PairingState)=>void) {

        try {
            if (this.settings.onStateChanged) {
                this.settings.onStateChanged = onStateChanged
                this.emitStateChange(this.state)
                return;
            }
                
    
            await this.waitForInit()
            const {capabilities,interfaces} = this.configuration.load()
    
            this.state.capabilities = mappedCapabilities(capabilities)
            this.state.interfaces = this.access.enrichWithAccessState(interfaces)
            this.state.canStartRide = this.configuration.canStartRide()
            this.state.stopRequested = false
            this.state.stopped = false

            this.logCapabilities()

            this.state.interfaces.forEach( i=> {
                if (!this.isInterfaceEnabled(i.name))
                    this.disableAdaptersOnInterface(i.name)
                    
            })
    
            this.settings.onStateChanged = onStateChanged
            this.emitStateChange(this.state)
    
            this.initConfigHandlers();  
           
            this.run()    
    
        }
        catch (err) { // istanbul ignore next
            this.logError(err,'start')
        }
    }

    protected initConfigHandlers() {
        this.configuration.on('interface-changed', this.onInterfaceConfigChangedHandler);
        this.configuration.on('capability-changed', this.onConfigurationUpdateHandler);
        this.access.on('interface-changed', this.onInterfaceStateChangedHandler);
    }
    protected removeConfigHandlers() {
        this.configuration.off('interface-changed', this.onInterfaceConfigChangedHandler);
        this.configuration.off('capability-changed', this.onConfigurationUpdateHandler);
        this.access.off('interface-changed', this.onInterfaceStateChangedHandler);
    }

   /**
     * Stops the pairing process
     * 
     * Stop should be called as soon as the user leaves the Device Pairing Screen, as
     * this will free resources (event handlers) 
     * Also: The method will pause the devices, so that communication can be properly resumed once that ride is started/resumed
     * 
     * @example 
     * const service = useDevicePairing()
     * await service.stop())
     * 
     * @throws  
     * Does not throw errors
     * 
    */

   async stop():Promise<void> {
        this.logEvent({message:'Stop Pairing'})
        try {
            await this._stop();

            this.pauseAdapters(this.state.adapters);

            this.state.stopRequested = true;
            this.removeConfigHandlers()
            this.settings = {}
            this.state.initialized = false
        }
        catch (err) { // istanbul ignore next
            this.logError(err,'stop')
        }          
    }

   /**
     * Starts a device selection
     * 
     * Incyclist UI provides a screen to select a device/sensor of a certain capability (Control, Power, Heartrate, Speed, Cadence)
     * When this screen is shown, the service will automatically perform a background scan (no timeout)
     * to add any devices that can be detected
     * 
     * This method should be called to trigger this process. 
     * 
     * Whenever this is called, any ongoing pairing (initiated by {@link start}) will be stopped and restarted once {@link stopDeviceSelection} or {@link selectDevice} has been called
     * 
     * [!WARNING] There can be only one active device selection process. Calling this method twice without subsequent calls to {@link stopDeviceSelection} or {@link selectDevice} will lead to an unpredicated state
     * 
     * @param capability the capability to be managed <br><br> One of ( 'control', 'power', 'heartrate', 'speed', 'cadence')
     * @param onDeviceSelectStateChanged callback to be called whenever the content of the device list has changed and a re-render is required
     * 
     * @returns The initial state 
     * 
     * @example 
     * const service = startDeviceSelection(IncyclistCapability.Control, (state) => {
     *    console.log( 
     *         'Capability:', state.capability, 
     *         'Devices:', state.devices.map(d=>d.name).join(',') 
     *    )
     * })
     * 
     * @throws  
     * Does not throw errors
     * 
    */
   startDeviceSelection(capability:IncyclistCapability,onDeviceSelectStateChanged:(newState:DeviceSelectState)=>void):DeviceSelectState {

        try {

            const capabilityData = this.getCapability(capability)
            
            this.settings = Object.assign( this.settings||{}, {onDeviceSelectStateChanged,capabilityForScan:capability})
            const devices = capabilityData?.devices||[]
            const available = devices.filter( d=> this.isInterfaceEnabled(d.interface))

            const startScan = async () => {
                if( devices.length>0)
                    await this.stopAdaptersWithCapability(capability)

                this.stopPairing()
                this.emitStateChange({capabilities:this.state.capabilities})

                if( devices.length>0)
                    await this.stopAdaptersWithCapability(capability)

                this.run({enforcedScan:true} )
            }

            this.deviceSelectState = {capability, devices:available}

            if (devices.length===0) {
                startScan()                
            }
            else {              

                this.pauseScanDelay()
                  .then( ()=> {
                    if (this.deviceSelectState) 
                        startScan()
                })
            }

            return this.deviceSelectState
        }
        catch (err) { // istanbul ignore next
            this.logError(err, 'startDeviceSelection')
            return {capability, devices:[]}
        }
    }

   /**
     * Stops the device selection process
     * 
     * Stop should be called as soon as the user closes the device selection screen. This will stop the current scan and will free all resources (event handlers) 
     * 
     * This method will also automatically restart the pairing process
     * 
     * @example 
     * const service = useDevicePairing()
     * await service.stopDeviceSelection())
     * 
     * @throws  
     * Does not throw errors
     * 
    */
   async stopDeviceSelection() {
        try {
            return await this._stopDeviceSelection( !this.isPairing())
        }
        catch (err) { // istanbul ignore next
            this.logError(err, 'stopDeviceSelection')
        }
    }

   /**
     * Should be called when the user has selcted a device. This device will then become the active(selected) device for this capability.
     * Typically the UI will close the Device selectio screen. Therefore, this method will also internally call {@link stopDeviceSelection}
     * 
     * This method will also automatically restart the pairing process
     * 
     * @param capability the capability to be managed <br><br> One of ( 'control', 'power', 'heartrate', 'speed', 'cadence')
     * @param udid The unique device ID of the device to be selected
     * @param addAll if true, the device will be selected for all capability it supports
     * 
     * @example 
     * const service = useDevicePairing()
     * await service.selectDevice('control,'508c6bf1-3f2f-4e8d-bcef-bc1910bd2f07', true)
     * 
     * @throws  
     * Does not throw errors
     * 
    */
   async selectDevice(capability:IncyclistCapability,udid:string, addAll:boolean=false):Promise<void> {

        let changed:boolean = false;
    
        try {
            if (addAll) {
                const adapter = this.getDeviceAdapter(udid)
                const capabilities = adapter.getCapabilities()

                capabilities.forEach( (c,idx) => {
                    const shouldEmit = (idx===capabilities.length-1)
                    const wasChanged = this.selectCapabilityDevice(c,udid,shouldEmit)
                    changed = changed || wasChanged
                })
            }
            else {
                changed = this.selectCapabilityDevice(capability,udid)
            }        

            this.checkCanStart()
            await this._stopDeviceSelection(changed)      
    
        }
        catch (err) { // istanbul ignore next
            this.logError(err, 'selectDevice')
        }
    }

   /**
     * Should be called when the user want to delete a device. This device will then be removed from this capability
     * 
     * In case the debice was previously selected, the next device (by order in list) will become active
     * 
     * As the user might want to delete multiple devices, the screen will typically remain open
     * 
     * This method not stop an ongoing scan. I.e. if the device will be detected again in the scan, it will be re-added
     * 
     * @param capability the capability to be managed <br><br> One of ( 'control', 'power', 'heartrate', 'speed', 'cadence')
     * @param udid The unique device ID of the device to be selected
     * @param deleteAll if true, the device will be deleted in all capabilities it supports
     * 
     * @example 
     * const service = useDevicePairing()
     * await service.deleteDevice('control,'508c6bf1-3f2f-4e8d-bcef-bc1910bd2f07', true)
     * 
     * @throws  
     * Does not throw errors
     * 
    */
   async deleteDevice(capability:IncyclistCapability,udid:string, deleteAll:boolean=false):Promise<void> {
        try  {
            const cntSelected = this.numberOfSelectedCababilities(udid)
            const c = this.getCapability(capability)
            if (cntSelected===1 && c.selected===udid) {
                const adapter = this.getDeviceAdapter(udid)
                adapter.stop();
            }

            if (deleteAll) {
                const adapter = this.getDeviceAdapter(udid)
                const capabilities = adapter.getCapabilities()
                


                capabilities.forEach( (c,idx) => {
                    const shouldEmit = (idx===capabilities.length-1)
                    this.deleteCapabilityDevice(c,udid,shouldEmit)
                })

                
            }
            else {
                this.deleteCapabilityDevice(capability,udid)
            }        
    
        }
        catch(err) { // istanbul ignore next
            this.logError(err, 'deleteDevice')
        }
    }

   /**
     * Should be called when the user has changed the iterface settings ( enabled/disabled and interface)
     * 
     * If the enable state has changed it will then 
     * - unselect all devices of the given interface from all capabilities
     * - stop and restart any ongoing pairing or device selection process
     * 
     * @param name the name of the interface <br><br> One of ( 'ant', 'ble', 'tcpip', 'serial', 'cadence')
     * @param settings The updated settings
     * 
     * @example 
     * const service = useDevicePairing()
     * await service.changeInterfaceSettings('serial',{enabled:'true, protocol:''Daum Classic})
     * 
     * @throws  
     * Does not throw errors
     * 
    */
   async changeInterfaceSettings (name:string,settings:InterfaceSetting) {
        try {
            

            const _interface = this.state.interfaces.find( i=>i.name===name)
            const changed = settings.enabled !== _interface.enabled

            if(!changed)
                return

            this.configuration.setInterfaceSettings(name,settings)

            if (settings.enabled) {
                this.connectInterface(name)
            }
            else {
                this.stopAdaptersOnInterface(name)
                this.disconnectInterface(name)
            }

            
            this.emitStateChange()

            // restart pairing or scanning            
            await this.restart();            
            
        }
        catch (err) { // istanbul ignore next
            this.logError(err,'changeInterfaceSettings')
        }
    }


    private async restart() {
        await this._stop();
        this.run();
    }

    protected async _stop() {
        if (this.isPairing())
            await this.stopPairing();
        if (this.isScanning())
            await this.stopScanning();
    }


    protected getCapability(capability:IncyclistCapability|CapabilityData):CapabilityData {
        const target = typeof capability==='object' ? capability.capability: capability

        const {capabilities=[]} = this.state

        return capabilities.find( c=>c.capability===target)
    }

    protected getCapabilityDevice(capability:IncyclistCapability|CapabilityData,udid?:string):DevicePairingData {

        const c = this.getCapability(capability)
        if (!c?.devices)
            return

        if (udid) {
            return c.devices.find( d=> d.udid===udid)
        }
        else {
            return c.devices.find( d=> d.selected)
        }        
    }


    protected async onConfigLoaded  (capabilitiesLoaded:DeviceConfigurationInfo, interfacesLoaded:Array<InterfaceSetting>) {
        
        if (this.state.initialized)
            return

        this.state.capabilities = mappedCapabilities(capabilitiesLoaded)               
        this.state.canStartRide = this.configuration.canStartRide()
        this.state.interfaces = this.access.enrichWithAccessState(interfacesLoaded)
        this.state.initialized = true;

        this.emitStateChange()
       
    }


    protected waitForInit():Promise<void> {
        if (this.state.initialized)
            return;

        return new Promise( done => {
            this.access = this.access || useDeviceAccess();
            this.rideService = this.rideService || useDeviceRide()
            this.onScanningDataHandler= this.rideService.onData.bind(this.rideService)
            this.configuration  = this.configuration|| useDeviceConfiguration();            

            if (this.configuration.isInitialized()) {
                this.state.initialized = true;
                return done();
            }
            else {
                this.configuration.once('initialized' ,(capabilitiesLoaded:DeviceConfigurationInfo, interfacesLoaded:Array<InterfaceSetting>)=>{
                    this.onConfigLoaded(capabilitiesLoaded,interfacesLoaded)
                    done()
                })
                this.configuration.init()
    
            }
            
            
        })
    }
    
    protected getExternaState(toEmit:PairingState ): PairingState {

        const newState = toEmit || this.state
        const state =  {...newState} as InternalPairingState

        // remove internal ino
        delete state.adapters
        delete state.check
        delete state.scan
        delete state.initialized
        delete state.props

        return state
    }

    protected emitStateChange(newState?:PairingState) {

        const {onStateChanged,onDeviceSelectStateChanged} = this.settings||{}

        // don't send any updates if we are stopping
        if (this.state.stopRequested)
            return;

        // we don't want to share adapters with consumer
        const state= this.getExternaState(newState)

        if (onStateChanged && typeof onStateChanged ==='function') {
            onStateChanged( {...state}) 
        }

        if (onDeviceSelectStateChanged && typeof onDeviceSelectStateChanged==='function')
            onDeviceSelectStateChanged( this.getDeviceSelectionState() )
    }

    protected onInterfaceConfigChanged (ifName:string,settings:InterfaceSetting)  {

        const prev = this.state.interfaces;
        if (!prev)
            return;

        try {
            const current = getInterfaceSettings(ifName,prev)
            
            if (settings.enabled && !current.enabled) {
                const {port,protocol} = settings
                this.access.enableInterface(ifName,undefined, {port:Number(port),protocol})            
                this.enableAdaptersOnInterface(ifName)
            }
            else if (!settings.enabled && current.enabled) {    
                this.access.disableInterface(ifName)            
                this.disableAdaptersOnInterface(ifName)
                this.stopAdaptersOnInterface(ifName).catch(err=>{
                    this.logError(err,'stopAdaptersOnInterface()')
                })
            }
            else {
                return;
            }
            this.emitStateChange()

        }
        catch (err) { // istanbul ignore next
            this.logError(err,'onInterfaceConfigChanged()')
        }
   
    }

    protected mergeState(current,newState) {
        const {connectState,value,unit} = current

        newState.devices.forEach( d=>  {
        
            if (!current.devices || current.devices.length===0)
                return; 
            const cd = current.devices.find( c=> c.udid===d.udid )
            
            if (cd) {
                const {connectState, value,unit} = cd
                Object.assign(d,{connectState, value,unit})
            }
        })
        
        Object.assign(current,{...newState},connectState,value,unit)
   
    }

    protected onConfigurationUpdate (newCapabilities:DeviceConfigurationInfo) {
        try {
            const {capabilities} = this.state||{};
            const keys = Object.keys(newCapabilities)

            keys.forEach( key => {
                const newCap = newCapabilities[key]
                const current = capabilities.find( c=>c.capability===key)
                this.mergeState(current,mappedCapability(newCap))
            })

            this.checkCanStart()
        }
        catch (err) { // istanbul ignore next
            this.logError(err,'onConfigurationUpdate')   
        }     
        
        const {capabilities,canStartRide} = this.state||{};
       
        this.emitStateChange({canStartRide,capabilities })
    
    }

    protected async onInterfaceStateChanged  (ifName,ifDetails, interfacesNew? ) { 
        const prev = this.state.interfaces;

        const current = getInterfaceSettings(ifName,prev)

        const changed = ( current.state!==ifDetails.state || current.isScanning!==ifDetails.isScanning || current.enabled!==ifDetails.enabled)
        
        if (!changed) {
            return;
        }


        try {
           
            if (interfacesNew) {
                const getData = (i) => ( {name:i.name, enabled:i.enabled,state:i.state} )

                if ( !prev)
                    return (interfacesNew.map(getData))
                else {                            
                    interfacesNew.forEach( i=> this.onInterfaceStateChanged(i.name,i))
                }
            }
            else if (prev) {
                const changedIdx = prev.findIndex( i=>i.name===ifName)

                if (ifDetails.state==='disconnected' && current.state!=='disconnected') {
                    // set all devices to failed state
                    this.failAdaptersOnInterface(ifName)
                }
                else  if (ifDetails.state==='unavailable' && current.state!=='unavailable') {
                    // set all devices to failed state
                    this.disableAdaptersOnInterface(ifName)
                }
                
                if (changedIdx!==-1) {
                    prev[changedIdx].isScanning = ifDetails.isScanning
                    prev[changedIdx].enabled = ifDetails.enabled
                    prev[changedIdx].state = ifDetails.state
                }


                this.emitStateChange( {interfaces:this.state.interfaces})
                
            }

        }
        catch (err) { // istanbul ignore next
            this.logError(err,'onInterfaceChanged()')
        }
    }

    protected isInterfaceEnabled(target:string|InterfaceSetting) {
        
        const name = (typeof target ==='string') ? target: target.name; 
        if(name==='simulator')
            return true;
        const {interfaces } = this.state
        return interfaces.find( i=> i.name===name && i.enabled && i.state!=='unavailable')!==undefined
    }

    protected logCapabilities ( capabilities?:Array<CapabilityData>) {
        const ci = capabilities||this.state.capabilities
        ci.forEach( c=> {
            const {devices=[],disabled} = c;
            const deviceNames = devices.map(d=>d.name).join(';')
            const selected = devices.find( d => d.selected)?.name
            this.logEvent({message:'capability info', capability:c.capability,  devices: deviceNames,selected,disabled })
        })        
        return capabilities
    }

    protected initPairingCallbacks():void {
        this.rideService.on('pair-success',this.onPairingSuccessHandler)
        this.rideService.on('pair-error',this.onPairingErrorHandler)
        this.rideService.on('data', this.onDeviceDataHandler)
    }

    protected removePairingCallbacks():void {
        this.rideService.off('pair-success',this.onPairingSuccessHandler)
        this.rideService.off('pair-error',this.onPairingErrorHandler)
        this.rideService.off('data', this.onDeviceDataHandler)
    }

    protected initScanningCallbacks():void {
        this.access.on('device',this.onDeviceDetectedHandler)
        this.access.on('data', this.onDeviceDataHandler)
    }

    protected removeScanningCallbacks():void {
        this.access.off('device',this.onDeviceDetectedHandler)
        this.access.off('data', this.onDeviceDataHandler)    
        this.deregisterScanningDataHandlers()
    }



    protected onPairingStatusUpdate( udid:string, connectState:DevicePairingStatus,notify:boolean=true) {
        const capabilities=this.state.capabilities
        
        capabilities.forEach (c => {
            
            if (c.selected===udid) {                
                c.connectState = connectState
            }
            const device = this.getCapabilityDevice(c)
            if (device && device.udid===udid) {
                device.connectState = connectState
            }
        })
        if (notify) {
            if (this.settings.onStateChanged && typeof this.settings.onStateChanged === 'function') {
                this.settings.onStateChanged({capabilities})
            }   
        }
    }

    protected onPairingStarted() {

        const {capabilities} = this.state
        const toBeStarted = this.checkDevicePairingState();

        
        toBeStarted.forEach( ai=> {
            const {udid} = ai;           
            this.onPairingStatusUpdate(udid,'connecting',false)
        })
        if (this.settings.onStateChanged && typeof this.settings.onStateChanged === 'function') {
            this.settings.onStateChanged({capabilities})
        }
    }

    protected checkDevicePairingState() {
        const {adapters=[],capabilities} = this.state
        const toBeStarted = [];


        // check connection state of all selected devices
        capabilities.forEach(c => {

            const udid = c.selected;
            const info = adapters.find(ai => ai.udid === udid);
            if (!info?.adapter)
                return;

            if (!info.adapter.isStarted()) {
                if (toBeStarted.find(ai => ai.udid === udid) === undefined)
                    toBeStarted.push(info);
            }
            else {
                if (info.adapter.isPaused()) {
                    info.adapter.resume();
                }
                if (c.connectState !== 'connected')
                    this.onPairingStatusUpdate(udid, 'connected', false);
            }

        });
        return toBeStarted;
    }

    protected onPairingSuccess(info:AdapterStateInfo|string) {
        const udid = typeof info==='string' ? info : info?.udid
        this.onPairingStatusUpdate(udid,'connected')
    }

    protected onPairingError(info:AdapterStateInfo|string) {
        const udid = typeof info==='string' ? info : info?.udid
        this.onPairingStatusUpdate(udid,'failed')        
    }

    protected verifyNoRecentData(data:DeviceData, udid:string):boolean {
        const prev = this.state.data?.find( i=>i.udid===udid) 
        if (prev && prev.ts>Date.now()-1000) {
            return false;
        }
        else {
            if (!prev) {
                this.state.data.push({udid,data,ts:Date.now()})
            }
            else {
                prev.data = data;
                prev.ts = Date.now()
            }
            return true
        }

    }

    protected onDeviceData(data:DeviceData, udid:string) {
        
        const capabilities=this.state.capabilities

        if (!this.state.data) {
            this.state.data=[]
        }

        const canProcess = this.verifyNoRecentData(data,udid)
        if (!canProcess)
            return;

        capabilities.forEach( c=> {
            const unitInfo = Units.find( ui=> ui.capability === c.capability)
            const device =this.getCapabilityDevice(c,udid)

            if (unitInfo) {
                const value = data[unitInfo.value]?.toFixed(unitInfo.decimals)
                if (c.selected===udid) {
                    c.value = value
                    c.unit = unitInfo.unit
                }
                if (device) {
                    device.value = value
                    device.unit = unitInfo.unit
                }
            }
           
        })

    
        this.emitStateChange({capabilities})

    }

    protected onDeviceDetected(deviceSettings:IncyclistDeviceSettings) {

        this.logEvent({message:'device detected',device:deviceSettings})
        
        const udid = this.configuration.add(deviceSettings,{legacy:false})
        if(!udid) {
            this.logEvent({message:'device could not be added', reason:'add() failed'})
            return;
        }

        const adapter = this.configuration.getAdapter(udid)
        
        if (adapter) {
            this.markConnected(adapter, udid);

            if (this.isScanning()) {
                if ( this.state.scan.adapters.find( a=>a.udid===udid)===undefined  ) {
                    const handler = ( deviceSettings:DeviceSettings, data:DeviceData)=>{
                        this.onDeviceData(data,udid)
                    }
        
                    adapter.on('data',handler)
                    this.state.scan.adapters.push( {udid,adapter, handler})
                }
    
            }


            this.checkCanStart()
        }
        
        this.onPairingSuccess(udid)       
    }

    private markConnected(adapter: IncyclistDeviceAdapter, udid: string) {
        const capabilites = adapter.getCapabilities();

        capabilites.forEach(c => {
            const info = this.getCapability(c);
            let device = this.getCapabilityDevice(c, udid);

            if (device) {
                device.connectState = 'connected';
            }
            else {
                device = { udid, connectState: 'connected', selected: false, name: adapter.getUniqueName(), interface: adapter.getInterface() };
                info.devices.push(device);
            }

            if (info.selected === udid) {
                info.connectState = 'connected';
            }
        });
    }

    protected disconnectInterface(name:string):void {
        try {
            this.access.disableInterface(name)
        }
        catch(err) {
            this.logError(err,'disableInterface')
        }
    }

    protected connectInterface(name:string):void {
        try {
            this.access.enableInterface(name)        
        }
        catch(err) {
            this.logError(err,'enableInterface')
        }
    }


    protected checkCanStart():boolean {
        try {
            const prev = this.state.canStartRide

            const configReadyToRide = this.configuration.canStartRide() // we either have a power or a conto
            if (!configReadyToRide)
                return false;
            
            const control = this.getCapability(IncyclistCapability.Control)
            const power = this.getCapability(IncyclistCapability.Power)

            const canStartRide =   (control?.connectState!=='failed' || power?.connectState!=='failed')
            this.state.canStartRide = canStartRide

            if (this.state.canStartRide!==prev) {
                this.emitStateChange( {canStartRide})
            }
        }
        catch(err) {
            this.logError(err,'checkCanStart')
        }
        return this.state.canStartRide
    }

    protected checkPairingSuccess():boolean {

        const configReadyToRide = this.configuration.canStartRide() // we either have a power or a conto
        if (!configReadyToRide)
            return false;
        
        const control = this.getCapability(IncyclistCapability.Control)
        const power = this.getCapability(IncyclistCapability.Power)

        const success =   (control?.connectState==='connected' || power?.connectState==='connected')
        return success
    }


    private async stopScanning() {
        const props = this.state.props || {}
        if (this.isScanning()) {
            this.removeScanningCallbacks()
            this.pauseAdapters(this.state.adapters);
            this.logEvent({ message: 'Stop Scanning', props });
            await this.access.stopScan();
            this.cleanupScan()
        }
    }

    private async stopPairing() {
        const props = this.state.props || {}
        if (this.isPairing()) {
            this.removePairingCallbacks()
            this.pauseAdapters(this.state.adapters);

            this.logEvent({ message: 'Stop Pairing', props });
            await this.rideService.cancelStart();
            delete this.state.check
        }
    }

    protected async run(props:PairingProps={}):Promise<void> {

        this.emit('run')
        // pairing already ongoing ? stop previous paring
        if (this.isPairing() || this.isScanning()) {
            await this._stop()
        }
        if (this.state.stopRequested || this.state.stopped) {
            this.state.stopped = true;
            this.state.stopRequested = false
            return;
        }
            
        await this.waitForInit();
        await this.rideService.lazyInit()

        this.state.props= props 

        const adapters = this.state.adapters = this.configuration.getAdapters(false)

        const goodToGo = await this.rideService.waitForPreviousStartToFinish()
        if (!goodToGo)  {
            return;
        }

        const configOKToStart = this.configuration.canStartRide()

        if (this.state.stopRequested || this.state.stopped) {
            this.state.stopped = true;
            this.state.stopRequested = false
            return;
        }


        if (configOKToStart && !this.deviceSelectState && !props.enforcedScan) {
            await this.startPairing(adapters, props);

        }
        else {
            await this.startScanning(adapters, props);
        }
    }

    private async startPairing(adapters: AdapterInfo[], props: PairingProps) {
        this.emit('pairing-start');

        this.logEvent({ message: 'Start Pairing', adapters, props });

        // unpause /adapt connectState for started adapters
        this.processConnectedDevices(adapters);

        const selected = this.state.capabilities.map( c=>c.selected)

        const target = adapters.filter(ai => !ai.adapter.isStarted() && selected.includes(ai.udid));

        this.initPairingCallbacks();
        const selectedAdapters = target.map(ai=>({...ai, isStarted:false}))
        const promise = this.rideService.startAdapters(selectedAdapters, 'pair');
        this.state.check={promise}
        this.onPairingStarted();


        await this.state.check.promise;
        if (this.state.check)
            delete this.state.check

        this.emit('pairing-done');
        if (!this.checkPairingSuccess()) {
            this.logEvent({ message: 'Pairing done', adapters, props });
            await sleep(this.getPairingRetryDelay());
            if (!this.state.scan)
                this.run();
        }
    }

    private processConnectedDevices(adapters: AdapterInfo[]) {
        const started = adapters.filter(ai => ai.adapter.isStarted());
        started.forEach(ai => {
            if (ai.adapter.isPaused())
                ai.adapter.resume();

            this.state.capabilities.forEach(c => {
                if (c.selected === ai.udid)
                    c.connectState = 'connected';
                const device = this.getCapabilityDevice(c, ai.udid);
                if (device)
                    device.connectState = 'connected';
            });
        });
    }

    private async startScanning(adapters: AdapterInfo[], props: PairingProps) {
        const interfaces = this.state.interfaces.filter( i => this.isInterfaceEnabled(i))||[].map(i=>i.name)
        if (interfaces.length===0) {
            await sleep(500)
            this.run()
            return;
        }
        this.emit('scanning-start')

        this.logEvent({message:'Start Scanning',props})
        this.initScanningCallbacks()
        
        const timeout = props.enforcedScan ? 1000*60*60 /*1h*/ : undefined
        const promise = this.access.scan({excludeDisabled:true},{includeKnown:props.enforcedScan, timeout})
        this.state.scan = {promise, adapters:[]}
        this.onPairingStarted()

        try {
            await promise
            this.cleanupScan()
            this.checkCanStart()

        }
        catch(err) {
            this.logError(err,'start()->scan')
        }

        this.emit('scanning-done')
        

        // after timeout, re-start to either trigger pairing or scan again
        // we don't do this for enforced scans, as the don't have timeouts, i.e. are always trigger manually
        if (!props.enforcedScan) {
            this.cleanupScan()
            await sleep(500)            
            this.run()
        }

    }

    protected deregisterScanningDataHandlers() {
        const ai = this.state.scan?.adapters
        if (!ai)
            return;

        ai.forEach( a=>a.adapter.off('data',a.handler))
        delete this.state.scan.adapters
    }

    protected cleanupScan() {
        this.deregisterScanningDataHandlers()
        if (this.state?.scan)
            delete this.state.scan;
    }
    

    protected getPairingRetryDelay():number {
        return 1000;
    }

    protected getScanDelay():number {
        return 2000; // 2s delay
    }

    protected async pauseScanDelay():Promise<boolean> {

        const delay = this.getScanDelay()
        await sleep(delay)
        const interrupted = this.deviceSelectState!==undefined && this.deviceSelectState!==null


        return interrupted
    }

    protected getAdaptersOnInterface( ifaceName:string):AdapterInfo[]{
        const {adapters=[]} = this.state


        const target = adapters.filter( ai=> ai.adapter.getInterface()===ifaceName)
        return target
    }


    protected async stopAdaptersOnInterface( ifaceName:string, maxRetry=3) {
        
        let target = this.getAdaptersOnInterface(ifaceName)
        let tryCnt =0

        if (!target || target.length===0)
            return;

        do {
            const promises = target.map( ai => ai.adapter.stop())
            await Promise.allSettled(promises)

            target = target.filter(ai=> !ai.adapter.isStopped())
        }
        while (++tryCnt<maxRetry && target && target.length>0)
        

    }

    protected disableAdaptersOnInterface(name:string) {
        const target = this.getAdaptersOnInterface(name)
        const {capabilities} = this.state


        target.forEach( ai => {
            const {udid} = ai;
            capabilities.forEach( c=> {
                const device = this.getCapabilityDevice(c,udid)
                if (device) {
                    device.interfaceInactive = true
                    if (c.selected===udid) {
                        this.configuration.unselect(c.capability)
                        const alternative = c.devices.find( d=>!d.interfaceInactive)

                        if (alternative)
                            this.configuration.select( alternative.udid,c.capability)
                    }
                }
            })
        })
    }

    protected failAdaptersOnInterface(name:string) {
        const target = this.getAdaptersOnInterface(name)
        const {capabilities} = this.state

        target.forEach( ai => {
            const {udid} = ai;
            capabilities.forEach( c=> {
                const device = this.getCapabilityDevice(c,udid)
                if (device && !device.interfaceInactive) {
                    device.connectState = 'failed'
                    if (c.selected===udid) {
                        c.connectState = 'failed'
                    }
                }
            })
        })
    }

    protected enableAdaptersOnInterface(name:string) {
        const target = this.getAdaptersOnInterface(name)
        const {capabilities} = this.state

        target.forEach( ai => {
            const {udid} = ai;
            capabilities.forEach( c=> {
                const alternative = c.devices.find( d=>!d.interfaceInactive)

                const device = this.getCapabilityDevice(c,udid)                
                if(device)
                    delete device.interfaceInactive 

                if (!c.selected && alternative)
                    this.configuration.select( alternative.udid,c.capability)
            })
        })
    }



    protected getDeviceAdapter(udid:string) {
        const {adapters=[]} = this.state
        const target = adapters.find( ai=> ai.udid===udid )
        return target?.adapter
    }

    protected async stopAdaptersWithCapability( capability:IncyclistCapability|CapabilityData,udid?:string) {

        const c = this.getCapability(capability)
        const {adapters=[],capabilities} = this.state
        const maxRetries = 3;

        let target =  udid ? 
            adapters.filter( ai=> ai.udid!==udid && ai.adapter.hasCapability(c.capability) && ai.adapter.getInterface()!=='simulator' ) :
            adapters.filter( ai=> ai.adapter.hasCapability(c.capability) && ai.adapter.getInterface()!=='simulator' )
       
        // if one of the device is an Ant-Device, wee need to stop all other Ant-Devices
        // as Ant does not allow parallel scanning and pairing
        if (target.find( ai=>ai.adapter.getInterface()==='ant'))
            await this.stopAdaptersOnInterface('ant')
        
        const devicesToBeStopped =target
        let tryNo = 0;
        do {
            if (target) {
                const promises = target.map( ai => ai.adapter.stop())
                await Promise.allSettled(promises)
            }

            target = target.filter(ai=> !ai.adapter.isStopped())
        }
        while ( ++tryNo<maxRetries && target && target.length>0)

        devicesToBeStopped.forEach( ai=> {
            capabilities.forEach(c=> {
                if (c.selected===ai.udid)
                    c.connectState = 'paused'
            })
    
        })

       
    }


    protected pauseAdapters(adapters: AdapterInfo[],enforced=false) {
        const capabilities = this.state.capabilities;

        capabilities.forEach(c => {
            if (!enforced && !c.selected && c.connectState === 'failed')
                return;
            const adapter = adapters.find(ai => ai.udid === c.selected)?.adapter;
            adapter?.pause();

        });
    }


    protected getDeviceSelectionState():DeviceSelectState {
        const capability = this.settings.capabilityForScan
        const capabilityData = this.getCapability(capability)
        
        const devices = capabilityData?.devices||[]
        const available = devices.filter( d=> this.isInterfaceEnabled(d.interface))
        return {capability, devices:available}

    }

    protected emitDeviceSelectState(c:CapabilityData) {

        const devices = c.devices
        const update = clone({capability:c, devices})
        const {onDeviceSelectStateChanged} = this.settings

        if(onDeviceSelectStateChanged)
            onDeviceSelectStateChanged(update)

        this.checkCanStart()

    }

    protected selectCapabilityDevice(capability:IncyclistCapability,udid:string, emitUpdate:boolean=true):boolean { 
       
        const c = this.getCapability(capability)
        if (c.selected===udid)
            return false;

        const device = this.getCapabilityDevice(capability,udid)        
        c.value = device?.value
        this.configuration.select(udid,capability,{emit:emitUpdate})
        
        if (emitUpdate)
            this.emitStateChange( {capabilities:this.state.capabilities})
            
        return true;
    }

    protected deleteCapabilityDevice(capability:IncyclistCapability,udid:string,shouldEmit:boolean=true) { 
        const c = this.getCapability(capability)

        
        
        const target = this.getCapabilityDevice(c,udid)
        if (!target)
            return;

        // device is currently selected
        if (c.selected===udid) {
            this.configuration.unselect(capability,shouldEmit)
            c.value = undefined;
            c.connectState = undefined
        }
        
        this.configuration.delete(udid,capability,shouldEmit)
        this.emitStateChange( {capabilities:this.state.capabilities})
    }

    protected isScanning() {
        return this.state.scan!==undefined && this.state.scan!==null
    }

    protected isPairing() {
        return this.state.check!==undefined && this.state?.check!==null
    }

    protected async _stopDeviceSelection(changed:boolean) {
        this.deviceSelectState = null

        const wasScanning = this.isScanning()
        const stop = changed || this.isScanning()

        if (stop)
            await this._stop()

        this.emitStateChange({capabilities:this.state.capabilities})
        
        if (stop) {
            if (wasScanning)
                await this.stopAdaptersWithCapability(this.settings.capabilityForScan)
            this.run()
        }
    }

    private numberOfSelectedCababilities(udid: string) {
        return (this.state.capabilities || []).map(c => c.selected === udid ? 1 : 0).reduce((a, c) => a + c, 0);
    }


    
}


export const useDevicePairing = () => DevicePairingService.getInstance()



