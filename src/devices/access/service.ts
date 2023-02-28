import EventEmitter from "events";
import { EventLogger } from "gd-eventlog";
import {DeviceSettings, IncyclistInterface, InterfaceFactory} from "incyclist-devices";
import { IncyclistScanProps } from "incyclist-devices/lib/types/device";
import { InterfaceList, ScanFilter } from "./model";

interface ScanState {
    promises: (Promise<DeviceSettings[]>)[]
    interfaces: IncyclistInterface[]
}


/**
 * Manages the access to devices and interfaces
 *  - Allows to scan for devices
 *  - Enable/Disable Interfaces
 * 
 * @public
 */
export class DeviceAccessService  extends EventEmitter{
    protected static _instance: DeviceAccessService

    interfaces: InterfaceList = {}

    scanState: ScanState
    logger:EventLogger

    static getInstance() {
        if (!DeviceAccessService._instance)
            DeviceAccessService._instance = new DeviceAccessService()
        return DeviceAccessService._instance;
    }

    constructor() {
        super()
        this.scanState = null;
        this.logger = new EventLogger('DeviceAccess')
    }

    enableInterface( ifaceName:string, binding?):void {

        const existing = this.interfaces[ifaceName]

        if (!binding ) {
            if (existing)
                existing.enabled=true;
            else
                throw new Error('Interface has not been initialized with binding')
        }

        if (!existing)
            this.interfaces[ifaceName]= { interface:InterfaceFactory.create(ifaceName,{binding}), enabled:true}
        else  {
            existing.interface.setBinding(binding)
            existing.enabled = true
        }
    }

    disableInterface( ifaceName:string):void {
        const existing = this.interfaces[ifaceName]
        if (existing)
            existing.enabled = false;
    }

    getInterface( ifaceName:string):IncyclistInterface {
        return this.interfaces[ifaceName]?.interface
    }

    async connect( ifaceName:string):Promise<boolean> {
        const impl = this.getInterface(ifaceName)
        if (!impl)
            return false;

        const connected = await impl.connect()
        return connected
    }

    async disconnect( ifaceName:string):Promise<boolean> {
        const impl = this.getInterface(ifaceName)
        if (!impl)
            return true;

        const disconnected = await impl.disconnect()
        return disconnected
    }
    
    async scan( args:{filter?:ScanFilter, props?:IncyclistScanProps} ): Promise<DeviceSettings[]> {

        const {filter={}, props={}} = args;

        this.logger.logEvent({message:'device scan start', filter} )
        const detected = [];

        if (!this.isScanning()) {
            this.scanState.promises = []
            

            const interfaces = this.scanState.interfaces = this.getInterfacesForScan(filter);
            

            interfaces.forEach( (i:IncyclistInterface) => {
                i.on('device',(deviceSettings)=>{ 
                    this.emit('device',deviceSettings )
                    detected.push(deviceSettings)
                })
                this.scanState.promises.push( i.scan(props) )
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

    isScanning() {
        return this.scanState!==null && this.scanState.promises!==null && this.scanState.promises.length>0
    }

    protected getInterfacesForScan( filter?:ScanFilter): IncyclistInterface[] {
        const keys = Object.keys(this.interfaces)
       
        const enabledInterfaces = keys.filter(i=> this.interfaces[i].enabled)
        const interfaceFilter = filter?.interfaces
        let interfaces = enabledInterfaces.map(name=>this.interfaces[name].interface);
        if (interfaceFilter) {
            const remaining = enabledInterfaces.filter(i=> interfaceFilter.includes(i))
            interfaces = remaining.map(name=>this.interfaces[name].interface);
        }
        return interfaces
    }





}

const useDeviceAccess=() => DeviceAccessService.getInstance()
export {useDeviceAccess}

