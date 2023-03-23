import EventEmitter from "events";
import { EventLogger } from "gd-eventlog";
import {AdapterFactory, AntDeviceSettings, DeviceSettings, IncyclistDeviceAdapter, IncyclistInterface, InterfaceFactory, SerialAdapterFactory} from "incyclist-devices";
import { SerialScannerProps } from "incyclist-devices/lib/serial/serial-interface";
import clone from "../../utils/clone";
import { merge } from "../../utils/merge";
import { sleep } from "../../utils/sleep";
import { useDeviceConfiguration } from "../configuration";
import { InterfaceList, ScanFilter, InterfaceState, InterfaceInfo, InterfaceAccessProps, ScanState } from "./model";

interface InternalScanState {
    promises: (Promise<DeviceSettings[]>)[]
    interfaces: IncyclistInterface[]
}

interface InterfaceInfoInternal extends InterfaceInfo {
    interface: IncyclistInterface
}

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
    enableInterface( ifaceName:string, binding?, props:InterfaceAccessProps={}):void {
        const existing = this.interfaces[ifaceName] as InterfaceInfoInternal

        if (!binding && !existing) {
            throw new Error('Interface has not been initialized with binding')
        }
       
        if (!existing) {
            const properties = clone(this.defaultProps)            
            merge(properties, props)
            const info: InterfaceInfoInternal = { name:ifaceName,interface:InterfaceFactory.create(ifaceName,{binding}), enabled:true, isScanning:false, properties,state: 'unknown'}
            this.interfaces[ifaceName]= info
            info.interface.setBinding(binding)

            const keys = Object.keys(this.interfaces)
            const interfaces = keys.map( name=> ({...this.interfaces[name],name}) )

            this.emit('interface-changed', ifaceName,this.interfaces[ifaceName], interfaces)
        }
            
        else  {                       
            if (this.isScanning(ifaceName)) {
                throw new Error( 'Illegal State, enable Interface cannot be called during an ongoing scan')
            }
            if (binding)
                existing.interface.setBinding(binding)
            existing.enabled = true            
            merge(existing.properties||this.defaultProps, props)
            this.emit('interface-changed', ifaceName,this.interfaces[ifaceName])
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
    disableInterface( ifaceName:string):void {

        const existing = this.interfaces[ifaceName]
        if (!existing) 
            return;
        
        if (this.isScanning(ifaceName)) {
            const info:InterfaceInfoInternal = this.interfaces[ifaceName] as InterfaceInfoInternal;
            
            info.interface.stopScan().then( (stopped)=> {
                this.emit('interface-changed', ifaceName,this.interfaces[ifaceName])
                info.isScanning = !stopped
                if (stopped)
                    this.disableInterface(ifaceName)
            })
            return;
        }

        existing.enabled = false;
        this.emit('interface-changed', ifaceName,this.interfaces[ifaceName])
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

    protected getInterface( ifaceName:string):IncyclistInterface {
        const info = this.interfaces[ifaceName] as InterfaceInfoInternal
        return info?.interface
    }



    async connect( ifaceName:string):Promise<boolean> {
        const impl = this.getInterface(ifaceName)

        if (!impl) {
            this.emit('interface-changed',ifaceName,{name:ifaceName,state:'unavailable',isScanning:false})
            return false;
        }

        const prevState = this.interfaces[ifaceName].state
        if (prevState==='connected')
            return true;

        this.interfaces[ifaceName].state = 'connecting'
        this.emit('interface-changed',ifaceName,this.interfaces[ifaceName])    
    
        const connected = await impl.connect()

        const state:InterfaceState = connected ? 'connected': 'disconnected'
        this.interfaces[ifaceName].state = state
        
        this.emit('interface-changed',ifaceName,this.interfaces[ifaceName])

        return connected
    }

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
        this.emit('interface-changed',ifaceName,this.interfaces[ifaceName])    
        const disconnected = await impl.disconnect()

        const state:InterfaceState = disconnected ? 'disconnected': prevState
        this.interfaces[ifaceName].state = state
        this.emit('interface-changed',ifaceName,this.interfaces[ifaceName])

        return disconnected
    }
    
    async scan( filter:ScanFilter={} ): Promise<DeviceSettings[]> {
        this.logger.logEvent({message:'device scan start', filter} )
        const detected = [];
        const startedAdapters:IncyclistDeviceAdapter[] = []

        if (!this.isScanning()) {
            this.emitScanStateChange('start-requested')

            this.scanState={
                promises:[],
                interfaces:[]
            }

            const interfaces = this.scanState.interfaces = this.getInterfacesForScan(filter);
            const adapters = []

            interfaces.forEach( (i:IncyclistInterface) => {
                i.on('device',async (deviceSettings)=>{ 

                    // already found during this scan? ignore
                    if (adapters.find(a=> a.isEqual(deviceSettings)))
                        return;

                    this.emit('device',deviceSettings )
                    const adapter = AdapterFactory.create(deviceSettings)
                    adapters.push(adapter)
                    
                    adapter.on('device-info',(settings, info)=>{ 
                        this.emit('device-info',deviceSettings,{...info,displayName:adapter.getUniqueName()})                                                
                    })
                  
                    
                    detected.push(deviceSettings)
                    const ifName = adapter.getSettings().interface

                    // at the moment, only ANT and BLE are transmitting data during the scan
                    if (ifName!=='ble' && ifName!=='ant') {
                        try {
                            await adapter.start()
                            while (this.scanState && this.scanState?.promises?.length>0 && adapter.started) {
                                await sleep(100)
                            }
                            try {
                                await adapter.stop()
                            }
                            catch(err) {
                                console.log(err)
                            }
                        }
                        catch(err) {
                            console.log('~~~ start error',err)
                        }
    
                    }

                })

                
                i.on('data',(...args)=>{
                    if (i.getName()==='ant') {
                        const settings: AntDeviceSettings = { profile:args[0], interface:'ant', deviceID:args[1]}
                        const adapter = AdapterFactory.create( settings)
                        adapter.onDeviceData(args[2])
                    }
                    else if (i.getName()==='ble') {
                        const adapter = AdapterFactory.create(args[0])
                        adapter.onDeviceData(args[1])
                    }
                })

                const ifaceName = i.getName()
                const info = this.interfaces[ifaceName]
                info.isScanning = true;
                const props = info.properties||this.defaultProps
                const {scanTimeout, port, protocol} = props;
                const properties = ifaceName==='tcpip' || ifaceName==='serial' ? {timeout:scanTimeout,port:port?.toString(),protocol} as SerialScannerProps : {timeout:scanTimeout}

                this.scanState.promises.push( i.scan(properties) )

                
            })
            this.emitScanStateChange('started')

            try {

                // if no interfaces are enabled, perform a dummy scan (simple timeout)
                // so that the user has a chance to press the hotkey for the simulator
                if (this.scanState.promises.length===0) {
                    this.scanState.promises.push(this.dummyScan()) 
                }
                
                await Promise.allSettled(this.scanState.promises)
                
                
            }
            catch(err) {
                this.logger.logEvent({message:'device scan finished with errors', filter, error:err.message, stack:err.stack})
            }

            this.scanState = null;
            interfaces.forEach( (i:IncyclistInterface) => {
                i.removeAllListeners('device')
                this.interfaces[i.getName()].isScanning = false;

                if (i.getName()==='tcpip')
                    this.interfaces[i.getName()]
            })


            this.emitScanStateChange('stopped')
            this.logger.logEvent({message:'device scan finished', filter, detected} )
            return detected;    
        }
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
        if (!this.isScanning())
            return

        this.emitScanStateChange('stop-requested')

        const interfaces = this.scanState.interfaces
        const promises = interfaces.map(i=>i.stopScan().catch())

        let result;
        try {
            result = await Promise.allSettled(promises)
        }
        catch(err) {
            this.logger.logEvent({message:'stop device scan finished with errors', error:err.message, stack:err.stack} )
            return false;
        }


        this.scanState.promises = []

        this.emitScanStateChange('stopped')
        this.logger.logEvent({message:'stop device scan finished', stopScanresult: result} )
        return true;
    }

    isScanning( ifaceName?:string) {
        if (!ifaceName)
            return this.scanState!==null && this.scanState.promises!==null && this.scanState.promises.length>0
        else return this.interfaces[ifaceName].isScanning;
    }

    protected getInterfacesForScan( filter?:ScanFilter): IncyclistInterface[] {
        const keys = Object.keys(this.interfaces)

        const config = useDeviceConfiguration()
        
        
        const enabledInterfaces = keys.filter(i=> this.interfaces[i].enabled && config.isInterfaceEnabled(i) )




        const interfaceFilter = filter?.interfaces
        let interfaces = enabledInterfaces.map(name=>(this.interfaces[name] as InterfaceInfoInternal).interface);
        if (interfaceFilter) {
            const remaining = enabledInterfaces.filter(i=> interfaceFilter.includes(i))
            interfaces = remaining.map(name=>(this.interfaces[name] as InterfaceInfoInternal).interface);
        }
        return interfaces
    }


}

export const useDeviceAccess=() => DeviceAccessService.getInstance()


