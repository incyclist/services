import { AdapterFactory, IncyclistCapability, IncyclistDeviceAdapter, IncyclistInterface } from "incyclist-devices"
import { useUserSettings } from "../../settings"
import DevicesSettings, { IncyclistDeviceSettings, InterfaceSetting } from "./model/devices"
import { LegacyDeviceConnectionSettings, LegacyDeviceSelectionSettings, LegacySettings } from "./model/legacy"
import { v4 as generateUdid } from 'uuid';
import EventEmitter from "events";
import { merge } from "../../utils/merge";

interface DeviceAdapterList {[index: string]: IncyclistDeviceAdapter}

export interface DeviceInformation {
    name: string,
    udid: string,
    adapter: IncyclistDeviceAdapter
}

export interface CapabilityListDetails { 
    adapters:IncyclistDeviceAdapter[], 
    selectedIdx?: number,
    disabled?:boolean 
}


// TODO change return value of getCapabilityInfo to this format
export interface CapabilityListDetailsNew { 
    capability: IncyclistCapability|'bike'
    devices:DeviceInformation[], 
    selectedIdx?: number,
    disabled?:boolean 
}

/**
 * Manages the user configuration of devices and interfaces
 *  - Detected Devices and Sensors
 *  - Selected Devices and Sensors per Capability
 *  - Cycling Mode settings for all devices.
 *  - Enabled/Disabled Interfaces
 * 
 * @public
 */
export class DeviceConfigurationService  extends EventEmitter{

    // @internal
    static _instance: DeviceConfigurationService

    // Events

    /**
     * Triggered when the user settings have been read
     * @event
    */
    static readonly INITIALIZED = 'initialzed'

    /**
     * Triggered when a device has been added to the device settings
     * @event
    */
    static readonly DEVICE_ADDED = 'device-added'

    /**
     * Triggered when the settings of a device has changed in the device seetings 
     * @event
    */
    static readonly DEVICE_CHANGED = 'device-changed'

    static getInstance():DeviceConfigurationService{
        if (!DeviceConfigurationService._instance)
            DeviceConfigurationService._instance = new DeviceConfigurationService()
        return DeviceConfigurationService._instance
    }

    settings: DevicesSettings
    userSettings
    adapters: DeviceAdapterList = {}

    constructor() {
        super()
        this.userSettings = useUserSettings();
    }
    /**
     * Initializes the Device Settings
     * 
     * It will use the [[UserSettingsService]] to read the data and stores it in the [[settings]] property
     * 
     * The init method will check if the settings format is 
     * 
     * @event emits 'initialized'
     * 
     * 
    */
    async init():Promise<void> {
        await this.userSettings.init()
       
        if ( this.userSettings.get('devices',null)==null &&  (this.userSettings.get('gearSelection',null)!==null|| this.userSettings.get('connections',null)!==null)) {      

            const settings: LegacySettings= {};

            settings.connections = this.userSettings.get('connections',{}) as LegacyDeviceConnectionSettings
            settings.gearSelection = this.userSettings.get('gearSelection',{}) as LegacyDeviceSelectionSettings
            await this.initFromLegacy(settings)
            this.emit('initialized')
            

        }

        this.settings = {
            devices: this.userSettings.get('devices',[]),
            capabilities:this.userSettings.get('capabilities',[]),
            interfaces: this.userSettings.get('interfaces',[])
        }
        this.settings.devices.forEach( d=> this.adapters[d.udid] = AdapterFactory.create(d.settings))
        this.emit('initialized')
    }

    isInitialized() {
        return this.settings!==undefined
    }

    initFromLegacy(settings:LegacySettings={}):void {
        const {gearSelection,connections} = settings
        const {bikes=[], hrms=[]} = gearSelection||{}
        
        this.settings= {interfaces:[], devices:[], capabilities:[]}
        const {interfaces,devices,capabilities} = this.settings;

        interfaces.push( {name:'ant', enabled:connections?.ant?.enabled||true})
        interfaces.push( {name:'ble', enabled:true})
        interfaces.push( {name:'serial', enabled:connections?.serial?.enabled||true})
        interfaces.push( {name:'tcpip', enabled:connections?.tcpip?.enabled||false})

        bikes.forEach( bike=> {
            if (bike.protocol==='Simulator')
                bike.interface='simulator'

            // delete some legay properties
            const isSelected = bike.selected
            delete bike.selected
            delete bike.displayName
            // special case ANT - we need to remove name as all necessar information is in the DeviceId
            if (bike.interface==='ant')
                delete bike.name

            const adapter = AdapterFactory.create(bike);
            if (!adapter) {
                return;
            }
            const bikeSettings = adapter.getSettings()
            // special case ANT - we need to remove legacy protocol information as otherwise profile would be incorrectly interpreted
            if (bike.interface==='ant')
                delete bikeSettings.protocol

            const existing = devices.find( device=> adapter.isEqual(device.settings))
            const sameNameIdx = devices.findIndex( device=> device.settings.interface===bikeSettings.interface && device.settings.name===bikeSettings.name && !adapter.isEqual(device.settings))
            const sameNameDevice = sameNameIdx!==-1 ? devices[sameNameIdx] : undefined

            let udid = existing?.udid
            if (!existing) {
                udid=generateUdid()
                if (!sameNameDevice) {
                    devices.push( {udid, settings:bikeSettings})
                }
                else {
                    devices.push( {udid, settings:bikeSettings,displayName:adapter.getUniqueName()})
                    sameNameDevice.displayName = this.adapters[sameNameDevice.udid].getUniqueName()
                }
                
                this.adapters[udid] = adapter
            }

            // ensure that devices is included in capability device list, also ensures that capabilty exists
            ['bike',IncyclistCapability.Control, IncyclistCapability.Power].forEach( (cc:IncyclistCapability|'bike') => {            
                this.addToCapability(udid,cc)  
                if (isSelected) {               
                    const cap = cc as IncyclistCapability|'bike'
                    if (cap==='bike' || adapter.hasCapability(cap)) {
                        const selectedDevice = capabilities.find(c => c.capability===cap )
                        
                        selectedDevice.selected = udid
                    }
                }
            })
            
        })

        hrms.forEach( hrm=> {
            // delete some legay properties
            const isSelected = hrm.selected
            delete hrm.selected
            delete hrm.displayName
            // special case ANT - we need to remove name 
            if (hrm.interface==='ant') 
                delete hrm.name
            
            const adapter = AdapterFactory.create(hrm);
            if (!adapter) {
                return;
            }
            const hrmSettings = adapter.getSettings()
            // special case ANT - we need to remove legacy protocol information as otherwise profile would be incorrectly interpreted
            if (hrm.interface==='ant')
               delete hrmSettings.protocol

            const existing = devices.find( device=> {
                const equal = adapter.isEqual(device.settings)
                return equal
            })
            let udid = existing?.udid
            if (!existing) {
                udid=generateUdid()
                devices.push( {udid, settings:hrmSettings})
                this.adapters[udid] = adapter
            }
            this.addToCapability(udid,IncyclistCapability.HeartRate)  
            if (isSelected&& !settings.gearSelection.disableHrm) {               
                const cap = IncyclistCapability.HeartRate
                if (adapter.hasCapability(cap)) {
                    const selectedDevice = capabilities.find(c => c.capability===cap )
                    selectedDevice.selected = udid
                }
                
            }
        })

        if (gearSelection.disableHrm) {
            const hrmCapability = capabilities.find( c=>c.capability===IncyclistCapability.HeartRate)
            if (hrmCapability) {
                hrmCapability.disabled=true
                hrmCapability.selected=undefined
            }
            else 
                capabilities.push( {capability:IncyclistCapability.HeartRate, devices:[], selected:undefined, disabled:true})
        }

        this.userSettings.set('connections',{} /*null*/)
        this.userSettings.set('gearSelection',{} /*null*/)

        this.settings = { devices, capabilities, interfaces}
        this.updateUserSettings()
    }

    /**
     * Marks a device as selected for a given capability
     * 
     * @param device        The device (either specified by the adapter or via the [[DeviceSettings]])
     * @param capability    The cability for which the device should be marked as selected
     * 
     * 
     * @event emits 'device-changed'    in case the settings were changed
     * @event emits 'device-added'      in case the device was not yet known
    */

    select(device:IncyclistDeviceSettings|IncyclistDeviceAdapter, capability:IncyclistCapability|'bike'):void {

        const isAdapter = (device as IncyclistDeviceAdapter).getSettings!==undefined
        const deviceSettings:IncyclistDeviceSettings = isAdapter ? (device as IncyclistDeviceAdapter).getSettings() as IncyclistDeviceSettings: device as IncyclistDeviceSettings

        const adapter = AdapterFactory.create(deviceSettings)
        if (capability==='bike' && !adapter.getDefaultCyclingMode)  // verify that this is a Bike
            return;

        const isControl = adapter.hasCapability(IncyclistCapability.Control) 

        let udid = this.settings.devices?.find( d=> adapter.isEqual(d.settings))?.udid

        if (!udid) {
            if (!this.settings.devices)
                this.settings.devices = []
            udid = generateUdid() as string
            this.settings.devices.push( {udid,settings:adapter.getSettings()})
            this.emit('device-added',adapter.getSettings(),udid ) 
            
            this.adapters[udid] = adapter
        }

        // ensure that devices is included in capability device list. 
        // This also ensures that the capability exists
        this.addToCapability(udid,capability)  

        // mark device udid as selected in capability, remove disabled flag
        const capSettings = this.settings.capabilities?.find( c=>c.capability===capability)       
        capSettings.selected = udid
        if (capSettings.disabled)
            delete capSettings.disabled  

        this.emit('device-changed', capability)

        // the next to blocks are special logic to avoid that Controllable Devices are launched without really using them to Control
        // which could lead to conflicts

        // if we select a controllable device as hrm or any other non controllable source, make sure that this device is also selected as controllable
        if (isControl) {
            if (capability!=='bike' && capability!==IncyclistCapability.Control) {
                this.select(adapter,'bike')
                this.select(adapter,IncyclistCapability.Control)            
            }
            else {
                const otherCapabilties = this.settings.capabilities.filter( c=>c.capability!=='bike' && c.capability!==IncyclistCapability.Control && !c.disabled && c.selected!==udid)
                const selectedControllable = otherCapabilties.filter( c => this.adapters[c.selected].hasCapability(IncyclistCapability.Control))
                
                selectedControllable.forEach(c => {
                    if (adapter.hasCapability(c.capability)) {
                        this.select(adapter,c.capability)
                    }
                    else 
                        this.unselect(c.capability)
                })
            }
        }

        this.updateUserSettings()
    }

    unselect( capability:IncyclistCapability|'bike'):void {
        console.log('~~~ unselect', capability)
        if (this.settings || !this.settings.capabilities)
            return;

        const settings = this.settings.capabilities.find( c =>c.capability===capability)
        if (settings) {
            settings.selected= undefined
            this.emit('device-changed', settings.capability)
        }
    }

    add(device:IncyclistDeviceSettings|IncyclistDeviceAdapter):void {
        const isAdapter = (device as IncyclistDeviceAdapter).getSettings!==undefined
        const deviceSettings:IncyclistDeviceSettings = isAdapter ? (device as IncyclistDeviceAdapter).getSettings() as IncyclistDeviceSettings: device as IncyclistDeviceSettings
        const adapter = AdapterFactory.create(deviceSettings)

        let udid = this.settings.devices?.find( d=> adapter.isEqual(d.settings))?.udid

        if (!udid) {
            if (!this.settings.devices)
                this.settings.devices = []
            udid = generateUdid() as string
            this.settings.devices.push( {udid,settings:adapter.getSettings()})
            this.emit('device-added',adapter.getSettings(),udid )
        }
    }

    delete(device:IncyclistDeviceSettings|IncyclistDeviceAdapter, capability?:IncyclistCapability|'bike'):void {

        const isAdapter = (device as IncyclistDeviceAdapter).getSettings!==undefined
        const deviceSettings:IncyclistDeviceSettings = isAdapter ? (device as IncyclistDeviceAdapter).getSettings() as IncyclistDeviceSettings: device as IncyclistDeviceSettings
        const adapter = AdapterFactory.create(deviceSettings)

        const udid = this.settings.devices?.find( d=> adapter.isEqual(d.settings))?.udid
        const {devices=[],capabilities=[]} = this.settings||{}

        if (!udid) 
            return;

        
        if (capability) { 
            // only delete from capability
            const record = capabilities.find( c => c.capability===capability)
            if (record) {
                const deviceIdx = record.devices.findIndex(d=>d===udid)

                if (record.selected===udid) {
                    record.selected=undefined

                    const items = record.devices.length
                    if (deviceIdx===items-1 && items>1) { // selected was last entry in the list -> try to select previous record
                        record.selected = record.devices[deviceIdx-1]
                    }
                    else if (deviceIdx>=0) {
                        record.selected = record.devices[deviceIdx+1]
                    }
                }                
                
                if (deviceIdx!==-1) {
                    record.devices.splice(deviceIdx)               
                    this.emit('device-changed', capability)
                }
            }


        }
        else {
            // delete from all capabilities and devices and adapters list
            delete this.adapters[udid]

            capabilities.forEach( c=> {
                if ( c.devices.includes(udid))
                    this.delete(adapter,c.capability)
            })

            const deviceIdx = devices.findIndex(d=>d.udid===udid)
            if (deviceIdx!==-1)  {
                devices.splice(deviceIdx)
                this.emit('device-deleted', adapter.getSettings(),udid)
            }
        }
    }


    protected addToCapability( udid:string, capability: IncyclistCapability|'bike') {
        if (!this.settings)
            this.settings = {}
        if (!this.settings.capabilities)
            this.settings.capabilities= []
        
        const {capabilities} = this.settings;
        const record = capabilities.find(c=>c.capability===capability)
        if (!record) {
            capabilities.push( {capability, devices:[udid], selected:udid})
        }
        else {
            if (!record.devices.includes(udid))
                record.devices.push(udid)
        }            

        if (capability!=='bike' && !this.adapters[udid].hasCapability(capability)) {
            this.adapters[udid].addCapability(capability)
        }
    }

    updateUserSettings() {
        this.userSettings.set('devices',this.settings.devices)
        this.userSettings.set('capabilities',this.settings.capabilities)
        this.userSettings.set('interfaces',this.settings.interfaces)
    }

    /**
     * provides information if for all requires capabilities a device has been selected, so that a training can be started
     * 
    */
    canStartRide():boolean {
        const {devices, capabilities} = this.settings||{}
        if (!devices || !capabilities)
            return false;

        return (
            this.getSelected('bike')!==undefined || 
            this.getSelected(IncyclistCapability.Control)!==undefined || 
            this.getSelected(IncyclistCapability.Power)!==undefined || 
            this.getSelected(IncyclistCapability.Speed)!==undefined
        )
    }

    getSelected(capability:IncyclistCapability|'bike'): IncyclistDeviceAdapter|undefined {
        const {capabilities} = this.settings||{}
        if ( !capabilities)
            return;

        const found = capabilities.find( c => c.capability===capability)
        if (!found || found.disabled || !found.selected)
            return
        
        const udid = found.selected
        return this.adapters[udid]
    }

    getCapabilityInfo(capability:IncyclistCapability|'bike'): CapabilityListDetails {
        const {capabilities} = this.settings||{}
        const adapters=[]
        let selectedIdx

        if ( !capabilities)
            return {adapters,disabled:true};

        const found = capabilities.find( c => c.capability===capability)
        if (!found)
            return {adapters,disabled:true}

        const disabled = found.disabled
        found.devices.forEach( (udid,idx)=> {
            adapters.push( this.adapters[udid])
            if (found.selected===udid)
                selectedIdx=idx;
        })
        return {adapters,selectedIdx,disabled}
    }

    //  Interface methods

    protected getInterfaceSettings(ifName:string):InterfaceSetting {
        if (!this.settings) this.settings={interfaces:[]}
        if (!this.settings.interfaces) this.settings.interfaces=[]
        const setting = this.settings.interfaces.find(i => i.name===ifName)
        return setting;
    }

    isInterfaceEnabled(ifName:string):boolean {
        const setting = this.getInterfaceSettings(ifName)
        if (!setting)
            return false;
        return setting.enabled

    }

    enableInterface(ifName:string):void {
        const setting = this.getInterfaceSettings(ifName)
        if (setting)
            setting.enabled = true
        else 
            this.settings.interfaces.push( {name:ifName, enabled:true})
        
    }

    disableInterface(ifName:string):void {
        const setting = this.getInterfaceSettings(ifName)
        if (setting)
            setting.enabled = false
        else 
            this.settings.interfaces.push( {name:ifName, enabled:false})
    }

    setInterfaceSettings(ifName, settings:InterfaceSetting):void {
        if (settings.name && settings.name!==ifName)
            return;

        const setting = this.getInterfaceSettings(ifName)
        merge(setting,settings)
        return 
    }


    

}

const useDeviceConfiguration = ()=>DeviceConfigurationService.getInstance()


export default useDeviceConfiguration