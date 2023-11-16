import EventEmitter from "events";
import { EventLogger } from "gd-eventlog";
import {AdapterFactory, AntDeviceSettings, DeviceSettings, IncyclistInterface, InterfaceFactory, SerialAdapterFactory, SerialPortProvider, SerialScannerProps} from "incyclist-devices";
import clone from "../../utils/clone";
import { merge } from "../../utils/merge";
import { sleep } from "../../utils/sleep";
import { AdapterInfo, DeviceConfigurationService, InterfaceSetting, useDeviceConfiguration } from "../configuration";
import { InterfaceList, ScanFilter, InterfaceState, InterfaceInfo, InterfaceAccessProps, ScanState, ScanForNewFilter, EnrichedInterfaceSetting } from "./model";

interface InternalScanState {
    promises: (Promise<DeviceSettings[]>)[]
    interfaces: IncyclistInterface[]
}

interface InterfaceInfoInternal extends InterfaceInfo {
    interface: IncyclistInterface
    unavailable?: boolean
}

interface onDataHandlersMap   {[index: string]: (...args)=>void}

/**
 * This service is used by the Front-End to manage the access to devices and interfaces
 * 
 * It can be used to enable/disable/configure the interfaces to be used. 
 * At the moment, the following interfaces are support:
 * - `serial`: SerialPort interface (requires to set `protocol`) in the interface properties
 * - `tcpip`: TCP/IP interface (requires to set `port`and  `protocol`) in the interface properties
 * - `ant`:  ANT+ interface
 * - `ble`: BLE interface
 * 
 * @example
 * ```
 * const {useDeviceAccess} = require('incyclist-services');
 * const {AntDevice} = require('incyclist-ant-plus/lib/bindings');
 * const {autoDetect} = require('@serialport/bindings-cpp')
 * const {TCPBinding} = require('incyclist-devices');
 * 
 * const service = useDeviceAccess()
 * 
 * service.setDefaultInterfaceProperties({connectTimeout:3000, scanTimeout:10000})
 * service.enableInterface('ant', AntDevice)
 * service.enableInterface('serial', autodetect(), {protocol:'Daum Classic'})
 * service.enableInterface('tcpip', TCPBinding, {port:51955, protocol:'Daum Premium'})
 * ```
 * 
 * (see [[enableInterface]], [[disableInterface]], [[setDefaultInterfaceProperties]], [[setInterfaceProperties]] for more details)
 * 
 * __Scanning__
 * It also can be used to perform a device scan across all enabled interfaces.
 * During the scan, filters can be used to limit the interfaces or device types to be scanned upon
 * 
 * @example
 * ```
 * service.on('device', (device:DeviceSetting)=>{ \/* do something *\/})
 * const detected = await scan();
 * ```
 * 
 * (see [[scan]], [[stopScan]] for more details)
 * 
 * __Connecting/Checking Interface State__
 * Some interfaces(`ble` and `ant`) are not supported on all computers, because they require a USB Stick/driver to be installed
 * Is is recommended that you check the connection, or instruct this service to perform an autoConnect (by setting `autoConnect:true` in the properties during [[enableInterface]]). 
 * If the autoConnect is enabled, the service will continously try to establish a connection to the interface and emits a `interface-changed` event whenever the  connection status changes
 * 
 * @example
 * ```
 * service.on('interface-changed', (iface:string,info:InterfaceInfo)=>{ \/* do something *\/})
 * const connected = await connect();
 * ```
 * 
 * (see [[connect]], [[disconnect]] for more details)
 *
 * 
 * @public
 * @noInheritDoc
 */
export class DeviceAccessService  extends EventEmitter{
    protected static _instance: DeviceAccessService
    protected interfaces: InterfaceList = {}
    protected scanState: InternalScanState
    protected logger:EventLogger
    protected defaultProps:InterfaceAccessProps

    static getInstance() {
        if (!DeviceAccessService._instance)
            DeviceAccessService._instance = new DeviceAccessService()
        return DeviceAccessService._instance;
    }

    constructor() {
        super()

        this.scanState = null;
        this.logger = new EventLogger('DeviceAccess')
        this.defaultProps = {}
    }

    protected logEvent(event) {
        this.logger.logEvent(event)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = global.window as any
        if (w?.SERVICE_DEBUG) {
            console.log('~~~ ACCESS-SVC', event)
        }
    }

    /**
     * Sets the default properties
     * 
     * These will be used if there are no properties given in an [[enableInterface]] call for an interface
     * 
     * @param props Properties to be used as default ( e.g. scan timeout)
     */
    setDefaultInterfaceProperties(props:InterfaceAccessProps) {
        this.defaultProps = props;
    }

    /**
     * Enables an interface to be used for device access
     * 
     * only enabled interfaces will be considered during device scans and connection attempts
     * 
     * 
     * @param ifaceName the name of the interface (one of `ant`, `ble`, `serial`, `tcpip`)
     * @param binding the Binding class to be used. Upon first call the binding must be specified, otherwise the method will throw an `Error`. On subsequent calls ( to re-enable an interface that was disabled via [[disableInterface]]) the parameters binding and props are ignored
     * @param props Properties to be used. If no properites are provided, or some of the properties are not set, the default properties (see [[setDefaultInterfaceProperties]] will be used
     * 
     * @example
     * ```
     * // first call 
     * service.enableInterface('serial',autodetect(), {protocol:'Daum Premium})
     * // re-enablement
     * * service.enableInterface('serial')
     * ```
     */
    async enableInterface( ifaceName:string, binding?, props:InterfaceAccessProps={}):Promise<void> {
        try {

            if (binding)
                this.initInterface(ifaceName, binding,props)

            const existing = this.interfaces[ifaceName] as InterfaceInfoInternal
        
            if (!binding && !existing) {           
                this.logEvent( {message:'Interface has not been initialized with binding',interface:ifaceName})
                this.emit('interface-changed',ifaceName,{name:ifaceName,state:'unavailable',isScanning:false})
            }
           
                
            if (this.isScanning(ifaceName)) {
                this.logEvent( {message:'Illegal State, enable Interface cannot be called during an ongoing scan'})
                return;
            }
           

            if ( existing.enabled && ( 
                 (existing.state==='connected' && existing?.interface?.isConnected()) || existing.state==='connecting' ))  {
                return;
            }

            existing.enabled = true            
            const state = existing.interface.isConnected() ? 'connected' : 'disconnected'
            existing.state = state;

            merge(existing.properties||this.defaultProps, props)

            this.emit('interface-changed', ifaceName,{...existing})

            if (!existing.interface.isConnected()) {
                this.emit('interface-changed', ifaceName,{...existing, state:'connecting'})
                const conected = await this.connect(ifaceName)
                const state = conected ? 'connected' : 'disconnected'
                this.emit('interface-changed', ifaceName,{...existing, state})

            }
    
    
        }
        catch(err) {
            this.logEvent({message:'Error', fn:'enableInterface',error:err.message,stack:err.stack})
        }
    }

   /**
     * Disables an interface 
     * 
     * By disabling an interface it will be omitted during device scans and connection attempts
     * 
     * If this method is called during an ongoing device scan on that interface, the ongoing scan will first be stopped before changing the interface enablement state
     * 
     * @param ifaceName the name of the interface (one of `ant`, `ble`, `serial`, `tcpip`)
     */
    async disableInterface( ifaceName:string, avalailable=true):Promise<void> {
        const existing = this.interfaces[ifaceName] as InterfaceInfoInternal
        if (!existing) 
            return;

        if (this.isScanning(ifaceName)) {
            try {
                const info:InterfaceInfoInternal = this.interfaces[ifaceName] as InterfaceInfoInternal;
                
                const stopped = await info.interface.stopScan()

                info.isScanning = !stopped
                this.emit('interface-changed', ifaceName,this.interfaces[ifaceName])
                if (stopped)
                    this.disableInterface(ifaceName)
                
            
            }
            catch(err) {
                this.logEvent({message:'Error', fn:'disableInterface',error:err.message, stack:err.stack})
            }
            
            
        }

        existing.enabled = false;
        await this.disconnect(ifaceName)
        //this.emit('interface-changed', ifaceName,this.interfaces[ifaceName])
        
        if (!avalailable) {
            existing.state = 'unavailable';
            (existing as InterfaceInfoInternal).unavailable = true;
            this.emit('interface-changed',ifaceName,{name:ifaceName,state:'unavailable',isScanning:false})
            return
        }

    }       

   /**
     * Set the current interface properties
     * 
     * This method allows to overwrite the interface properties for a given interface
     * 
     * If this method is called during an ongoing scan, the scan will be interrupted before the new properties will be set
     * 
     * @param ifaceName the name of the interface (one of `ant`, `ble`, `serial`, `tcpip`)
     * @param props Properties to be used. If no properites are provided, or some of the properties are not set, the default properties (see [[setDefaultInterfaceProperties]] will be used
     * 
     */
    setInterfaceProperties( ifaceName:string, props:InterfaceAccessProps):void {
        if (this.isScanning(ifaceName)) {
            const info:InterfaceInfoInternal = this.interfaces[ifaceName] as InterfaceInfoInternal;
            
            info.interface.stopScan().then( (stopped)=> {
                this.emit('interface-changed', 'ifaceName',this.interfaces[ifaceName])
                info.isScanning = !stopped
                if (stopped)
                    this.setInterfaceProperties(ifaceName,props)
            })
            return;
        }
        const info = this.interfaces[ifaceName]
        if (!info)
            return
        const properties = clone(this.defaultProps)
        merge(properties,props)
        info.properties = properties
        info.isScanning = false;
        this.emit('interface-changed', 'ifaceName',this.interfaces[ifaceName])
    }

   /**
     * Get interface information
     * 
     * This method provides information (e.g. scanning state, connection state) about an interface
     * 
     * @returns [[InterfaceInfo]] the information about the interface
     * 
     */

    getInterfaceInfo(ifaceName:string):InterfaceInfo {
        return this.interfaces[ifaceName]
    }

   /**
     * enrich interface configuration retrieved from DeviceConfiguration service with 
     * current status information from Access Service
     * 
     * This method provides information (e.g. scanning state, connection state) about an interface
     * 
     * @returns [[InterfaceInfo]] the information about the interface
     * 
     */
    enrichWithAccessState( interfaces:InterfaceSetting[] ) {
        return interfaces.map( i => {
            const info = this.interfaces[i.name]
            const enriched=Object.assign({},i) as EnrichedInterfaceSetting

            if(!info) {
                enriched.state = 'unavailable'
                enriched.isScanning = false
            }
            else {
                enriched.state = info.state
                enriched.isScanning = info.isScanning                
            }
            return enriched
        })
    }


    initInterface(ifaceName:string, binding, props:InterfaceAccessProps={}) {
        const existing = this.interfaces[ifaceName] as InterfaceInfoInternal

        if (!existing) {
            const properties = clone(this.defaultProps)            
            merge(properties, props)
            const info: InterfaceInfoInternal = { name:ifaceName,interface:InterfaceFactory.create(ifaceName,{binding}), enabled:false, isScanning:false, properties,state: 'unknown'}
            this.interfaces[ifaceName]= info
            info.interface.setBinding(binding)

            const keys = Object.keys(this.interfaces)
            const interfaces = keys.map( name=> ({...this.interfaces[name],name}) )

            this.emit('interface-changed', ifaceName,this.interfaces[ifaceName], interfaces)
        }
        else {
            const info = existing as InterfaceInfoInternal
            info.interface.setBinding(binding)
        }

    }

    protected getInterface( ifaceName:string):IncyclistInterface {
        const info = this.interfaces[ifaceName] as InterfaceInfoInternal
        return info?.interface
    }



   /**
     * Tries to open a connection to the interface. 
     * 
     * For serial and tcpip interface this will always return true -as long as a valid binding was used
     * For Ant+ and BLE, this will try to establish a connection to the USB port
     * 
     * 
     * 
     * 
     * @returns true if the interface could be connected, otherwise false
     */
   async connect( ifaceName?:string):Promise<boolean> {
    
        try {
            if (!ifaceName) {
                const interfaces = Object.keys(this.interfaces)
                interfaces.forEach( name=> { if (name) this.connect(name)})
                return;
            }
    
            if (this.interfaces[ifaceName]?.enabled===false)
                return

            const impl = this.getInterface(ifaceName) 
    
            if (!impl) {
                this.emit('interface-changed',ifaceName,{name:ifaceName,state:'unavailable',isScanning:false})
                this.interfaces[ifaceName].state = 'unavailable'
                return false;
            }
    
            const prevState = this.interfaces[ifaceName].state
            if (prevState==='connected')
                return true;
    
            this.interfaces[ifaceName].state = 'connecting'
            this.emit('interface-changed',ifaceName,{...this.interfaces[ifaceName],state:'connecting'})    
        
            const connected = await impl.connect()            
    
            const state:InterfaceState = connected ? 'connected': 'disconnected'
            this.interfaces[ifaceName].state = state
            
            this.emit('interface-changed',ifaceName,this.interfaces[ifaceName])
    
            return connected
    
        }
        catch(err) {
            this.logEvent({message:'Error', fn:'connect',error:err.message, stack:err.stack})
            return false
        }


    }

    private getScanTimeout(propsTimeout, interfaceSettingsTimeout) {
        if (propsTimeout) {
            if (propsTimeout===-1)
                return undefined
            else 
                return propsTimeout

        }
        else {
            return interfaceSettingsTimeout
        }
    }

   /**
     * Closes the connection to the interface. 
     * 
     * This will _not_ automatically stop all connected Device Adapters. This needs to be done seperately
     * 
     * @returns true if the interface could be disconnected, otherwise false
     */
   async disconnect( ifaceName?:string):Promise<boolean> {

    
        if (!ifaceName) {
            const promises = Object.keys(this.interfaces).map( i=> this.disconnect(i))
            const result = await Promise.allSettled(promises)
            const failed =  result.find(res => (res.status==='rejected' || (res.value===true) ))
            this.removeAllListeners()
            return failed===undefined
        }

        const impl = this.getInterface(ifaceName)
        if (!impl)
            return true;

        const prevState = this.interfaces[ifaceName].state
        this.interfaces[ifaceName].state = 'disconnecting'
        this.emit('interface-changed',ifaceName,{...this.interfaces[ifaceName]})    
        const disconnected = await impl.disconnect()

        const state:InterfaceState = disconnected ? 'disconnected': prevState
        this.interfaces[ifaceName].state = state
        this.emit('interface-changed',ifaceName,{...this.interfaces[ifaceName]})

        return disconnected
    }
    
    /**
     * Performs a device scan. 
     * 
     * This will _not_ automatically stop all connected Device Adapters. This needs to be done seperately
     * 
     * @param filter [[ScanFilter]] allows to limit the search on specififc interfaces or capabilties
     * @returns [[DeviceSettings]][] a list of Devices that were detected during the scan
     */
    async scan( filter:ScanFilter={},props:{timeout?:number,includeKnown?:boolean }={} ): Promise<DeviceSettings[]> {
        this.logEvent({message:'device scan start', filter,props} )
        const detected = [];
        const onDataHandlers:onDataHandlersMap  = {}
        const {includeKnown=false} = props

    

        if (!this.isScanning()) {
            this.emitScanStateChange('start-requested')

            this.scanState={
                promises:[],
                interfaces:[]
            }

            const interfaces = this.scanState.interfaces = this.getInterfacesForScan(filter);            

            const adapters = []


            interfaces.forEach( (i:IncyclistInterface) => {

                const onData = (...args)=>{
                    if (i.getName()==='ant') {
                        const settings: AntDeviceSettings = { profile:args[0], interface:'ant', deviceID:args[1]}
                        const adapter = AdapterFactory.create( settings)
                        adapter.onDeviceData(args[2])
                        
                    }
                    else if (i.getName()==='ble') {
                        const adapter = AdapterFactory.create(args[0])
                        adapter.onDeviceData(args[1])
                        
                    }
                }

                const onDevice = async (deviceSettings)=>{ 
                    

                    // already found during this scan? ignore
                    if (!includeKnown) {
                        if (adapters.find(a=> a.isEqual(deviceSettings))) {
                            return;
                        }
    
                        if (filter.profile && deviceSettings.profile!==filter.profile) {
                            return;
                        }
                        if (filter.protocol && deviceSettings.protocol!==filter.protocol) {
                            return;
                        }
    
                        if (filter.protocols && !filter.protocols.includes(deviceSettings.protocol)) {
                            return
                        }
    
                    }

                    const adapter = AdapterFactory.create(deviceSettings)
                    if (filter.capabilities) {
                        let found = false;

                        filter.capabilities.forEach( capability => {
                            found = found || adapter.getCapabilities().includes(capability)
                        })                        

                        if (!found) {
                            return;
                        }
                    }

                    this.emit('device',deviceSettings )
                    adapters.push(adapter)
                    
                    adapter.on('device-info',(settings, info)=>{ 
                        this.emit('device-info',deviceSettings,{...info,displayName:adapter.getUniqueName()})                                                
                    })
                  
                    
                    detected.push(deviceSettings)
                }
    
                onDataHandlers[i.getName()] = onData
                i.on('device',onDevice)
                i.on('data',onDataHandlers[i.getName()])

                const ifaceName = i.getName()
                const info = this.interfaces[ifaceName]
                info.isScanning = true;
                const scanProps = info.properties||this.defaultProps
                const {scanTimeout, port, protocol} = scanProps;
                const timeout = this.getScanTimeout(props.timeout,scanTimeout)
                const properties = ifaceName==='tcpip' || ifaceName==='serial' ? {timeout,port:port?.toString(),protocol} as SerialScannerProps : {timeout:scanTimeout}

                this.scanState.promises.push( i.scan(properties) )

                
            })
            this.emitScanStateChange('started')

            try {

                // if no interfaces are enabled, perform a dummy scan (simple timeout)
                // so that the user has a chance to press the hotkey for the simulator
                if (this.scanState?.promises.length===0) {
                    this.scanState?.promises.push(this.dummyScan()) 
                }
                
                await Promise.allSettled(this.scanState?.promises)
                
                
            }
            catch(err) {
                this.logEvent({message:'device scan finished with errors', filter, error:err.message, stack:err.stack})
            }

            this.scanState = null;
            interfaces.forEach( (i:IncyclistInterface) => {
                i.removeAllListeners('device')
                i.off('data',onDataHandlers[i.getName()])
                this.interfaces[i.getName()].isScanning = false;
            })
            adapters.forEach( adapter=>adapter.removeAllListeners('data'))


            this.emitScanStateChange('stopped')
            this.logEvent({message:'device scan finished', filter, detected} )
            return detected;    
        }
    }

    /**
     * Scans for devices that were not yet listed in the device configuration
     * 
     * This will _not_ automatically stop all connected Device Adapters. This needs to be done seperately
     * 
     * @param filter [[ScanFilter]] allows to limit the search on specififc interfaces or capabilties
     * @param maxDevices allows to limit the number of devices that should be detected (default:1)
     * @returns [[DeviceSettings]][]|[[DeviceSettings]] if [[maxDevices]] is set to 1, it will return the detected devices, otherwise it will return a list of Devices that were detected during the scan
     */

    async scanForNew( filter: ScanForNewFilter={}, maxDevices=1, timeout=30000): Promise<DeviceSettings[]|DeviceSettings> {
        
        const devices:DeviceSettings[] = []
        const configuration  = DeviceConfigurationService.getInstance()
        const knownAdapters = configuration.getAllAdapters()

        if (filter.blackList) {
            filter.blackList.forEach( device=> {
                const adapter = AdapterFactory.create(device)
                const capabilities = adapter.getCapabilities()
                knownAdapters.push( {udid:`temp-${Date.now()}`, adapter:AdapterFactory.create(device),capabilities } )
            })
        }

        let onDeviceHandler

        const waitForMaxDevices = ():Promise<DeviceSettings[]> => {
            const detectedAdapters: AdapterInfo[] = []

            return new Promise (resolve => {
                onDeviceHandler = (deviceSettings)=> {

                    const isNew  = knownAdapters.find( ai => ai.adapter.isEqual(deviceSettings))===undefined &&
                                   detectedAdapters.find( ai => ai.adapter.isEqual(deviceSettings))===undefined

                    if (isNew) {
                        const adapter = AdapterFactory.create(deviceSettings)
                        detectedAdapters.push({udid:`detected #${devices.length+1}`,adapter, capabilities:adapter.getCapabilities()})
                        devices.push(deviceSettings)
                        if (devices.length>=maxDevices) {
                            this.emit('new device',deviceSettings)
                            resolve(devices)
                        }
    
                    }
                    else {
                        this.logEvent({message:'skipped known device', ...deviceSettings})
                    }
                    
                }
                this.on('device',onDeviceHandler )
        
            })
        }

        const scanPromise = this.scan(filter)
        const devicePromise = waitForMaxDevices()
        const timeoutPromise = sleep(timeout)

        await Promise.race( [scanPromise,devicePromise,timeoutPromise])
        this.off('devices',onDeviceHandler)
        await this.stopScan()
        
        if (maxDevices===1)
            return devices[0]
        else 
            return devices

    }

    async getPaths(ifaceName:string): Promise<string[]> {
        if (ifaceName==='serial' || ifaceName==='tcpip') {
            const binding = SerialPortProvider.getInstance().getBinding(ifaceName)
            return (await binding.list()).map( info => info.path)            
        }
        return undefined
    }

    getProtocols(ifaceName:string) {
        if (ifaceName!=='serial' && ifaceName!=='tcpip')
            return [];

        if (ifaceName==='tcpip')
            return ['Daum Premium']

        return SerialAdapterFactory.getInstance().adapters.map(a=>a.protocol)
    }

    protected async dummyScan():Promise<DeviceSettings[]> {
        return new Promise<DeviceSettings[]>( done=> {

            const timeout = this.defaultProps.scanTimeout || 5000;
            const timeDone = Date.now()+timeout
            const iv = setInterval( ()=>{
                if (Date.now()>timeDone) {
                    clearInterval(iv)
                    done([])
                }

            }, 100)

            this.once('stop-requested', ()=>{
                clearInterval(iv)
                done([])
            })
        })
        
    }

    protected emitScanStateChange(state:ScanState) {
        this.emit('scanstate-changed',state)        
    }

    async stopScan():Promise<boolean> {
        if (!this.isScanning() )
            return

        this.emitScanStateChange('stop-requested')

        const interfaces = this.scanState.interfaces
        const promises = interfaces.map(i=>i.stopScan().catch())

        let result;
        try {
            result = await Promise.allSettled(promises)
        }
        catch(err) {
            this.logEvent({message:'stop device scan finished with errors', error:err.message, stack:err.stack} )
            return false;
        }


        this.scanState = null

        this.emitScanStateChange('stopped')
        this.logEvent({message:'stop device scan finished', stopScanresult: result} )
        return true;
    }

    isScanning( ifaceName?:string) {
        if (!this.scanState)
            return false;
        if (!ifaceName)
            return this.scanState!==null && this.scanState.promises!==null && this.scanState.promises.length>0
        else return this.interfaces[ifaceName].isScanning;
    }

    protected getInterfacesForScan( filter?:ScanFilter): IncyclistInterface[] {
        
        const filterSet = filter?.interfaces||filter?.capabilities||filter?.profile||filter?.protocol
        const {excludeDisabled} = filter||{}
        const keys = Object.keys(this.interfaces)

        const config = useDeviceConfiguration()
        
        
        const enabledInterfaces = keys.filter(i=> this.interfaces[i].enabled && config.isInterfaceEnabled(i) )
        const allInterfaces = keys

        
        const selectedInterfaces = filterSet&&!excludeDisabled ? allInterfaces : enabledInterfaces

        let interfaces = selectedInterfaces.map(name=>(this.interfaces[name] as InterfaceInfoInternal).interface);
        
        const interfaceFilter = filter?.interfaces
        if (interfaceFilter) {    
            const remaining = selectedInterfaces.filter(i=> interfaceFilter.includes(i))
            interfaces = remaining.map(name=>(this.interfaces[name] as InterfaceInfoInternal).interface);
        }

        return interfaces
    }


}

export const useDeviceAccess=() => DeviceAccessService.getInstance()


