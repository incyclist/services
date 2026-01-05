import { AdapterFactory, IncyclistCapability, IncyclistDeviceAdapter,CyclingMode, useFeatureToggle, InterfaceFactory, BleDeviceSettings, DeviceSettings } from "incyclist-devices"
import { useUserSettings } from "../../settings"
import { AdapterInfo, CapabilityInformation, CapabilitySetting, DeviceConfigurationInfo, DeviceConfigurationSettings, DeviceListEntry, DeviceModeInfo, ExtendedIncyclistCapability, IncyclistDeviceSettings, InterfaceSetting, 
         LegacyDeviceConnectionSettings, LegacyDeviceSelectionSettings, LegacyModeSettings, LegacySettings } from "./model"
import { v4 as generateUdid } from 'uuid';
import { merge } from "../../utils/merge";
import clone from "../../utils/clone";
import { IncyclistService } from "../../base/service";
import { Injectable,Singleton } from "../../base/decorators";
import { getBindings } from "../../api";
import semver from 'semver'


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
@Singleton
export class DeviceConfigurationService  extends IncyclistService{


    settings: DeviceConfigurationSettings
    adapters: DeviceAdapterList = {}
    protected features: {[index:string]:boolean}

    constructor() {
        super('DeviceConfig')
        this.features = {};
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

        try {
            const userSettings = this.getUserSettings()
            await userSettings.init()
            if (this.isInitialized()) {
                this.emitInitialized()
                return;
            }
            this.logEvent({message:'DeviceConfig.init'})
    
            if (  this.isLegacyConfiguration()) {      
                this.initFromLegacy()                
            }
            else {        
                await this.getUserSettings().init()
    
                this.settings = {
                    devices: this.getUserSettings().get('devices',[]),
                    capabilities:this.getUserSettings().get('capabilities',[]),
                    interfaces: this.getUserSettings().get('interfaces',[])
                }
            }

            this.initFeatureToggles()
    
            // first time initialization?
            let emptyConfig = false
            if (!this.settings)
                this.settings={}
    
            if (!this.settings.capabilities || this.settings.capabilities?.length===0) {
                this.initCapabilties()
                emptyConfig = true
            }
            if (!this.settings.interfaces || this.settings.interfaces?.length===0) { 
                this.initInterfaces()
                emptyConfig = true
            }
            if (emptyConfig)
                this.updateUserSettings()
    
            if (!this.settings?.devices)
                this.settings.devices = []
    
            let updated = false
            this.settings.devices.forEach( d=> {
                if (!d?.udid ) {
                    if (d?.settings.interface==='wifi') {
                        d.udid = generateUdid() as string
                        updated = true
                    }
                    return;
                }
                
                try {
                    this.adapters[d.udid] = this.getAdapterFromSetting(d.settings)
                }
                catch(err) {
                    this.logEvent({message:'error',fn:'init()->Adapterfactory.create()',error:err.message,udid:d.udid, settings:d.settings,  devices:this.settings.devices, stack:err.stack,})
                }
            })
            if (updated) {
                this.getUserSettings().set('devices',this.settings.devices)
            }
    
            this.initWifiInterface()
    
            this.verifyCapabilitySettings()
            this.removeLegacySettings() 
    
            this.logEvent({message:'DeviceConfig.init done'})
            this.emitInitialized()
    
        }
        catch(err) {
            
            this.logEvent({message:'Error',fn:'init', error:err.message, stack:err.stack})
            this.emitInitialized()

        }

    }

    setFeature( name:string, enabled:boolean) {
        this.features[name] = enabled
    }

    protected hasFeature(name:string):boolean {
        return this.getUserSettings().getValue(name,false)
    }

    protected initFeatureToggles() {
//        if (this.hasFeature('VIRTUAL_SHIFTING')) {
            this.getDevicesFeatureToggle().add('VirtualShifting')
//        }
    }

    /** 
     * Provides the initialization state of the interface
     * @returns `true` if the interface has been initialized, `false` otherwise */
    isInitialized():boolean {
        return this.settings!==undefined
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


        const {emit=true} = props??{};
        const deviceSettings:IncyclistDeviceSettings = this.settings.devices?.find(d=>d.udid===udid)?.settings
        if (!deviceSettings)
            return;
        const adapter = this.adapters[udid] ??  this.getAdapterFromSetting(deviceSettings)
        if (!adapter) {
            this.logEvent({message:'error: could not find adapter',fn:'select',  udid, capability, adapters: Object.keys(this.adapters)?.join(',')})
            return
        }

        if (capability==='bike')
            return

        this.selectSingleDevice(udid, capability);  
        if(emit)
            this.emitCapabiltyChanged(capability)

        this.updateUserSettings()
    }

    unselect( capability:ExtendedIncyclistCapability,shouldEmit:boolean=true):void {
        this.logEvent({message:'unselect device', capability})

        if (!this.settings?.capabilities)
            return;

        const settings = this.settings.capabilities.find( c =>c.capability===capability)
        if (settings) {
            settings.selected= null
            this.updateUserSettings()
            if(shouldEmit)
                this.emitCapabiltyChanged(settings.capability)            

        }
    }

    updateCapabilities(udid:string) {
        const adpater = this.getAdapter(udid)
        if (!adpater)
            return

        const capabilties = adpater.getCapabilities()

        // add additional capabilties
        capabilties.forEach( capability=> {
            const settings = this.settings.capabilities.find( c =>c.capability===capability)            
            if (!settings?.devices?.includes(udid)) {
                
                this.addToCapability(udid, capability)
            }    
        })

        // remove capabilties that are no more present (unless device is selected for this capability)
        this.settings.capabilities.forEach( c => {
            if (c.capability==='bike') // legacy capability - ignore
                return

            const capability = c.capability as IncyclistCapability
            if (!capabilties.includes(capability) && c.selected!==udid) {
                this.delete(udid, capability)
            }
        })

        this.updateUserSettings()
        this.emitCapabiltyChanged()    
    }

    addCapability(udid:string, capability:ExtendedIncyclistCapability) {
        this.addToCapability(udid, capability)

        this.emitCapabiltyChanged(capability)
    }

    add(deviceSettings:IncyclistDeviceSettings, props?:{legacy?:boolean}):string {   
        let udid = this.getUdid(deviceSettings) 

        const {legacy=false} = props||{}

        const deviceAlreadyExists = udid!==undefined


        let adapter;
        
        const updateWifiSettings = (udid:string) => {
            const settingIdx = this.settings.devices.findIndex(d => d.udid === udid)
            if (settingIdx !== -1 && this.settings.devices[settingIdx]?.settings?.interface === 'wifi') {
                this.settings.devices[settingIdx].settings = { ...this.settings.devices[settingIdx].settings, ...deviceSettings }
            }
        }


        if (deviceAlreadyExists && this.adapters[udid])  {
            adapter = this.adapters[udid]
            updateWifiSettings(udid)
        }
        else {
            this.logEvent({message:'add device',udid,deviceSettings, legacy})
            adapter = this.getAdapterFromSetting(deviceSettings)
            if (!adapter) {
                this.logEvent({message:'could not create adapter'})
                return;
            }
    
            udid = this.settings.devices?.find( d=> adapter.isEqual(d.settings))?.udid
            if (udid) {
                updateWifiSettings(udid)
            }
            else {
                if (!this.settings.devices)
                    this.settings.devices = []
                udid = generateUdid() as string
                if (!this.settings.devices.some( d=>d.udid===udid)) {
                    this.settings.devices.push( {udid,settings:adapter.getSettings()})
                }
            }
    
            this.adapters[udid] = adapter;
    
        }

        this.initCapabilties()
            
        this.settings.capabilities.forEach( c=> {
            if (c.devices.includes(udid) && c.selected!==undefined && c.selected!==null)
                return udid;

            const isBike = adapter.hasCapability(IncyclistCapability.Control)

            if ( adapter.hasCapability(c.capability) && c.capability!=='bike') {
                if (!c.devices.includes(udid)) {
                    c.devices.push(udid)
                }

                if (!c.selected && !c.disabled && (isBike || c.capability===IncyclistCapability.HeartRate))
                    c.selected = udid
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

    getAdapter( udid:string) {
        return this.adapters[udid]
    }

    /**
     * provides information if for all requires capabilities a device has been selected, so that a training can be started
     * 
    */
    canStartRide():boolean {
        
        const {devices, capabilities} = this.settings||{}
        if (!devices || !capabilities)
            return false;

        const canStart =  (            
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

            let mode:string,settings, isERG, isSIM
            let modeObj:CyclingMode
            let modes: typeof CyclingMode[] = []

            const adapter = this.getAdapterFromSetting(device.settings) 
            if (!adapter) {
                this.logEvent({message:'Error: could not find adapter', requestedUdid, requestedMode, devices, adapters:Object.keys(this.adapters)?.join(',')})
                return;
            }


            if (adapter.getSupportedCyclingModes) {
                modes = adapter.getSupportedCyclingModes()               
            }
            const options = modes.map( M=> adapter.createMode(M))

            mode = requestedMode || device.mode 
            if (!mode) {
                modeObj = adapter.getDefaultCyclingMode()
                mode = modeObj?.getName()
            }
            else {
                modeObj = options.find( m=> m.getName()===mode)
            }


            settings = (device.modes ? device.modes[mode]: undefined) ?? {}
            if (!settings && modeObj) {
                settings = modeObj.getSettings()
            }

            
            isERG = modeObj?.isERG()===true
            isSIM = modeObj?.isSIM()===true

            return {udid,mode,settings,isERG,isSIM,options} 

        }
        catch(err) {
            this.logError(err,'getModeSettings()', {requestedUdid, requestedMode})
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
                if (!adapter)
                    return;
                info.push( {udid,adapter,capabilities:adapter.getCapabilities()})
            })
            
            return info;
        }

        const {capabilities=[],devices=[]} = this.settings||{}
        const adapters: AdapterInfo[] = []

        capabilities.forEach( c=> {
            if (c.disabled || !c.selected)
                return;
        
            if (!devices.find( d=> d.udid===c.selected))
                return;

            const adapter = this.adapters[c.selected]            
            if (!adapter)
                return;
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

    getSimulatorAdapterId(): string|undefined {
        const adapters = this.getAllAdapters()

        const found =  adapters.find( a => a.adapter.getInterface()==='simulator')

        return found ? found.udid: undefined
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


    getSelectedDevices(capability?:IncyclistCapability): Array<{capability:IncyclistCapability,selected?:string }>{
        let capabilites = this.settings?.capabilities
        if (capability) {
            capabilites = this.settings?.capabilities.filter(c=>c.capability===capability)
        }

        return capabilites.filter( c=>c.capability!=='bike' && c.disabled!==true && c.selected).map( c => {
            const {capability,selected} = c
            return {capability: capability as IncyclistCapability,selected}
        })        
    }

    //  Interface methods

    initWifiInterface() {
        const wifi = this.settings?.interfaces?.find( i=> i.name === 'wifi')

        if (!this.doesAppSupportsWifi()) {
            if (wifi) {
                this.logEvent({message:'interface disabled',interface:'wifi'})
                wifi.enabled = false
                wifi.invisible = true;
            }
            return;
        }

        if (!wifi) {
            this.addWifiInterface()
        }
        else {
            const wifiEnforcedVisible = this.getUserSettings().get('wifiEnforcedVisible',false)

            const invisible = wifiEnforcedVisible ? false : !this.isWindows()
            const enabled = this.isWindows() ? (wifi.enabled??false) : true
            const idx = this.settings.interfaces.indexOf(wifi)
            this.settings.interfaces[idx] = {name:'wifi',enabled,invisible}

        }

        const wifiDevices = this.settings.devices.filter(d => d?.settings?.interface === 'wifi')

        const dc = this.getDirectConnectInterface()
        wifiDevices.forEach( d=> {
            const settings: BleDeviceSettings = d.settings as BleDeviceSettings
            dc.addKnownDevice(settings)
        })


    }

    confirmWifiInterface():void {
        this.getUserSettings().set('wifiConfirmed',true)
    }

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
    }

    // -------------------------------------- Protected methods below

    protected updateUserSettings() {
        this.getUserSettings().set('devices',this.settings.devices)
        this.getUserSettings().set('capabilities',this.settings.capabilities)
        this.getUserSettings().set('interfaces',this.settings.interfaces)
    }


    protected  isLegacyConfiguration():boolean {
        return this.getUserSettings().get('gearSelection', 'removed') !== 'removed' || this.getUserSettings().get('connections', 'removed') !== 'removed';
    }


    protected initFromLegacy():void {

        try {
            const userSettings = this.getUserSettings()
            const legacy: LegacySettings= {};
    
            legacy.connections = userSettings.get('connections',{}) as LegacyDeviceConnectionSettings
            legacy.gearSelection = userSettings.get('gearSelection',{}) as LegacyDeviceSelectionSettings
            legacy.modeSettings =  userSettings.get('preferences.gear',{}) as LegacyModeSettings          
            const {gearSelection,connections, modeSettings={}} = legacy
            this.logEvent({message:'converting settings.json', gearSelection,connections})
    
            
            const all:Array<ExtendedIncyclistCapability> = [IncyclistCapability.Control,IncyclistCapability.Power, IncyclistCapability.Cadence,IncyclistCapability.Speed, IncyclistCapability.HeartRate ];
            const gears = clone(gearSelection||{});
    
            const {bikes=[], hrms=[]} = gears
            
            this.settings= {interfaces:[], devices:[], capabilities:[]}
            this.initCapabilties()

            this.buildInterfacesFromLegacy(legacy)
            const {interfaces,devices,capabilities} = this.settings;
    
    
            this.addBikesFromLegacy(bikes, devices, all, capabilities, modeSettings);
            this.addHrmsFromLegacy(hrms, devices, capabilities);
    
    
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
        catch(err) {
            this.logError(err,'init()')
        }



    }

    private addHrmsFromLegacy(hrms: any, devices: DeviceListEntry[], capabilities: CapabilitySetting[]) {
        hrms.forEach(hrm => {
            // delete some legay properties
            const isSelected = hrm.selected;
            delete hrm.selected;
            delete hrm.displayName;
            // special case ANT - we need to remove name 
            if (hrm.interface === 'ant')
                delete hrm.name;

            let adapter;
            try {
                adapter = this.getAdapterFromSetting(hrm);
            }
            catch (err) {
                this.logEvent({ message: 'error', fn: 'initFromLegacy#hrm', error: err.message, hrm, stack: err.stack });
            }
            if (!adapter) {
                return;
            }

            const hrmSettings = adapter.getSettings();
            // special case ANT - we need to remove legacy protocol information as otherwise profile would be incorrectly interpreted
            if (hrm.interface === 'ant')
                delete hrmSettings.protocol;

            const existing = devices.find(device => {
                const equal = adapter.isEqual(device.settings);
                return equal;
            });
            let udid = existing?.udid;
            if (!existing) {
                udid = generateUdid();
                devices.push({ udid, settings: hrmSettings });
                this.adapters[udid] = adapter;
            }
            this.addToCapability(udid, IncyclistCapability.HeartRate);
            if (isSelected) {
                const cap = IncyclistCapability.HeartRate;
                if (adapter.hasCapability(cap)) {
                    const selectedDevice = capabilities.find(c => c.capability === cap);
                    selectedDevice.selected = udid;
                }

            }
        });
    }

    private addBikesFromLegacy(bikes: any, devices: DeviceListEntry[], all: ExtendedIncyclistCapability[], capabilities: CapabilitySetting[], modeSettings: LegacyModeSettings) {
        bikes.forEach(bike => {
            if (bike.protocol === 'Simulator')
                bike.interface = 'simulator';

            // delete some legay properties
            const isSelected = bike.selected;
            const legacyProtocol = bike.protocol;
            const legacyProfile = bike.profile;

            delete bike.selected;
            delete bike.displayName;
            // special case ANT - we need to remove name as all necessar information is in the DeviceId
            if (bike.interface === 'ant')
                delete bike.name;


            let adapter;
            try {
                adapter = this.getAdapterFromSetting(bike);
            }
            catch (err) {
                this.logEvent({ message: 'error', fn: 'initFromLegacy#bike', error: err.message, bike, stack: err.stack });

            }

            if (!adapter) {
                return;
            }
            const bikeSettings = adapter.getSettings();
            // special case ANT - we need to remove legacy protocol information as otherwise profile would be incorrectly interpreted
            if (bike.interface === 'ant')
                delete bikeSettings.protocol;

            const existing = devices.find(device => adapter.isEqual(device.settings));
            const sameNameIdx = devices.findIndex(device => device.settings.interface === bikeSettings.interface && device.settings.name === bikeSettings.name && !adapter.isEqual(device.settings));
            const sameNameDevice = sameNameIdx !== -1 ? devices[sameNameIdx] : undefined;

            let udid = existing?.udid;
            let deviceEntry;

            if (!existing) {
                udid = generateUdid();
                if (!sameNameDevice) {
                    deviceEntry = { udid, settings: bikeSettings };
                    devices.push(deviceEntry);
                }
                else {
                    deviceEntry = { udid, settings: bikeSettings, displayName: adapter.getUniqueName() };
                    devices.push(deviceEntry);
                    sameNameDevice.displayName = this.adapters[sameNameDevice.udid].getUniqueName();
                }

                this.adapters[udid] = adapter;
            }

            // ensure that devices is included in capability device list, also ensures that capabilty exists
            const target = all.filter(c => c !== IncyclistCapability.HeartRate);
            target.forEach((cc: ExtendedIncyclistCapability) => {

                if (cc !== IncyclistCapability.Control || adapter.hasCapability(cc))
                    this.addToCapability(udid, cc);

                if (isSelected) {
                    const cap = cc;
                    if (adapter.hasCapability(cap)) {
                        const selectedDevice = capabilities.find(c => c.capability === cap);

                        selectedDevice.selected = udid;
                    }
                }
            });


            const key = legacyProfile ? `${legacyProtocol}-${legacyProfile}` : legacyProtocol;
            const modeInfo = modeSettings[key];
            if (modeInfo && deviceEntry) {
                deviceEntry.modes = {};
                deviceEntry.modes[modeInfo.mode] = modeInfo.settings;
                deviceEntry.mode = modeInfo.mode;
            }

        });
    }

    protected buildInterfacesFromLegacy(legacy:LegacySettings) {
        const {connections} = legacy

        if (!this.settings.interfaces) this.settings.interfaces=[]
        const {interfaces} = this.settings;
    
        const get = ( (x,def) =>  x??def)

        interfaces.push( {name:'ant', enabled:connections?.ant?.enabled||true})
        interfaces.push( {name:'ble', enabled:true})
        interfaces.push( {name:'serial', enabled:get(connections?.serial?.enabled,true),protocol:connections?.serial?.protocols?.find(p=>p.selected).name })
        interfaces.push( {name:'tcpip', enabled:get(connections?.tcpip?.enabled,false),protocol:'Daum Premium', port:51955})
        this.initWifiInterface()

    }

    protected verifyCapabilityExists(capability) {
        const {capabilities} = this.settings
        const found = capabilities.find( c=>c.capability===capability)
        if (!found) {
            capabilities.push( {capability,devices:[],disabled:false,selected:undefined})
        }
    }

    protected verifyCapabilitySettings() {
        const {capabilities} = this.settings


        const bikeCapIdx = capabilities.findIndex(c=>c.capability==='bike');

        // remove bike capability - it's not used anymore
        this.verifyCapabilityExists(IncyclistCapability.Control)
        this.verifyCapabilityExists(IncyclistCapability.Power)
        this.verifyCapabilityExists(IncyclistCapability.HeartRate)
        this.verifyCapabilityExists(IncyclistCapability.Speed)
        this.verifyCapabilityExists(IncyclistCapability.Cadence)

        if ( this.hasFTControllers()) {
            this.verifyCapabilityExists(IncyclistCapability.AppControl)
        }

        if (bikeCapIdx!==-1) {
            capabilities.splice( bikeCapIdx,1)
        }
    }

    protected initCapabilties():void {

        const target:Array<ExtendedIncyclistCapability> = [IncyclistCapability.Control,IncyclistCapability.Power, IncyclistCapability.Cadence,IncyclistCapability.Speed, IncyclistCapability.HeartRate ];

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

        this.initWifiInterface()
    }

    protected hasFTControllers():boolean {
        return this.getUserSettings().getValue('CONTROLLERS',false)
    }

    protected doesAppSupportsWifi():boolean {
        try {
            const version = this.getAppVersion()
            return semver.gte(version,'0.9.10')    
        }
        catch {
            return false
        }
    }

    protected getAppVersion():string {
        const {appInfo} = getBindings()
        return appInfo?.getAppVersion()??'0.0.0'
    }

    protected isWindows():boolean {
        const {appInfo} = getBindings()

        // istanbul ignore next
        if (!appInfo) {
            return false
        }
        const os = appInfo.getOS()
        return os.platform==='win32'
    }

    protected addWifiInterface():void {

        const wifiEnforcedVisible = this.getUserSettings().get('wifiEnforcedVisible',false)

        const enabled = !this.isWindows()
        const invisible = wifiEnforcedVisible ? false : !this.isWindows()

        this.settings.interfaces.push( {name:'wifi',enabled,invisible} )
        this.logEvent({message:'interface added',interface:'wifi', enabled})   
    }


    protected async removeLegacySettings() {

        this.getUserSettings().set('connections', 'removed',false) // old app versions will not respect NULL and wil loverwrite with previous content
        this.getUserSettings().set('gearSelection', 'removed',false) // old app versions will not respect NULL and wil loverwrite with previous content
        this.getUserSettings().set('preferences.gear','removed',false)            
        await this.getUserSettings().save()

        this.getUserSettings().set('connections',null,false)
        this.getUserSettings().set('gearSelection',null,false)
        this.getUserSettings().set('preferences.gear',null,false)
        await this.getUserSettings().save()

    }


    protected getDeviceConfigurationInfo():DeviceConfigurationInfo {
        const configuration:DeviceConfigurationInfo = {}

        try {
            const {capabilities=[],devices=[]} = this.settings;
            const {adapters} = this
    
            const info:CapabilityInformation[] = capabilities.map( c=> {
    
                const ci:CapabilityInformation = {
    
                    capability: c.capability,
                    disabled: c.disabled||false,
                    devices: (c.devices??[]).filter( udid => devices.find( d=> d.udid===udid)).map( udid=>  {
                        const adapter = adapters[udid]                                   
                        const device = devices.find( d=> d.udid===udid)
                        const mode = device.mode
                        const modeSetting = device.modes ? device.modes[mode] : undefined
                        const interfaceName = device.settings.interface as string
                        const name = device?.displayName??adapter?.getUniqueName()??adapter?.getName()
                        return { udid, name,interface:interfaceName, selected:udid===c.selected, mode, modeSetting}
                    })
                }
                return ci;
            })
            
    
    
            info.forEach( ci =>{
                const c:string = ci.capability.toString()
                configuration[c] = ci
            })
    
        }
        catch(err) {
            this.logError(err,'getDeviceConfigurationInfo')
        }

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


    private selectSingleDevice(udid: string, capability: ExtendedIncyclistCapability) {
        this.addToCapability(udid, capability);

        // mark device udid as selected in capability, remove disabled flag
        const capSettings = this.settings.capabilities?.find(c => c.capability === capability);
        capSettings.selected = udid;
        if (capSettings.disabled)
            delete capSettings.disabled;
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

        if (capability==='bike')
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
        else if (!record.devices?.length) {
            record.devices.push(udid)
            record.selected = udid
        }            

        else if (!record.devices?.includes(udid)) {
            record.devices.push(udid)
        }            

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



    protected emitInterfaceChanged(ifName:string) {
        const setting = this.getInterfaceSettings(ifName)
        if (setting) {
            this.emit('interface-changed', ifName, setting, this.settings.interfaces)
        }
    }

    protected emitDeviceDeleted(settings:IncyclistDeviceSettings) {
        this.emit('device-deleted', settings)
    }

    reset() {
        super.reset()
        this.settings = undefined
    }

    protected getAdapterFromSetting(settings) {
        return this.getAdapterFactory().create(settings)
    }


    @Injectable
    protected getUserSettings() {
        return useUserSettings()
    }

    @Injectable
    protected getAdapterFactory() {
        return AdapterFactory
    }

    @Injectable
    protected getDevicesFeatureToggle() {
        return useFeatureToggle()
    }

    @Injectable
    protected getDirectConnectInterface() {
        return InterfaceFactory.create('wifi')
    }

}

export const useDeviceConfiguration = ()=> new DeviceConfigurationService()


