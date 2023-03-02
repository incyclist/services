import EventEmitter from "events";
import { EventLogger } from "gd-eventlog";
import {DeviceSettings, IncyclistInterface, InterfaceFactory,InterfaceProps} from "incyclist-devices";
import { SerialScannerProps } from "incyclist-devices/lib/serial/serial-interface";
import { IncyclistScanProps } from "incyclist-devices/lib/types/device";
import clone from "../../utils/clone";
import { merge } from "../../utils/merge";
import { InterfaceList, ScanFilter, InterfaceState, InterfaceInfo, InterfaceAccessProps } from "./model";

interface ScanState {
    promises: (Promise<DeviceSettings[]>)[]
    interfaces: IncyclistInterface[]
}

interface InterfaceInfoInternal extends InterfaceInfo {
    interface: IncyclistInterface
}

/**
 * Manages the access to devices and interfaces
 *  - Allows to scan for devices
 *  - Enable/Disable Interfaces
 * 
 * @public
 * @noInheritDoc
 */
export class DeviceAccessService  extends EventEmitter{
    protected static _instance: DeviceAccessService
    protected interfaces: InterfaceList = {}
    protected scanState: ScanState
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

    setDefaultInterfaceProperties(props:InterfaceAccessProps) {
        this.defaultProps = props;
    }

    enableInterface( ifaceName:string, binding?, props:InterfaceAccessProps={}):void {
        const existing = this.interfaces[ifaceName] as InterfaceInfoInternal

        if (!binding ) {
            if (existing)
                existing.enabled=true;
            else
                throw new Error('Interface has not been initialized with binding')
        }

        
        if (!existing) {
            const properties = clone(this.defaultProps)            
            merge(properties, props)
            const info: InterfaceInfoInternal = { name:ifaceName,interface:InterfaceFactory.create(ifaceName,{binding}), enabled:true, isScanning:false, properties,state: 'unknown'}
            this.interfaces[ifaceName]= info
        }
            
        else  {
            if (this.isScanning(ifaceName)) {
                throw new Error( 'Illegal State, enable Interface cannot be called during an ongoing scan')
            }
            existing.interface.setBinding(binding)
            existing.enabled = true            
            merge(existing.properties||this.defaultProps, props)
        }
        this.emit('interfaces-changed', this.interfaces)
    }

    disableInterface( ifaceName:string):void {
        const existing = this.interfaces[ifaceName]
        if (!existing) 
            return;
        
        if (this.isScanning(ifaceName)) {
            const info:InterfaceInfoInternal = this.interfaces[ifaceName] as InterfaceInfoInternal;
            
            info.interface.stopScan().then( (stopped)=> {
                this.emit('interfaces-changed', this.interfaces)
                info.isScanning = !stopped
                if (stopped)
                    this.disableInterface(ifaceName)
            })
            return;
        }

        existing.enabled = false;
        this.emit('interfaces-changed', this.interfaces)
    }
        


    protected getInterface( ifaceName:string):IncyclistInterface {
        const info = this.interfaces[ifaceName] as InterfaceInfoInternal
        return info?.interface
    }

    setInterfaceProperties( ifaceName:string, props:InterfaceAccessProps):void {
        if (this.isScanning(ifaceName)) {
            throw new Error( 'Illegal State, enable Interface cannot be called during an ongoing scan')
        }
        const info = this.interfaces[ifaceName]
        if (!info)
            return
        const properties = clone(this.defaultProps)
        merge(properties,props)
        info.properties = properties
    }

    async connect( ifaceName:string):Promise<boolean> {

        const impl = this.getInterface(ifaceName)
        if (!impl) 
            return false;

        this.interfaces[ifaceName].state = 'connecting'
        this.emit('interface-state-changed',ifaceName,'connecting')    
    
        const connected = await impl.connect()

        const state:InterfaceState = connected ? 'connected': 'disconnected'
        this.interfaces[ifaceName].state = state
        this.emit('interface-state-changed',ifaceName,state)

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

        const disconnected = await impl.disconnect()
        return disconnected
    }
    
    async scan( filter:ScanFilter={} ): Promise<DeviceSettings[]> {
        this.logger.logEvent({message:'device scan start', filter} )
        const detected = [];

        if (!this.isScanning()) {
            this.scanState={
                promises:[],
                interfaces:[]
            }

            const interfaces = this.scanState.interfaces = this.getInterfacesForScan(filter);
            

            interfaces.forEach( (i:IncyclistInterface) => {

                i.on('device',(deviceSettings)=>{ 
                    this.emit('device',deviceSettings )
                    detected.push(deviceSettings)
                })

                const ifaceName = i.getName()
                const info = this.interfaces[ifaceName]
                info.isScanning = true;
                const props = info.properties||this.defaultProps
                const {scanTimeout, port, protocol} = props;
                const properties = ifaceName==='tcpip' || ifaceName==='serial' ? {timeout:scanTimeout,port:port?.toString(),protocol} as SerialScannerProps : {timeout:scanTimeout}
                console.log('~~~ scanning', ifaceName, properties)

                if (!i.isConnected()) {                    
                    this.scanState.promises.push( 
                        this.connect(i.getName()).then(()=> {
                            
                            return i.scan(properties)
                        })                        
                    )
                }
                else {
                    this.scanState.promises.push( i.scan(properties) )
                }

                
            })
            this.emit('scan-started')

            try {
                await Promise.allSettled(this.scanState.promises)
            }
            catch(err) {
                this.logger.logEvent({message:'device scann finished with errors', filter, error:err.message, stack:err.stack})
            }

            this.scanState = null;
            interfaces.forEach( (i:IncyclistInterface) => {
                i.removeAllListeners('device')
                this.interfaces[i.getName()].isScanning = false;
            })

            this.emit('scan-stopped')
            this.logger.logEvent({message:'device scan finished', filter, detected} )
            return detected;    
        }
    }

    async stopScan():Promise<boolean> {
        if (!this.isScanning())
            return

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
        this.emit('scan-stopped')
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
       
        const enabledInterfaces = keys.filter(i=> this.interfaces[i].enabled)
        const interfaceFilter = filter?.interfaces
        let interfaces = enabledInterfaces.map(name=>(this.interfaces[name] as InterfaceInfoInternal).interface);
        if (interfaceFilter) {
            const remaining = enabledInterfaces.filter(i=> interfaceFilter.includes(i))
            interfaces = remaining.map(name=>(this.interfaces[name] as InterfaceInfoInternal).interface);
        }
        return interfaces
    }



}

const useDeviceAccess=() => DeviceAccessService.getInstance()
export {useDeviceAccess}

