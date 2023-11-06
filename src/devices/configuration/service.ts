import { AdapterFactory, IncyclistCapability, IncyclistDeviceAdapter,CyclingMode } from "incyclist-devices"
import { UserSettingsService, useUserSettings } from "../../settings"
import { AdapterInfo, CapabilityInformation, DeviceConfigurationInfo, DeviceConfigurationSettings, DeviceModeInfo, ExtendedIncyclistCapability, IncyclistDeviceSettings, InterfaceSetting, 
         LegacyDeviceConnectionSettings, LegacyDeviceSelectionSettings, LegacyModeSettings, LegacySettings } from "./model"
import { v4 as generateUdid } from 'uuid';
import EventEmitter from "events";
import { merge } from "../../utils/merge";
import { EventLogger } from "gd-eventlog";
import clone from "../../utils/clone";


interface DeviceAdapterList {[index: string]: IncyclistDeviceAdapter}


interface CapabilityListDetails { 
    adapters:IncyclistDeviceAdapter[], 
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
 * @noInheritDoc
 * 
 */
export class DeviceConfigurationService  extends EventEmitter{

    protected static _instance: DeviceConfigurationService

    static getInstance():DeviceConfigurationService{
        if (!DeviceConfigurationService._instance)
            DeviceConfigurationService._instance = new DeviceConfigurationService()
        return DeviceConfigurationService._instance
    }

    settings: DeviceConfigurationSettings
    userSettings:UserSettingsService
    adapters: DeviceAdapterList = {}
    protected logger: EventLogger

    constructor() {
        super()
        this.userSettings = useUserSettings();
        this.logger = new EventLogger('DeviceConfig')     
    }

    protected logEvent(e) {
        this.logger?.logEvent(e)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = global.window as any
        if (w?.SERVICE_DEBUG || process.env.DEBUG) {
            console.log('~~~ CONFIG-SVC', e)
        }
    
    }

    protected logError(err:Error, fn:string) {
        this.logEvent( {message:'error',fn,error:err.message, stack:err.stack})
    }

    /**
     * Initializes the Device Settings
     * 
     * It will use the [[UserSettingsService]] to read the data and stores it in the [[settings]] property
     * 
     * The init method will check if the settings format is 
     * 
     * @emits __initialized__ Emitted once the configuration is fully initialized 
     * 
    */
    async init():Promise<void> {
        
        await this.userSettings.init()
        if (this.isInitialized()) {
            this.emitInitialized()
            return;
        }
        this.logEvent({message:'DeviceConfig.init'})

        if (  (this.userSettings.get('gearSelection','removed')!=='removed'|| this.userSettings.get('connections','removed')!=='removed')) {      

            const settings: LegacySettings= {};

            settings.connections = this.userSettings.get('connections',{}) as LegacyDeviceConnectionSettings
            settings.gearSelection = this.userSettings.get('gearSelection',{}) as LegacyDeviceSelectionSettings
            settings.modeSettings =  this.userSettings.get('preferences.gear',{}) as LegacyModeSettings
            
            try {
                await this.initFromLegacy(settings)
                this.verifyCapabilitySettings()
            }
            catch(err) {
                this.logError(err,'init()')
            }

            this.emitInitialized()                      
            return;    
        }
        
        await this.userSettings.init()

        this.settings = {
            devices: this.userSettings.get('devices',[]),
            capabilities:this.userSettings.get('capabilities',[]),
            interfaces: this.userSettings.get('interfaces',[])
        }

        // first time initialization?
        let emptyConfig = false
        if (!this.settings.capabilities || this.settings.capabilities.length===0) {
            this.initCapabilties()
            emptyConfig = true
        }
        if (!this.settings.interfaces || this.settings.interfaces.length===0) { 
            this.initInterfaces()
            emptyConfig = true
        }
        if (emptyConfig)
            this.updateUserSettings()

        if (!this.settings.devices)
            this.settings.devices = []

        this.settings.devices.forEach( d=> {
            
            try {
                this.adapters[d.udid] = AdapterFactory.create(d.settings)
            }
            catch(err) {
                this.logEvent({message:'error',fn:'init()->Adapterfactory.create()',error:err.message,udid:d.udid, settings:d.settings,  devices:this.settings.devices, stack:err.stack,})
                

                
            }
        })

        this.verifyCapabilitySettings()
        this.removeLegacySettings() 

        this.logEvent({message:'DeviceConfig.init done'})

        this.emitInitialized()
        
    }

    protected isNewUi() {
        return (this.userSettings.isInitialized && this.userSettings.get('NEW_UI',false))
    }

    protected verifyCapabilitySettings() {
        const {capabilities} = this.settings

        const isNewUi = this.isNewUi()

        if (isNewUi) {
            // remove bike capability - it's not used anymore
            
            const bikeCapIdx = capabilities.findIndex(c=>c.capability==='bike');
            if (bikeCapIdx!==-1) {
                capabilities.splice( bikeCapIdx,1)
            }
            return;
        }

        for( const capability  of ['bike' , IncyclistCapability.Control]) {
            const info = capabilities.find(c => c.capability===capability)
            if (info && info.devices.length>0 && info.selected===undefined)
                this.select( info.devices[0], capability as ExtendedIncyclistCapability)
        }

        const bikeCap = capabilities.find(c=>c.capability==='bike');

        if (bikeCap && bikeCap.selected) {
            const bike = bikeCap.selected
            const power = capabilities.find(c=>c.capability===IncyclistCapability.Power && c.selected!==undefined);
            const control = capabilities.find(c=>c.capability===IncyclistCapability.Control && c.selected!==undefined);
            const speed = capabilities.find(c=>c.capability===IncyclistCapability.Speed && c.selected!==undefined);
            const cadence = capabilities.find(c=>c.capability===IncyclistCapability.Cadence && c.selected!==undefined);

            const adapter = this.getAdapter(bike)

            let changed = false;
            const verify = (uuid,cap) => {
                if (!uuid && adapter.hasCapability(cap)) {
                    const setting = capabilities.find(c=>c.capability===cap);
                    if (!setting) {
                        capabilities.push( { capability:cap,devices:[bike],selected:bike,disabled:false})
                        changed = true
                    }
                    else {
                        setting.selected = bike;
                        if (!setting.devices.includes(bike))
                            setting.devices.push(bike)
                        changed = true
                    }
                }    
            }

            verify(control,IncyclistCapability.Control)
            verify(power,IncyclistCapability.Power)
            verify(speed,IncyclistCapability.Speed)
            verify(cadence,IncyclistCapability.Cadence)

            if (changed) {
                this.updateUserSettings()
                this.logEvent({message:'capability changed after verification',capabilities})
            }
        }
        
    }

    protected initCapabilties():void {
        const isNewUi = this.isNewUi()

        const target:Array<ExtendedIncyclistCapability> = [IncyclistCapability.Control,IncyclistCapability.Power, IncyclistCapability.Cadence,IncyclistCapability.Speed, IncyclistCapability.HeartRate ];
        if (!isNewUi) {
            target.push('bike' as ExtendedIncyclistCapability)            
        }

        if (!this.settings)
            this.settings = {}

        if (!this.settings.capabilities)
            this.settings.capabilities = [];

        target.forEach( capability => {
            if (!this.settings.capabilities.find( c=> c.capability===capability ))
                this.settings.capabilities.push({capability,devices:[],selected:undefined,disabled:false})
        })
    }

    protected initInterfaces():void {
        if (this.settings?.interfaces?.length>0)
            return;

        if (!this.settings)
            this.settings = {}
        this.settings.interfaces = [];

        this.settings.interfaces.push( {name:'ant', enabled:true})
        this.settings.interfaces.push( {name:'ble', enabled:true})
        this.settings.interfaces.push( {name:'serial', enabled:true, protocol:'Daum Classic'})
        this.settings.interfaces.push( {name:'tcpip', enabled:false, protocol:'Daum Premium', port:51955})
    }

    /** 
     * Provides the initialization state of the interface
     * @returns `true` if the interface has been initialized, `false` otherwise */
    isInitialized():boolean {
        return this.settings!==undefined
    }

    initFromLegacy(settings:LegacySettings={}):void {
        const {gearSelection,connections, modeSettings={}} = settings
        this.logEvent({message:'converting settings.json', gearSelection,connections})

        const isNewUi = this.isNewUi()
        
        const all:Array<ExtendedIncyclistCapability> = [IncyclistCapability.Control,IncyclistCapability.Power, IncyclistCapability.Cadence,IncyclistCapability.Speed, IncyclistCapability.HeartRate ];
        if (!isNewUi) {
            all.push('bike' as ExtendedIncyclistCapability)            
        }

        const gears = clone(gearSelection||{});

        const {bikes=[], hrms=[]} = gears
        
        this.settings= {interfaces:[], devices:[], capabilities:[]}
        const {interfaces,devices,capabilities} = this.settings;

        interfaces.push( {name:'ant', enabled:connections?.ant?.enabled||true})
        interfaces.push( {name:'ble', enabled:true})
        interfaces.push( {name:'serial', enabled:connections?.serial?.enabled||true,protocol:connections?.serial?.protocols?.find(p=>p.selected).name })
        interfaces.push( {name:'tcpip', enabled:connections?.tcpip?.enabled||false,protocol:'Daum Premium', port:51955})

        bikes.forEach( bike=> {
            if (bike.protocol==='Simulator')
                bike.interface='simulator'

            // delete some legay properties
            const isSelected = bike.selected
            const legacyProtocol = bike.protocol
            const legacyProfile = bike.profile

            delete bike.selected
            delete bike.displayName
            // special case ANT - we need to remove name as all necessar information is in the DeviceId
            if (bike.interface==='ant')
                delete bike.name

                
            let adapter;
            try {
                adapter =AdapterFactory.create(bike);
            }
            catch (err) {
                this.logEvent( {message:'error',fn:'initFromLegacy#bike',error:err.message,bike, stack:err.stack})
                
            }

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
            let deviceEntry;

            if (!existing) {
                udid=generateUdid()
                if (!sameNameDevice) {
                    deviceEntry = {udid, settings:bikeSettings}
                    devices.push( deviceEntry)
                }
                else {
                    deviceEntry = {udid, settings:bikeSettings,displayName:adapter.getUniqueName()}
                    devices.push( deviceEntry)
                    sameNameDevice.displayName = this.adapters[sameNameDevice.udid].getUniqueName()
                }
                
                this.adapters[udid] = adapter
            }

            // ensure that devices is included in capability device list, also ensures that capabilty exists
            const target = all.filter(c=> c!==IncyclistCapability.HeartRate)
            target.forEach( (cc:ExtendedIncyclistCapability) => {            
                
                if (cc!==IncyclistCapability.Control || adapter.hasCapability(cc) )
                    this.addToCapability(udid,cc)  

                if (isSelected) {               
                    const cap = cc as ExtendedIncyclistCapability
                    if ( (!isNewUi && cap==='bike') || adapter.hasCapability(cap)) {
                        const selectedDevice = capabilities.find(c => c.capability===cap )
                        
                        selectedDevice.selected = udid
                    }
                }
            })


            const key = legacyProfile ? `${legacyProtocol}-${legacyProfile}`: legacyProtocol
            const modeInfo = modeSettings[key]
            if (modeInfo && deviceEntry) {
                deviceEntry.modes={}
                deviceEntry.modes[modeInfo.mode] = modeInfo.settings
                deviceEntry.mode = modeInfo.mode
            }
            
        })

        hrms.forEach( hrm=> {
            // delete some legay properties
            const isSelected = hrm.selected
            delete hrm.selected
            delete hrm.displayName
            // special case ANT - we need to remove name 
            if (hrm.interface==='ant') 
                delete hrm.name
            
            let adapter;
            try {
                adapter =AdapterFactory.create(hrm);
            }
            catch (err) {
                this.logEvent( {message:'error',fn:'initFromLegacy#hrm',error:err.message,hrm, stack:err.stack})
            }
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
            if (isSelected) {               
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
            }
            else 
                capabilities.push( {capability:IncyclistCapability.HeartRate, devices:[], selected:undefined, disabled:true})
        }

        this.removeLegacySettings() 
        
        this.settings = { devices, capabilities, interfaces}
        this.updateUserSettings()
    }

    protected async removeLegacySettings() {

        this.userSettings.set('connections', 'removed',false) // old app versions will not respect NULL and wil loverwrite with previous content
        this.userSettings.set('gearSelection', 'removed',false) // old app versions will not respect NULL and wil loverwrite with previous content
        this.userSettings.set('preferences.gear','removed',false)            
        await this.userSettings.save()

        this.userSettings.set('connections',null,false)
        this.userSettings.set('gearSelection',null,false)
        this.userSettings.set('preferences.gear',null,false)
        await this.userSettings.save()

    }


    protected getDeviceConfigurationInfo():DeviceConfigurationInfo {
        const {capabilities=[],devices=[]} = this.settings;
        const {adapters} = this

        const info:CapabilityInformation[] = capabilities.map( c=> {
            const ci:CapabilityInformation = {
                capability: c.capability,
                disabled: c.disabled||false,
                devices: c.devices.filter( udid => devices.find( d=> d.udid===udid)).map( udid=>  {
                    const adapter = adapters[udid]                                   
                    const device = devices.find( d=> d.udid===udid)
                    const mode = device.mode
                    const modeSetting = device.modes ? device.modes[mode] : undefined
                    const interfaceName = device.settings.interface as string
                    const name = device?.displayName||adapter?.getUniqueName()||adapter?.getName()
                    return { udid, name,interface:interfaceName, selected:udid===c.selected, mode, modeSetting}
                })
            }
            return ci;
        })
        

        const configuration:DeviceConfigurationInfo = {}

        info.forEach( ci =>{
            const c:string = ci.capability.toString()
            configuration[c] = ci
        })

        return configuration;
    }

    protected emitCapabiltyChanged( capability?:ExtendedIncyclistCapability ) {
        const configuration = this.getDeviceConfigurationInfo()
        this.emit('capability-changed',configuration,capability)
    }
    
    protected emitInitialized() {

        const configuration = this.getDeviceConfigurationInfo()
        this.emit('initialized',configuration, this.settings.interfaces)
    }

    load():{capabilities:DeviceConfigurationInfo,interfaces:Array<InterfaceSetting>} {
        if (!this.isInitialized())
            throw new Error('load cannot be called before init')

        const capabilities = this.getDeviceConfigurationInfo()
        const interfaces = this.settings.interfaces
        return {capabilities,interfaces}
    }

    disableCapability(cability:ExtendedIncyclistCapability, disabled=true):void {
        const cabilitySettings = this.settings.capabilities.find( c=>c.capability===cability)
        cabilitySettings.disabled = disabled

        this.updateUserSettings();
        this.emitCapabiltyChanged()
    }

    /**
     * Marks a device as selected for a given capability
     * 
     * @param udid        The unique device id of the device 
     * @param capability    The cability for which the device should be marked as selected
     * 
     * 
     * @event device-changed    in case the settings were changed
     * @event device-added      in case the device was not yet known
    */

    select(udid:string, capability:ExtendedIncyclistCapability, props?:{noRecursive?:boolean,legacy?:boolean,emit?:boolean}):void {
        this.logEvent({message:'select device', udid, capability, props})

        const isNewUi = this.isNewUi()        

        const {noRecursive=false, legacy=false,emit=true} = props||{};
        const deviceSettings:IncyclistDeviceSettings = this.settings.devices?.find(d=>d.udid===udid)?.settings
        if (!deviceSettings)
            return;
        const adapter = this.adapters[udid] ||  AdapterFactory.create(deviceSettings)
        if (!adapter) {
            this.logEvent({message:'error: could not find adapter',fn:'select',  udid, capability, adapters: Object.keys(this.adapters)?.join(',')})
            return
        }

        if (isNewUi) {
            if (capability==='bike')
                return

            this.selectSingleDevice(udid, capability);  
            if(emit)
                this.emitCapabiltyChanged(capability)

            this.updateUserSettings()
            return;
        }

        if ( (capability==='bike') && !adapter.isControllable() )  // verify that this is a Bike
            return;

        const isControl = adapter.hasCapability(IncyclistCapability.Control) || (legacy && !isNewUi && capability==='bike')

        // ensure that devices is included in capability device list. 
        // This also ensures that the capability exists
        this.selectSingleDevice(udid, capability);  
        this.emitCapabiltyChanged(capability)

        if (noRecursive)
            return;
        
        // the next to blocks are special logic to avoid that Controllable Devices are launched without really using them to Control
        // which could lead to conflicts

        // if we select a controllable device as hrm or any other non controllable source, make sure that this device is also selected as controllable
        if (isControl) {
            if (capability!=='bike' && capability!==IncyclistCapability.Control) {
                if (!isNewUi)
                    this.select(udid,'bike',{noRecursive:true, legacy})
                this.select(udid,IncyclistCapability.Control,{noRecursive:true, legacy})            
            }
            else {
                if (!isNewUi && capability==='bike' && isControl) {
                    this.select(udid,IncyclistCapability.Control,{noRecursive:true, legacy})                    
                    this.select(udid,IncyclistCapability.Power,{noRecursive:true, legacy})    
                    if (legacy) {
                        this.select(udid,IncyclistCapability.Speed,{noRecursive:true, legacy})    
                        this.select(udid,IncyclistCapability.Cadence,{noRecursive:true, legacy})                                                    
                    }            
                    if (adapter.hasCapability(IncyclistCapability.HeartRate)) {
                        const hrm = this.getSelected(IncyclistCapability.HeartRate)
                        if ( !hrm && !this.isDisabled(IncyclistCapability.HeartRate)) {
                            this.select(udid, IncyclistCapability.HeartRate)
                        }
                        else if ( hrm && hrm.hasCapability( IncyclistCapability.Control)) {
                            this.select(udid, IncyclistCapability.HeartRate)
                        }
                    }    
                }

                const otherCapabilties = this.settings.capabilities.filter( c=>c.capability!=='bike' && c.capability!==IncyclistCapability.Control && !c.disabled && c.selected!==udid)
                
                const selectedControllable = otherCapabilties.filter( c => c.selected && this.adapters[c.selected]?.hasCapability(IncyclistCapability.Control))
                
                
                selectedControllable.forEach(c => {
                    if (adapter.hasCapability(c.capability)) {
                        this.select(udid,c.capability)
                    }
                    else 
                        this.unselect(c.capability)
                })
            }
        }
        else if (!isControl && !isNewUi && capability==='bike') {
            this.unselect(IncyclistCapability.Control)
            this.select(udid, IncyclistCapability.Power,{noRecursive:true, legacy})
        }

        this.updateUserSettings()
    }

    private selectSingleDevice(udid: string, capability: ExtendedIncyclistCapability) {
        this.addToCapability(udid, capability);

        // mark device udid as selected in capability, remove disabled flag
        const capSettings = this.settings.capabilities?.find(c => c.capability === capability);
        capSettings.selected = udid;
        if (capSettings.disabled)
            delete capSettings.disabled;
    }

    unselect( capability:ExtendedIncyclistCapability,shouldEmit:boolean=true):void {
        this.logEvent({message:'unselect device', capability})

        if (!this.settings || !this.settings.capabilities)
            return;

        const settings = this.settings.capabilities.find( c =>c.capability===capability)
        if (settings) {
            settings.selected= null
            this.updateUserSettings()
            if(shouldEmit)
                this.emitCapabiltyChanged(settings.capability)            

        }
    }

    add(deviceSettings:IncyclistDeviceSettings, props?:{legacy?:boolean}):string {   
        const isNewUi = this.isNewUi()

        let udid = this.getUdid(deviceSettings) 

        const {legacy=false} = props||{}
        this.logEvent({message:'add device',udid,deviceSettings, legacy})

        const deviceAlreadyExists = udid!==undefined


        let adapter;
        if (deviceAlreadyExists) {
            adapter = this.adapters[udid]
        }
        else {
            adapter = AdapterFactory.create(deviceSettings)
            if (!adapter)
                return;
    
            udid = this.settings.devices?.find( d=> adapter.isEqual(d.settings))?.udid
            if (!udid) {
                if (!this.settings.devices)
                    this.settings.devices = []
                udid = generateUdid() as string
                this.settings.devices.push( {udid,settings:adapter.getSettings()})
            }
    
            this.adapters[udid] = adapter;
    
        }

        this.initCapabilties()
            
        this.settings.capabilities.forEach( c=> {
            if (c.devices.includes(udid))
                return udid;

            const isBike = adapter.hasCapability(IncyclistCapability.Control)
            const isPower = adapter.hasCapability(IncyclistCapability.Power)

            //legacy mode - as long as new UI is not in place
            if (legacy && !isNewUi) {
                const isBikeCap = c.capability==='bike'
                const isControlCap = c.capability===IncyclistCapability.Control
                const isHrmCap = c.capability===IncyclistCapability.HeartRate

                const canAdd = 
                    (isBikeCap && (isBike || isPower)) ||
                    (isControlCap && isBike) ||
                    (!isHrmCap && !isControlCap && (isBike||isPower)) ||
                    adapter.hasCapability(c.capability) 
                
                const canSelect = (isBikeCap || isControlCap || isHrmCap) && 
                            (!c.selected && !c.disabled && 
                            (isBike || isPower || c.capability===IncyclistCapability.HeartRate))
                
                if (canAdd) {
                    c.devices.push(udid)
    
                    if (canSelect)
                        c.selected = udid

                }

            }
            else {
                if ( adapter.hasCapability(c.capability) ||  (!isNewUi && c.capability==='bike' && (isBike || isPower))) {
                    c.devices.push(udid)
    
                    // TODO: Change once we have changed the UI
                    if (!c.selected && !c.disabled && (isBike || c.capability===IncyclistCapability.HeartRate))
                        c.selected = udid
                }
    
            }

        })

        this.updateUserSettings()
        this.emitCapabiltyChanged()
        return udid

    }

    delete(udid:string, capability?:ExtendedIncyclistCapability, forceSingle=false):void {
        this.logEvent({message:'delete device',udid, capability, forceSingle})

        const deviceSettings:IncyclistDeviceSettings = this.settings.devices.find(d=>d.udid===udid)?.settings
        if (!deviceSettings)
            return;

        const {capabilities=[]} = this.settings||{}

        const singleDelete = capability && ((capability!=='bike' && capability!==IncyclistCapability.Control) || forceSingle)

        
        if (singleDelete) { 
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
                    record.devices.splice(deviceIdx,1)               
                    if (forceSingle) {
                        this.emitCapabiltyChanged(capability)            
                        this.updateUserSettings()
                    }
                }
            }

            // was this the only remaining capability the device was listed in? 
            // If so: delete device from the list
            const remaining = capabilities.find( c => c.devices.includes(udid))
            if ( !remaining) {
                this.deleteFromDeviceList(udid)              
            }


        }
        else {
            capabilities.forEach( c=> {
                const included =  c.devices.includes(udid)
                if (included)
                    this.delete(udid,c.capability,true)
            })

            // delete from all capabilities and devices and adapters list
            this.deleteFromDeviceList(udid)
            this.emitCapabiltyChanged()                            
            this.updateUserSettings()
        }
        this.emitDeviceDeleted(deviceSettings)

    }

    protected deleteFromDeviceList(udid:string) {
        // delete from all capabilities and devices and adapters list
        const {devices=[]} = this.settings||{}
        delete this.adapters[udid]

        const deviceIdx = devices.findIndex(d=>d.udid===udid)
        if (deviceIdx!==-1)  {
            devices.splice(deviceIdx,1)
        }
    }


    protected addToCapability( udid:string, capability: ExtendedIncyclistCapability) {
        const isNewUi = this.isNewUi()

        if (isNewUi&& capability==='bike')
            return;

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

    getUdid(deviceSettings:IncyclistDeviceSettings) {
        const udids = Object.keys(this.adapters)
        const udid = udids.find( key=> this.adapters[key]?.isEqual(deviceSettings))
        return udid;
    }

    setDisplayName( deviceSettings:IncyclistDeviceSettings, displayName?:string) {
        const udid =this.getUdid(deviceSettings) 
        if (!udid) 
            return;

        const device = this.settings.devices?.find(d=>d.udid===udid)
        if (displayName) {
            device.displayName = displayName
        }
        else {
            const adapter = this.adapters[udid]
            device.displayName= adapter?.getUniqueName()    
        }
        this.updateUserSettings();
        this.emitCapabiltyChanged()
        
    }

    // TODO: replace or make protected once Device Service is completed
    getAdapter( udid:string) {
        return this.adapters[udid]
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

        const isNewUi = this.isNewUi()

        
        const {devices, capabilities} = this.settings||{}
        if (!devices || !capabilities)
            return false;

        const canStart =  (
            (!isNewUi && this.getSelected('bike')!==undefined) || 
            this.getSelected(IncyclistCapability.Control)!==undefined || 
            this.getSelected(IncyclistCapability.Power)!==undefined || 
            this.getSelected(IncyclistCapability.Speed)!==undefined
        )

        
        return canStart

    }

    getModeSettings( requestedUdid?:string, requestedMode?:string ):DeviceModeInfo {
        
        const {capabilities,devices} = this.settings

        if (!this.isInitialized())
            return;

        try {
            const udid = requestedUdid || 
                capabilities.find( d=>d.capability===IncyclistCapability.Control)?.selected ||
                capabilities.find( d=>d.capability===IncyclistCapability.Power)?.selected

            if (!udid)
                return;

            const device = devices.find( d=> d.udid===udid)
            if (!device)
                return;

            let mode:string,modes,settings
            let modeObj:CyclingMode

            const adapter = AdapterFactory.create(device.settings) 
            if (!adapter) {
                this.logEvent({message:'Error: could not find adapter', requestedUdid, requestedMode, devices, adapters:Object.keys(this.adapters)?.join(',')})
                return;
            }
            mode = requestedMode || device.mode 
            if (adapter.getSupportedCyclingModes) {
                modes = adapter.getSupportedCyclingModes()
                if (!mode) {
                    modeObj = adapter.getDefaultCyclingMode()
                    mode = modeObj?.getName()
                }
                
            }


            settings = (device.modes ? device.modes[mode]: undefined) || {}
            if (!settings && modeObj) {
                settings = modeObj.getSettings()
            }
            
            
    
            return {udid,mode,settings,options:modes.map( M=> new M(adapter))}

        }
        catch(err) {
            this.logError(err,'getModeSettings()')
            return;
        }
    }

    setMode(udid:string, mode:string) {

        this.logEvent({message:'set device mode',udid,mode})

        if (!this.isInitialized())
            return;

        const device = this.settings.devices.find( d=> d.udid===udid)
        if (!device) {
            return;
        }
        
        const {modes={}} = device
        device.mode = mode;
        const settings = modes[mode]

        this.updateUserSettings()
        this.emitModeChanged(udid,mode,settings)
       
    }

    setModeSettings(udid:string, mode:string, settings) {
        this.logEvent({message:'set device mode settings',udid,mode,settings})
        if (!this.isInitialized())
            return;

        const device = this.settings.devices.find( d=> d.udid===udid)
        if (!device)
            return;
        
        const {modes={}} = device
        modes[mode] = settings;
        device.modes = modes;
        device.mode = mode;

        this.updateUserSettings()
        this.emitModeChanged(udid,mode,settings)
       
    }

    emitModeChanged(udid:string,mode:string, settings) {
        this.emit('mode-changed', udid,mode,settings)
    }

    /**
     * provides the list of adapters (to be used by the {@link DeviceRideService} and {@link DevicePairingService} )
     * 
     * @param onlySelected if set to true, only Adapters of selected devices will be returned
     * 
     * @returns The AdapterInfo List or an empty array
     */

    getAdapters(onlySelected=true):AdapterInfo[] {

        if (!onlySelected) {
            const udids = Object.keys(this.adapters)
            if (!udids||udids.length===0)
                return  []

            const info = []
            udids.forEach( udid=> {
                const adapter = this.adapters[udid]
                info.push( {udid,adapter,capabilities:adapter.getCapabilities()})
            })
            
            return info;
        }

        const {capabilities,devices} = this.settings||{}
        const adapters: AdapterInfo[] = []

        capabilities.forEach( c=> {
            if (c.disabled || !c.selected)
                return;
        
            if (!devices.find( d=> d.udid===c.selected))
                return;

            const adapter = this.adapters[c.selected]            
            const idx = adapters.findIndex( a => a.udid===c.selected)

            if (idx===-1) {
                adapters.push( {udid:c.selected, adapter, capabilities:[c.capability]})
            }
            else {
                adapters[idx].capabilities.push(c.capability)
            }
        })
        return adapters;

    }

     /**
     * provides the list of all adapters (to be used by the DeviceRideService)
     * 
     */

    getAllAdapters():AdapterInfo[] {
        const adapters: AdapterInfo[] = []

        const udids = Object.keys(this.adapters)
        if (!udids)
            return []

        udids.forEach( udid => {
            adapters.push( {udid, adapter:this.adapters[udid], capabilities:this.adapters[udid].getCapabilities()})
        })
        return adapters;

    }
    
    getSelected(capability:ExtendedIncyclistCapability): IncyclistDeviceAdapter|undefined {
        const {capabilities} = this.settings||{}
        if ( !capabilities)
            return;

        const found = capabilities.find( c => c.capability===capability)
        if (!found || found.disabled || !found.selected)
            return
        
        const udid = found.selected
        return this.adapters[udid]
    }

    protected isDisabled(capability:ExtendedIncyclistCapability): boolean {
        const info = this.getCapabilityInfo(capability)
        if (!info)
            return true;

        return info.disabled
    }

    protected getCapabilityInfo(capability:ExtendedIncyclistCapability): CapabilityListDetails {
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

    getSelectedDevices(capability?:IncyclistCapability): Array<{capability:IncyclistCapability,selected?:string }>{
        let capabilites = this.settings?.capabilities
        if (capability) {
            capabilites = this.settings?.capabilities.filter(c=>c.capability===capability)
        }

        return capabilites.filter( c=>c.capability!=='bike' && !(c.disabled===true) && c.selected).map( c => {
            const {capability,selected} = c
            return {capability: capability as IncyclistCapability,selected}
        })        
    }

    //  Interface methods

    getInterfaceSettings(ifName:string):InterfaceSetting {
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
        this.logEvent({message:'enable interface',ifName})
        const setting = this.getInterfaceSettings(ifName)
        if (setting)
            setting.enabled = true
        else 
            this.settings.interfaces.push( {name:ifName, enabled:true})

            this.updateUserSettings();
            this.emitInterfaceChanged(ifName)
        
    }

    disableInterface(ifName:string):void {
        this.logEvent({message:'disable interface',ifName})
        const setting = this.getInterfaceSettings(ifName)
        if (setting)
            setting.enabled = false
        else 
            this.settings.interfaces.push( {name:ifName, enabled:false})

        this.updateUserSettings();
        this.emitInterfaceChanged(ifName)
    }


    setInterfaceSettings(ifName, settings:InterfaceSetting):void {
        this.logEvent({message:'set interface settings',ifName,settings})

        if (settings.name && settings.name!==ifName)
            return;

        const idx = this.settings.interfaces.findIndex(i=>i.name===ifName)
        if (idx===-1)
            return;

        merge(this.settings.interfaces[idx], settings)

        this.updateUserSettings();
        this.emitInterfaceChanged(ifName)
        return 
    }


    emitInterfaceChanged(ifName:string) {
        const setting = this.getInterfaceSettings(ifName)
        if (setting) {
            this.emit('interface-changed', ifName, setting, this.settings.interfaces)
        }
    }

    emitDeviceDeleted(settings:IncyclistDeviceSettings) {
        this.emit('device-deleted', settings)
    }

}

export const useDeviceConfiguration = ()=>DeviceConfigurationService.getInstance()


