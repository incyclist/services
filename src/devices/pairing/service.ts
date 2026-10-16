import { DeviceAccessService, useDeviceAccess } from "../access/service";
import { AddDeviceResult, AdapterInfo, CapabilityExclusion, CapabilityInformation, DeviceConfigurationInfo, DeviceConfigurationService, IncyclistDeviceSettings, InterfaceSetting, useDeviceConfiguration} from "../configuration";
import { CapabilityData, DevicePairingData, DevicePairingStatus, DeviceSelectState,  InternalPairingState,  PairingProps, PairingSettings, PairingState, SelectDeviceMode, SelectionImpact, SelectionConflict, ConflictDismissal  } from "./model";
import { isCapabilityActive } from "./capability";
import {  DeviceData,  DeviceSettings,  IncyclistCapability, IncyclistDeviceAdapter } from "incyclist-devices";
import { AdapterStateInfo, DeviceRideService, useDeviceRide } from "../ride";
import clone from "../../utils/clone";
import { IncyclistService } from "../../base/service";
import { EnrichedInterfaceSetting } from "../access";
import { sleep } from "../../utils/sleep";
import { Injectable } from "../../base/decorators";
import { useUnitConverter } from "../../i18n";


const Units = [
    { capability:IncyclistCapability.HeartRate, unit:'bpm', value:'heartrate', decimals:0},
    { capability:IncyclistCapability.Power, unit:'W', value:'power', decimals:0},
    { capability:IncyclistCapability.Speed, unit:'km/h', value:'speed', decimals:1, convert:'speed'},
    { capability:IncyclistCapability.Cadence, unit:'rpm', value:'cadence', decimals:0},
]

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
    protected static checkCounter =0
    protected static scanCounter =0

    protected configuration: DeviceConfigurationService
    protected access: DeviceAccessService
    protected rideService: DeviceRideService
    protected pairingConfirmed: boolean = false


    protected settings: PairingSettings={}
    protected state:InternalPairingState = { initialized:false, deleted:[]}
    protected deviceSelectState:DeviceSelectState|null = null

    // a selected capability that stays 'waiting' with nothing pairing or scanning is logged once per start
    protected static readonly STALLED_AFTER_MS = 30*1000
    protected stalledTimer?: ReturnType<typeof setTimeout>
    protected stalledLogged = false

    // whether a Pairing page visit is open - see setVisitOpen()
    protected visitOpen = false
    protected visitOpenedAt?: number

    // selection conflicts raised during the open visit, oldest first, one per device
    protected pendingConflicts: Array<{udid:string, conflict:SelectionConflict}> = []
    protected static conflictCounter = 0


    protected onPairingStartedHandler = this.onPairingStarted.bind(this)
    protected onPairingSuccessHandler = this.onPairingSuccess.bind(this)
    protected onPairingErrorHandler = this.onPairingError.bind(this)
    protected onDeviceDataHandler = this.onDeviceData.bind(this)
    protected onScanningDataHandler 
    protected onInterfaceConfigChangedHandler  = this.onInterfaceConfigChanged.bind(this)
    protected onConfigurationUpdateHandler = this.onConfigurationUpdate.bind(this)
    protected onInterfaceStateChangedHandler = this.onInterfaceStateChanged.bind(this)
    protected onDeviceDetectedHandler = this.onDeviceDetected.bind(this)

    public usage: 'page' | 'direct' = 'direct'

    static getInstance():DevicePairingService{
        if (!DevicePairingService._instance)
        DevicePairingService._instance = new DevicePairingService()
        return DevicePairingService._instance
    }

    constructor( services?:Services) {

        super('Pairing')

        // inject external dependencies // LEGACY - remove !
        if (services) {
            this.configuration = services.configuration
            this.access = services.access
            this.rideService = services.ride
        }
        else {
            this.configuration = this.getDeviceConfiguration()
            this.access = this.getDeviceAccess()
            this.rideService = this.getDeviceRide()
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

        this.pairingConfirmed = false
        this.stalledLogged = false
        
        if (this.state.stopped) {
            // cleanup on 2nd launch
            this.state.stopped = false;
            this.state.deleted = []
        }

        


        if (this.state.interfaces) {
            this.initConfigHandlers();  

            this.state.interfaces = this.access.enrichWithAccessState(this.state.interfaces);
        }

        try {
            await this.loadConfiguration();
            this.updateCapabilityConfig()
            
            

            const alreadyInitialized =  this.settings.onStateChanged!==undefined && this.settings.onStateChanged!==null
            this.settings.onStateChanged = onStateChanged
    

            if (alreadyInitialized) {
                this.emitStateChange(this.state)
                this.emitStartStatus()
                return;
            }
               
    
            this.initConfigHandlers();  
            this.state.interfaces.forEach( i=> {
                if (!this.isInterfaceEnabled(i.name)  )
                    this.unselectOnInterface(i.name)
                    
            })
    
            
            this.emitStateChange(this.state)
            this.emitStartStatus()

            if (this.usage==='page')  {
                this.emit('page-ready')
            }
            else {
                this.run().catch( err=>{ this.logError(err,'start') })
            }


        }
        catch (err) { // istanbul ignore next
            this.logError(err,'start')
        }
    }

    protected async loadConfiguration() {
        await this.waitForInit();
        const { capabilities, interfaces } = this.getDeviceConfiguration().load();

        this.state.capabilities = this.mappedCapabilities(capabilities);
        this.state.interfaces = this.access.enrichWithAccessState(interfaces);
        this.state.canStartRide = this.getDeviceConfiguration().canStartRide();
        this.state.stopRequested = false;
        this.state.stopped = false;

        this.logCapabilities();
    }

    protected initConfigHandlers() {
        this.removeConfigHandlers()
        this.getDeviceConfiguration().on('interface-changed', this.onInterfaceConfigChangedHandler);
        this.getDeviceConfiguration().on('capability-changed', this.onConfigurationUpdateHandler);
        this.access.on('interface-changed', this.onInterfaceStateChangedHandler);
    }
    protected removeConfigHandlers() {
        this.getDeviceConfiguration().off('interface-changed', this.onInterfaceConfigChangedHandler);
        this.getDeviceConfiguration().off('capability-changed', this.onConfigurationUpdateHandler);
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

   async stop(adapters:Array<string>=[],forExit:boolean=false ):Promise<void> {

        this.clearStalledTimer()
        const adapterFilter = adapters??[]

        if (!forExit) {
            this.logEvent({message:'Stop Pairing (Skip)'})
        }
        try {
            this.state.stopRequested = true;
            
            await this._stop();

            const adapters = this.state?.adapters??[]
            this.pauseAdapters(adapters.filter( a=> !adapterFilter.includes(a.udid)));

            this.removeConfigHandlers()
            this.settings = {}
            this.state.initialized = false
            this.state.waiting = false;
            this.state.check = null;
            this.state.scan = null;
            
            this.state.stopRequested = false;
            this.state.stopped = true
        }
        catch (err) { // istanbul ignore next
            this.logError(err,'stop')
        }          
    }

    async exit() {
        return await this.stop([],true)
    }

    /**
     * Tells the service whether a Pairing page visit is open.
     *
     * Opening a visit clears every exclusion scoped `until-next-pairing`, so the rider's devices
     * are re-evaluated from scratch. That happens on every call with `true`, also when a visit is
     * already open, so a visit that was never closed (crash, fast navigation) can't keep one alive.
     *
     * While a visit is open, a device excluded as `not-available` keeps being tried, and is taken
     * back into use as soon as it connects. Without an open visit neither happens: a device that
     * connects in the background, e.g. during ride start, stays excluded.
     *
     * @param open `true` when the Pairing page opens, `false` when it is left
     */
    setVisitOpen(open:boolean):void {
        try {
            if (open) {
                this.visitOpenedAt ??= Date.now()
                this.getDeviceConfiguration().clearExclusions({scope:'until-next-pairing'})
            }
            else {
                delete this.visitOpenedAt
                // the rider left without answering: the current selection is kept
                this.dismissPendingConflicts('left_page')
            }
            this.visitOpen = open
        }
        catch(err) {
            this.logError(err,'setVisitOpen')
        }
    }

    /**
     * The selection conflicts raised during the open visit that the rider hasn't answered yet,
     * oldest first, one per device.
     */
    getPendingConflicts():SelectionConflict[] {
        return this.pendingConflicts.map( e=> clone(e.conflict))
    }

    /**
     * Answers a pending conflict: the device replaces the current one in each of the `replace`
     * capabilities, and every other row keeps the current device.
     *
     * The rows are checked again now, so a capability whose slot no longer holds a different
     * device (it was changed since the conflict was raised) is left alone. The selection itself
     * goes through {@link selectDevice}'s object mode.
     *
     * @param id the conflict's `id`
     * @param replace the capabilities in which the device should replace the current one
     */
    async resolveConflict(id:string, replace:IncyclistCapability[]):Promise<void> {
        try {
            const entry = this.takePendingConflict(id)
            if (!entry)
                return

            const {udid, conflict} = entry
            const asked = conflict.conflicts.map( c=>c.capability)
            const stillConflicting = new Set(this.computeSelectionImpact(udid, asked).conflicts.map( c=>c.capability))
            const toReplace = (replace??[]).filter( c=> stillConflicting.has(c))

            if (toReplace.length>0) {
                const [first,...rest] = toReplace
                await this.selectDevice(first, udid, {others:'fill-empty', replace:rest})
            }
            this.logConflictResolved(conflict, 'done', toReplace.length)
        }
        catch(err) {
            this.logError(err,'resolveConflict')
        }
    }

    /**
     * Closes a pending conflict without changing anything: the current device is kept in every row.
     *
     * @param id the conflict's `id`
     * @param via whether the rider dismissed it, or left the page without answering
     */
    dismissConflict(id:string, via:ConflictDismissal='dismissed'):void {
        try {
            const entry = this.takePendingConflict(id)
            if (entry)
                this.logConflictResolved(entry.conflict, via, 0)
        }
        catch(err) {
            this.logError(err,'dismissConflict')
        }
    }

    protected dismissPendingConflicts(via:ConflictDismissal):void {
        const pending = this.pendingConflicts
        this.pendingConflicts = []
        pending.forEach( e=> { this.logConflictResolved(e.conflict, via, 0) })
    }

    protected takePendingConflict(id:string):{udid:string, conflict:SelectionConflict}|undefined {
        const idx = this.pendingConflicts.findIndex( e=>e.conflict.id===id)
        if (idx===-1)
            return undefined
        const [entry] = this.pendingConflicts.splice(idx,1)
        return entry
    }

    /**
     * A detected device was added: logs the empty slots it filled, and raises a conflict for the
     * slots it's newly known for that already hold a different device. Capabilities it was
     * retracted from again (deleted earlier in this session) are left out of both.
     */
    protected onDeviceAdded(udid:string, added:AddDeviceResult, retracted:IncyclistCapability[]):void {
        try {
            const autoSelected = added.autoSelected.filter( a=> !retracted.includes(a.capability))
            autoSelected.forEach( a=> {
                this.logEvent({message:'device auto selected', capability:a.capability, rule:a.rule, visitOpen:this.visitOpen})
            })

            const newlyKnown = added.newlyKnown.filter( c=> !retracted.includes(c))
            this.raiseDetectionConflict(udid, newlyKnown, autoSelected.map( a=>a.capability))
        }
        catch(err) {
            this.logError(err,'onDeviceAdded')
        }
    }

    // only a device that's newly known for a capability is asked about it, so a device already known
    // for it is never asked again; nothing is replaced until the rider answers
    protected raiseDetectionConflict(udid:string, newlyKnown:IncyclistCapability[], filled:IncyclistCapability[]):void {
        if (newlyKnown.length===0)
            return

        const {conflicts} = this.computeSelectionImpact(udid, newlyKnown)
        if (conflicts.length===0)
            return

        const deviceName = this.getCapabilityDevice(newlyKnown[0],udid)?.name
            ?? this.getDeviceConfiguration().getAdapter(udid)?.getUniqueName() ?? ''

        if (!this.visitOpen) {
            // no page to ask on: keep the current selection, as if the rider had left the page
            const conflict:SelectionConflict = {id:this.nextConflictId(udid), origin:'detection', deviceName, filled, conflicts}
            this.logConflictShown(conflict, conflicts.length, 0)
            this.logConflictResolved(conflict, 'left_page', 0)
            return
        }

        const conflict = this.addPendingConflict(udid, deviceName, filled, conflicts)
        this.logConflictShown(conflict, conflicts.length, this.pendingConflicts.length-1)
        this.emit('selection-conflict', clone(conflict))
    }

    // one entry per device: a device that raises another conflict in the same visit gets its rows added to its entry
    protected addPendingConflict(udid:string, deviceName:string, filled:IncyclistCapability[], conflicts:SelectionConflict['conflicts']):SelectionConflict {
        const existing = this.pendingConflicts.find( e=>e.udid===udid)?.conflict
        if (!existing) {
            const conflict:SelectionConflict = {id:this.nextConflictId(udid), origin:'detection', deviceName, filled, conflicts}
            this.pendingConflicts.push({udid, conflict})
            return conflict
        }

        filled.filter( c=> !existing.filled.includes(c)).forEach( c=> existing.filled.push(c))
        conflicts.filter( c=> !existing.conflicts.some( e=>e.capability===c.capability)).forEach( c=> existing.conflicts.push(c))
        return existing
    }

    protected nextConflictId(udid:string):string {
        return `${udid}:${++DevicePairingService.conflictCounter}`
    }

    // capability names and counts only: device names are never logged
    protected logConflictShown(conflict:SelectionConflict, conflictCount:number, queued:number):void {
        this.logEvent({
            message:'device select conflict shown',
            origin: conflict.origin,
            conflictCount,
            conflictCapabilities: conflict.conflicts.map( c=>c.capability).join(','),
            queued,
        })
    }

    protected logConflictResolved(conflict:SelectionConflict, resolution:'done'|ConflictDismissal, replacedCount:number):void {
        this.logEvent({
            message:'device select conflict resolved',
            origin: conflict.origin,
            resolution,
            replacedCount,
            conflictCount: conflict.conflicts.length,
        })
    }

    /**
     * Whether pairing has nothing left to do: every active capability is connected, and no device
     * excluded as `not-available` is still being waited for while a visit is open.
     *
     * Both pairing modes use this to decide whether to keep trying, so they agree on it.
     */
    isPairingSettled():boolean {
        return this.checkPairingComplete() && !this.isAwaitingExcludedDevice()
    }

    /** Whether a visit is open and a device excluded as `not-available` should still be tried. */
    protected isAwaitingExcludedDevice():boolean {
        if (!this.visitOpen)
            return false
        return this.getRevertableExclusions().length>0
    }

    protected getRevertableExclusions(udid?:string):CapabilityExclusion[] {
        return this.getDeviceConfiguration().getExclusions()
            .filter( e=> e.reason==='not-available' && (udid===undefined || e.udid===udid))
    }

    /**
     * A device excluded as `not-available` has connected. If a visit is open, it's taken back into
     * use for every capability it was excluded from.
     */
    protected revertExclusionsOnConnect(udid:string):void {
        try {
            if (!this.visitOpen || !udid)
                return

            const reverted = this.getRevertableExclusions(udid)
            if (reverted.length===0)
                return

            const configuration = this.getDeviceConfiguration()
            reverted.forEach( e=> { configuration.includeCapability(e.capability) })

            const now = Date.now()
            const since = Math.min(...reverted.map(e=>e.since))
            this.logEvent({
                message:'pairing fallback reverted',
                msSinceOpen: this.visitOpenedAt===undefined ? undefined : now-this.visitOpenedAt,
                msSinceFallback: now-since,
            })
            this.emit('exclusion-reverted', {udid, capabilities: reverted.map(e=>e.capability)})
        }
        catch(err) {
            this.logError(err,'revertExclusionsOnConnect')
        }
    }

    /**
     * The adapters of excluded devices that are still trying to connect. A device that is still in
     * use for a capability that isn't excluded is not included.
     */
    protected getExcludedPairingAttempts():AdapterInfo[] {
        try {
            const configuration = this.getDeviceConfiguration()
            const excluded = new Set(configuration.getExclusions().map(e=>e.udid))
            if (excluded.size===0)
                return []

            const inUse = new Set(configuration.getSelectedDevices().map(d=>d.selected))
            return (this.state?.adapters??[])
                .filter( ai=> excluded.has(ai.udid) && !inUse.has(ai.udid) && !ai.adapter?.isStarted())
        }
        catch(err) {
            this.logError(err,'getExcludedPairingAttempts')
            return []
        }
    }

    protected async stopPairingAttempts(adapters:AdapterInfo[]):Promise<void> {
        await Promise.allSettled( adapters.map( ai=> ai.adapter.stop()))
    }


    async prepareStart(adapterFilter:Array<string>=[]):Promise<void> {
        const stillPairing = this.isPairing()
        const stillScanning = this.isScanning()
        const adapters = this.state?.adapters??[]

        this.logEvent({message:'Stop Pairing (OK)', stillPairing,stillScanning})
        try {
            this.pauseAdapters(adapters.filter( a=> !adapterFilter.includes(a.udid)));

            // the ride won't use an excluded device, so a connection attempt still running for one is stopped
            const excludedAttempts = this.getExcludedPairingAttempts()
            if (excludedAttempts.length>0)
                await this.stopPairingAttempts(excludedAttempts)

            // Pairing is intentionally left running in the background here: the user is only
            // skipping the pairing *page*, not asking to abandon devices that may still connect.
            // Do NOT remove the pairing callbacks or discard state.check while a pairing operation
            // is genuinely in flight - they are the only way the background operation can still
            // update this.state.capabilities and be recognized as already-paired (via
            // isPairing()/checkPairingComplete()) if the Devices page is reopened before it completes.

            if (this.isScanning()) {
                this.state.stopRequested = true;
                await this._stop();
            }

            this.removeConfigHandlers()
            this.settings = {}
            this.state.initialized = false
            this.state.waiting = false;
            if (!stillPairing) {
                this.state.check = null;
            }
            this.state.scan = null;
            this.state.stopRequested = false;
            this.state.stopped = true
        }
        catch (err) { // istanbul ignore next
            this.logError(err,'prepareStart')
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
            // opening the list to browse does not switch the capability back on by itself: only
            // picking a device (select()) or the tile's own toggle (disableCapability(,false)) does
            const capabilityData = this.getCapability(capability)

            this.settings = Object.assign( this.settings||{}, {onDeviceSelectStateChanged,capabilityForScan:capability})
            const devices = capabilityData?.devices||[]
            const available = devices.filter( d=> this.isInterfaceEnabled(d.interface)).filter( d=> !this.isOnDeletedList(capability,d.udid))

            const startScan = async () => {
                if( devices.length>0)
                    await this.stopAdaptersWithCapability(capability)

                this.stopPairing().catch( err=>{ this.logError(err, 'startDeviceSelection') })
                this.emitStateChange({capabilities:this.state.capabilities})

                if( devices.length>0)
                    await this.stopAdaptersWithCapability(capability)

                await this.run({enforcedScan:true} )
            }

            this.deviceSelectState = {capability, devices:available}

            if (devices.length===0) {
                startScan().catch( err=>{ this.logError(err, 'startDeviceSelection') })
            }
            else {

                this.pauseScanDelay()
                  .then( ()=> {
                    if (this.deviceSelectState)
                        return startScan()
                })
                  .catch( err=>{ this.logError(err, 'startDeviceSelection') })
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
     * @param mode `true` selects the device for every capability it supports (today's "for all"), `false` (default)
     * this slot only, and `{others:'fill-empty', replace}` fills whatever is empty and replaces only the named
     * capabilities - both re-evaluated at commit, see {@link previewSelectDevice}
     *
     * @example
     * const service = useDevicePairing()
     * await service.selectDevice('control,'508c6bf1-3f2f-4e8d-bcef-bc1910bd2f07', true)
     *
     * @throws
     * Does not throw errors
     *
    */
   async selectDevice(capability:IncyclistCapability,udid:string, mode:SelectDeviceMode=false):Promise<void> {

        let changed:boolean = false;

        try {
            const adapter = this.getDeviceAdapter(udid)
            if (!adapter)
                return;

            if (mode===true) {
                const capabilities = adapter.getCapabilities().filter( name=> this.wouldChangeCapability(name,udid) )

                capabilities.forEach( (c,idx) => {
                    const shouldEmit = (idx===capabilities.length-1)
                    const wasChanged = this.selectCapabilityDevice(c,udid,shouldEmit)
                    changed = changed || wasChanged
                })
            }
            else if (mode && typeof mode==='object') {
                changed = this.selectDeviceObjectMode(capability,udid,mode)
            }
            else {
                changed = this.selectCapabilityDevice(capability,udid)
            }

            if (changed) {
                this.emitStateChange({capabilities:this.state.capabilities})

            }

            this.checkCanStart()
            await this._stopDeviceSelection(changed)

        }
        catch (err) { // istanbul ignore next
            this.logError(err, 'selectDevice',{capability,udid,mode})
        }
    }

    /**
     * What picking `udid` for `capability` would also do to the device's other capabilities:
     * which empty slots it would fill, which already hold it, and which hold a different device.
     * Skips a capability that's `disabled` or has this udid on its session delete list - the
     * object mode never touches those either, see {@link selectDeviceObjectMode}.
     */
    previewSelectDevice(capability:IncyclistCapability, udid:string):SelectionImpact {
        const adapter = this.getDeviceAdapter(udid)
        if (!adapter)
            return {filled:[], unchanged:[], conflicts:[]}

        const candidates = adapter.getCapabilities().filter( c=> c!==capability )
        return this.computeSelectionImpact(udid,candidates)
    }

    /**
     * Classifies each of `candidateCapabilities` by what picking `udid` for it would do right
     * now: empty (`filled`), already this device (`unchanged`), or holding a different device
     * (`conflicts`). Shared by the manual preview above and, later, by detection - manual passes
     * every other capability the device supports, detection passes only the ones it's newly
     * known for.
     */
    protected computeSelectionImpact(udid:string, candidateCapabilities:IncyclistCapability[]):SelectionImpact {
        const filled: IncyclistCapability[] = []
        const unchanged: IncyclistCapability[] = []
        const conflicts: Array<{capability:IncyclistCapability, currentName:string}> = []

        candidateCapabilities.forEach( capability => {
            const c = this.getCapability(capability)
            if (!c || c.disabled || this.isOnDeletedList(capability,udid))
                return

            if (c.selected===udid)
                unchanged.push(capability)
            else if (!c.selected)
                filled.push(capability)
            else
                conflicts.push({capability, currentName:c.deviceName})
        })

        return {filled, unchanged, conflicts}
    }

    /**
     * Selects `udid` for `capability`, then, for every other capability the device supports:
     * skips it if `disabled` or on this device's session delete list, otherwise fills it if
     * empty or replaces it if named in `mode.replace` - read fresh here rather than from a
     * caller's earlier {@link previewSelectDevice}, so a slot filled in the meantime is kept.
     */
    protected selectDeviceObjectMode(capability:IncyclistCapability, udid:string, mode:{others:'fill-empty', replace:IncyclistCapability[]}):boolean {
        let changed = this.selectCapabilityDevice(capability,udid,false)

        const adapter = this.getDeviceAdapter(udid)
        const others = adapter.getCapabilities().filter( c=> c!==capability )

        others.forEach( c => {
            const current = this.getCapability(c)
            if (!current || current.disabled || this.isOnDeletedList(c,udid))
                return

            const isEmpty = !current.selected
            const shouldReplace = mode.replace.includes(c)
            if (!isEmpty && !shouldReplace)
                return

            const wasChanged = this.selectCapabilityDevice(c,udid,false)
            changed = changed || wasChanged
        })

        return changed
    }

   /**
     * Should be called when the user want to delete a device. This device will then be removed from this capability
     * 
     * In case the debice was previously selected, the next device (by order in list) will become active
     * 
     * As the user might want to delete multiple devices, the screen will typically remain open
     * 
     * This method does not stop an ongoing scan. The device is added to a session-lifetime exclude list for
     * this capability though, so even if it is detected again in the scan (e.g. a cached/replayed
     * announcement), it will not reappear under this capability - other capabilities the device supports
     * (that it wasn't separately deleted from) are unaffected and will still show the device if announced.
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
                if (adapter)
                    adapter.stop();
            }

            if (deleteAll) {
                const adapter = this.getDeviceAdapter(udid)
                const capabilities = adapter.getCapabilities()
                


                capabilities?.forEach( (c,idx) => {
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
     * Should be called when the user wants to unselect all devices for a capability
     * 
     * 
     * @param capability the capability to be managed <br><br> One of ( 'control', 'power', 'heartrate', 'speed', 'cadence')
     * 
     * @example 
     * const service = useDevicePairing()
     * await service.unselectCapability('control)
     * 
     * @throws  
     * Does not throw errors
     * 
    */
    async unselectDevices(capability:IncyclistCapability):Promise<void> { 
        try  {
            const adapater = this.getDeviceConfiguration().getSelected(capability)
            // disable, don't unselect: the device stays remembered (getSelected()/getAdapters()
            // already ignore a disabled capability's selection), so switching the capability back
            // on restores the exact same device with no new scan. It also keeps a scan running
            // for a different capability from silently reselecting the same device meanwhile.
            this.getDeviceConfiguration().disableCapability(capability,true)

            if (adapater?.isStarted()) {
                this.restart().catch( err=>{ this.logError(err, 'unselectDevices') })
            }

        }
        catch(err) { // istanbul ignore next
            this.logError(err, 'deleteDevice')
        }

    }

    /**
     * Turns a capability the rider had switched off back on. The device is still remembered
     * (unselectDevices() only disables, it never unselects), so this restores the exact same
     * device with no new scan - restart() picks it straight back up.
     */
    useCapability(capability:IncyclistCapability):void {
        try {
            this.getDeviceConfiguration().disableCapability(capability,false)
            this.restart().catch( err=>{ this.logError(err,'useCapability') })
        }
        catch(err) { // istanbul ignore next
            this.logError(err, 'useCapability')
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

            this.getDeviceConfiguration().setInterfaceSettings(name,settings)

            
        }
        catch (err) { // istanbul ignore next
            this.logError(err,'changeInterfaceSettings')
        }
    }

    /**
     * Determines if the system is ready to start a ride.
     * 
     * @returns {boolean} True if the ride can start, based on the current state.
     */
    isReadyToStart():boolean {        
        return this.pairingConfirmed;
    }

    setReadyToStart() {
        this.pairingConfirmed = true
    }

    protected async restartPair() {
        if (!this.isPairing())
            return

        if (this.state.check?.to) 
            clearTimeout(this.state.check?.to)
        delete this.state.check;

        this.run().catch( err=>{ this.logError(err, 'restartPair') })
    }

    protected async restart() {


        const wasActive = this.isPairing() || this.isScanning()

        if (this.state.scanTo) {
            clearTimeout(this.state.scanTo)
            delete this.state.scanTo
            this.state.waiting = true
        }
        else {
            await this._stop();

        }

        if (this.state.tsPrevStart) {

            if (this.state.tsPrevStart===-1) {
                return
            }

            const timeSincePrev = Date.now()-this.state.tsPrevStart;
            if (timeSincePrev<3000) {
                this.state.tsPrevStart=-1
                await sleep( 3000-timeSincePrev)

                // D-1: -1 is only meant to block a *concurrent* restart() for the remainder of this
                // sleep - it used to rely on the run() call below (via startPairing()/
                // startScanning()) to replace it with a fresh timestamp, but both of those have
                // early-return paths (pairing already complete, already pairing, a scan path that
                // skips them) that never reach that line. When one of those paths was taken, -1
                // stuck around forever, and every later restart() hit the check above and bailed
                // out immediately - no pairing or scan ever ran again, leaving every tile 'waiting'.
                // The debounce window is over once this sleep ends, so release the sentinel here
                // regardless of what run() ends up doing.
                delete this.state.tsPrevStart
            }
        }
        
        

        if (wasActive) {
            await this.rideService.stop()

            await sleep(500)
            this.run().catch( err=>{ this.logError(err, 'restart') })
        }

        if (this.state.waiting) {
            this.state.waiting = false;
            this.run().catch( err=>{ this.logError(err, 'restart') })
        }
    }

    protected async _stop() {

        if (this.usage!=='page') {
            if (this.isPairing())
                await this.stopPairing();
            if (this.isScanning())
                await this.stopScanning();

        }

        (this.state.capabilities??[]).forEach(c => c.connectState='waiting')
        this.state.waiting = true;
    }


    protected getCapability(capability:IncyclistCapability|CapabilityData):CapabilityData {
        const target = typeof capability==='object' ? capability.capability: capability

        const {capabilities=[]} = this.state

        return capabilities.find( c=>c.capability===target)       
    }

    protected wouldChangeCapability(capability:IncyclistCapability|CapabilityData, udid:string) {
        const c = this.getCapability(capability)
        if (!c) return false;

        const wouldChange= c.selected!==udid && !this.isOnDeletedList(capability,udid)
        return wouldChange
    }

    protected getCapabilityDevice(capability:IncyclistCapability|CapabilityData,udid?:string):DevicePairingData {

        const c = this.getCapability(capability)
        if (!c?.devices)
            return

        if (udid) {
            return c.devices.find( d=> d.udid===udid && !this.isOnDeletedList(capability,udid))
        }
        else {
            return c.devices.find( d=> d.selected)
        }        
    }


    protected async onConfigLoaded  (capabilitiesLoaded:DeviceConfigurationInfo, interfacesLoaded:Array<InterfaceSetting>) {
        
        if (this.state.initialized)
            return

        this.state.capabilities = this.mappedCapabilities(capabilitiesLoaded)               
        this.state.canStartRide = this.getDeviceConfiguration().canStartRide()
        this.state.interfaces = this.access.enrichWithAccessState(interfacesLoaded)
        this.state.initialized = true;

        this.emitStateChange()
       
    }


    protected waitForInit():Promise<void> {
        if (this.state.initialized)
            return;

        return new Promise( done => {
            this.access = this.access || this.getDeviceAccess();
            this.rideService = this.rideService || this.getDeviceRide()
            this.onScanningDataHandler= this.rideService.onData.bind(this.rideService)

            if (this.getDeviceConfiguration().isInitialized()) {
                this.state.initialized = true;
                return done();
            }
            else {
                this.getDeviceConfiguration().once('initialized' ,(capabilitiesLoaded:DeviceConfigurationInfo, interfacesLoaded:Array<InterfaceSetting>)=>{
                    this.onConfigLoaded(capabilitiesLoaded,interfacesLoaded).catch( err=>{ this.logError(err,'waitForInit') })
                    done()
                })
                this.getDeviceConfiguration().init().catch( err=>{ this.logError(err,'waitForInit') })

            }
            
            
        })
    }
    
    protected getExternaState(toEmit?:PairingState ): PairingState {

        const newState = toEmit || this.state
        const state =  {...newState} as InternalPairingState

        // remove internal ino
        delete state.adapters
        delete state.check
        delete state.scan
        delete state.initialized
        delete state.props
        delete state.deleted
        delete state.waiting

        state.interfaces = state.interfaces?.filter( i=>!i.invisible)
        return state
    }

    protected emitStateChange(newState?:PairingState) {
        const {onStateChanged,onDeviceSelectStateChanged} = this.settings||{}

        
        this.checkCanStart()
        this.checkPairingStalled()

        // don't send any updates if we are stopping
        if (this.state.stopRequested)
            return;

        // we don't want to share adapters with consumer
        const state= this.getExternaState(newState)

        if (this.usage==='page') {
            this.emit('state-update')
        }
        

        if (onStateChanged && typeof onStateChanged ==='function') {
            onStateChanged( {...state}) 
        }

        if (onDeviceSelectStateChanged && typeof onDeviceSelectStateChanged==='function')
            onDeviceSelectStateChanged( this.getDeviceSelectionState() )
    }

    protected checkPairingStalled() {
        if (this.stalledLogged)
            return

        if (!this.isStalled()) {
            this.clearStalledTimer()
            return
        }

        if (!this.stalledTimer)
            this.stalledTimer = setTimeout( ()=>{ this.onPairingStalled() }, DevicePairingService.STALLED_AFTER_MS)
    }

    protected isStalled():boolean {
        if (this.isPairing() || this.isScanning())
            return false

        const selected = (this.state.capabilities??[]).filter( c=>isCapabilityActive(c) )
        return selected.length>0 && selected.every( c=>c.connectState==='waiting')
    }

    protected onPairingStalled() {
        delete this.stalledTimer
        if (this.stalledLogged || !this.isStalled())
            return

        this.stalledLogged = true
        // only enums, booleans and comma-joined interface/capability names and states: no object
        // arrays (a key must have one type across every event in the index), no device names or ids
        this.logEvent({
            message: 'pairing stalled',
            usage: this.usage,
            isPairing: this.isPairing(),
            isScanning: this.isScanning(),
            waiting: Boolean(this.state.waiting),
            sentinel: this.state.tsPrevStart===-1,
            interfaceStates: (this.state.interfaces??[]).map( i=>`${i.name}:${i.state}`).join(','),
            capabilityStates: (this.state.capabilities??[]).filter( c=>c.selected).map( c=>`${c.capability}:${c.connectState}`).join(','),
        })
    }

    protected clearStalledTimer() {
        if (this.stalledTimer)
            clearTimeout(this.stalledTimer)
        delete this.stalledTimer
    }

    protected emitStartStatus() {
        const {onStateChanged} = this.settings||{}
        const {canStartRide} = this.state

        if (this.usage==='page') {
            this.emit('state-update')
        }


        if (onStateChanged && typeof onStateChanged ==='function') {
            onStateChanged( {canStartRide}) 
        }

    }

    protected onInterfaceConfigChanged (ifName:string,settings:InterfaceSetting)  {
        this.logEvent({message:'Interface Config changed', interface:ifName, settings})

        const prev = this.state.interfaces;
        if (!prev)
            return;

        try {
            const current = getInterfaceSettings(ifName,prev)
            
            if (settings.enabled && !current.enabled) {
                const {port,protocol} = settings
                this.access.enableInterface(ifName,undefined, {port:Number(port),protocol,autoConnect:true})
                    .catch( err=>{ this.logError(err,'onInterfaceConfigChanged()') })

                this.selectFromInterface(ifName)


            }
            else if (!settings.enabled && current.enabled) {
                this.access.disableInterface(ifName)
                    .catch( err=>{ this.logError(err,'onInterfaceConfigChanged()') })
                this.unselectOnInterface(ifName);
                this.unselectDisabledInterfaces()
    


                this.stopAdaptersOnInterface(ifName).catch(err=>{
                    this.logError(err,'stopAdaptersOnInterface()')
                })
            }
            else {
                return;
            }

            current.enabled = settings.enabled
            current.port = settings.port
            current.protocol = settings.protocol

            

            this.emitStateChange()


            this.restart().catch( err=>{ this.logError(err,'onInterfaceConfigChanged()') })

        }
        catch (err) { // istanbul ignore next
            this.logError(err,'onInterfaceConfigChanged()')
        }

    }

    protected mergeState(current,update) {
        const {connectState,value,unit} = current
        update.devices.forEach( d=>  {
        
            if (!current.devices || current.devices.length===0)
                return; 
            const device = current.devices.find( c=> c.udid===d.udid )
            
            if (device) {
                const {connectState, value,unit} = device
                Object.assign(d,{connectState, value,unit})
            }
        })
        
        Object.assign(current,{...update},connectState,value,unit)
   
    }

    protected onConfigurationUpdate (update:DeviceConfigurationInfo) {

        //this.logEvent({message:'Capability Config changed', capabilities:update})

        try {
            const {capabilities} = this.state||{};
            const keys = Object.keys(update)

            keys.forEach( key => {
                const capability = update[key]
                const current = capabilities.find( c=>c.capability===key)
                if (current)
                    this.mergeState(current,this.mappedCapability(capability))
                else {
                    console.log('# capability not found ',key)
                } 

            })
            this.updateCapabilityConfig()

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

        this.logEvent({message:'interface state changed', interface:ifName, state:ifDetails.state})

        try {
           

            if (interfacesNew) {
                this.onNewInterface(interfacesNew)
                return 
            }

            if (prev) {
                

                const { restartScan, restartPair } = this.checkRequiredActions(ifDetails, current, ifName); 
                const changedIdx = prev.findIndex( i=>i.name===ifName)
                if (changedIdx!==-1) {
                    prev[changedIdx].isScanning = ifDetails.isScanning
                    prev[changedIdx].state = ifDetails.state
                }

                if (restartScan) {
                    this.restart().catch( err=>{ this.logError(err,'onInterfaceStateChanged()') })
                }
                if (restartPair && this.isInterfaceInUse(ifName)) {
                    this.restartPair().catch( err=>{ this.logError(err,'onInterfaceStateChanged()') })
                }

                this.emitStateChange( {interfaces:this.state.interfaces})
                
            }

        }
        catch (err) { // istanbul ignore next
            this.logError(err,'onInterfaceChanged()')
        }
    }

    protected async reconnectInterface(ifName: string, delay?:number) {
        if (delay && delay>0)
            await sleep(delay)

        try {
            await this.access.connect(ifName)
        }
        catch (err) {
            this.logError(err, 'reconnectInterface')
        }
    }

    protected checkRequiredActions(ifDetails: any, current: any, ifName: any ) {
        let restartScan = false
        let restartPair = false

        if (ifDetails.state === 'disconnected' && current.state !== 'disconnected') {
            // set all devices to failed state
            this.failAdaptersOnInterface(ifName);
            if (this.isPairing()) {


                const pairing = this.getPairingInterfaces();
                if (pairing.includes(ifName)) {
              
                        current.state = 'disconnected';
                        this.emitStateChange({ interfaces: this.state.interfaces });
                        this.reconnectInterface(ifName,1000).catch( err=>{ this.logError(err,'reconnectInterface') })
                }

            }
        }
        else if (ifDetails.state === 'unavailable' && current.state !== 'unavailable') {
            // set all devices to failed state
            this.disableAdaptersOnInterface(ifName);
            this.unselectOnInterface(ifName);
        }
        else if (ifDetails.state !== 'unavailable' && current.state === 'unavailable') {
            this.enableAdaptersOnInterface(ifName);
        }
        else if (ifDetails.state === 'connected' && current.state !== 'connected' && !this.isPairing() && !this.state.canStartRide) {
            restartScan = true;
        }
        else if (ifDetails.state === 'connected' && current.state !== 'connected' && this.isPairingWaiting()) {
            restartPair = true;
        }
        return { restartScan, restartPair };
    }

    protected onNewInterface(interfacesNew) {
        const getData = (i) => ( {name:i.name, enabled:i.enabled,state:i.state} )

        if ( !this.state.interfaces)
            this.state.interfaces  = (interfacesNew.map(getData))
        else {                            
            interfacesNew.forEach( i=> this.onInterfaceStateChanged(i.name,i))
        }

    }

    protected isInterfaceEnabled(target:string|InterfaceSetting) {
        
        const name = (typeof target ==='string') ? target: target.name; 
        if(name==='simulator' || name==='wifi')
            return true;
        const {interfaces } = this.state
        return interfaces.some( i=> i.name===name && i.enabled && i.state!=='unavailable')
    }

    protected isInterfaceInUse(target:string|InterfaceSetting) {
        
        const name = (typeof target ==='string') ? target: target.name; 
        const {capabilities} = this.state
        const res = capabilities.find( c=> c.interface===name)
        return res
    }

    protected logCapabilities ( capabilities?:Array<CapabilityData>) {
        const ci = capabilities||this.state.capabilities
        ci.forEach( c=> {
            const {devices=[],disabled} = c;
            const deviceNames = devices.filter(d=>!this.isOnDeletedList(c.capability,d.udid)).map(d=>d.name).join(';')
            const selected = devices.find( d => d.selected)?.name
            this.logEvent({message:'capability info', capability:c.capability,  devices: deviceNames,selected,disabled })
        })        
        return capabilities
    }

    protected initPairingCallbacks():void {
        this.removePairingCallbacks()
        const rideService = this.getDeviceRide()
        rideService.on('pair-success',this.onPairingSuccessHandler)
        rideService.on('pair-error',this.onPairingErrorHandler)
        rideService.on('data', this.onDeviceDataHandler)
        
    }

    protected removePairingCallbacks():void {

        const rideService = this.getDeviceRide()
        rideService.off('pair-success',this.onPairingSuccessHandler)
        rideService.off('pair-error',this.onPairingErrorHandler)
        rideService.off('data', this.onDeviceDataHandler)
    }

    protected initScanningCallbacks():void {

        // startScanning() restarts without going through stopScanning(), so a registration from
        // the previous scan must not be left behind
        this.access.off('device',this.onDeviceDetectedHandler)
        this.access.off('data', this.onDeviceDataHandler)

        this.access.on('device',this.onDeviceDetectedHandler)
        this.access.on('data', this.onDeviceDataHandler)
    }

    protected removeScanningCallbacks():void {
        this.access?.off('device',this.onDeviceDetectedHandler)
        this.access?.off('data', this.onDeviceDataHandler)    
        this.deregisterScanningDataHandlers()
    }



    /**
     * @param keepConnectAttempts leave capabilities/devices untouched that are connecting or have failed.
     *  Used when the update is derived from a device merely being detected: the outcome of a connection
     *  attempt is reported by the ride service ('pair-success' / 'pair-error') and must not be overwritten.
     *  This is decided per capability/device entry, as one device can serve several capabilities of
     *  which only some are being connected.
     */
    protected onPairingStatusUpdate( udid:string, connectState:DevicePairingStatus,notify:boolean=true, keepConnectAttempts:boolean=false) {
        const capabilities=this.state.capabilities
        let changed = false;

        capabilities.forEach (c => {

            if (c.selected===udid && !(keepConnectAttempts && this.isConnectAttemptState(c.connectState))) {
                if (c.connectState!==connectState) {
                    c.connectState = connectState
                    changed = true
                }
                if (c.connectState==='failed') {
                    delete c.value;
                    delete c.unit;
                }
            }
            const device = this.getCapabilityDevice(c)
            if (device?.udid===udid && !(keepConnectAttempts && this.isConnectAttemptState(device.connectState))) {
                device.connectState = connectState
            }
        })
        if (notify && changed) {
            if (this.settings.onStateChanged && typeof this.settings.onStateChanged === 'function') {
                this.settings.onStateChanged({capabilities})
            }
        }

        if (this.usage==='page') {
            this.emit('state-update')
        }

        // every connect path of both pairing modes (pairing success, detection during a scan,
        // an adapter found already running) ends up here
        if (connectState==='connected')
            this.revertExclusionsOnConnect(udid)
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
                if (!toBeStarted.some(ai => ai.udid === udid))
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
        if (!canProcess) {
            return;
        }


        capabilities.forEach( c=> {

            if (this.isOnDeletedList(c,udid))
                return;

            const unitInfo = Units.find( ui=> ui.capability === c.capability)
            const device =this.getCapabilityDevice(c,udid)

            // did the device capabilities change?
            const alphabetical = (a, b) => a.localeCompare(b);
            const known = capabilities.filter( c=> c.devices.some( d=> d.udid===udid)).map(c=>c.capability).sort(alphabetical).join(';')
            const current = this.getDeviceAdapter(udid)?.getCapabilities().sort(alphabetical).join(';')

            if (known!==current) {
                this.getDeviceConfiguration().updateCapabilities(udid)
            }
                
            
            

            if (unitInfo) {
                let value = data[unitInfo.value]?.toFixed(unitInfo.decimals)
                let unit = unitInfo.unit
                if (unitInfo.convert) {
                    const converted = this.convert(data[unitInfo.value],unitInfo.convert,unitInfo?.decimals)
                    value = converted.value
                    unit = converted.unit
                }

                if (c.selected===udid) {
                    c.value = value
                    c.unit = unit
                }
                if (device) {
                    device.value = value
                    device.unit = unit
                    device.connectState = 'connected'
                }
            }
           
        })

    
        this.emitStateChange({capabilities})
        if (this.usage==='page') {
            this.emit('state-update')
        }


    }

    protected convert(value:number, target:string, digits:number):{value:string, unit:string} {
        const [C,U] = this.getUnitConverter().getUnitConversionShortcuts()

        
        const numValue =  C(value,target)
        const unit= U(target)
        let strValue
        if (numValue===undefined || numValue===null || Number.isNaN(numValue))
            strValue = ''
        else    
            strValue = numValue.toFixed(digits??0)
        


        return {value:strValue,unit}
    }

    protected onDeviceDetected(deviceSettings:IncyclistDeviceSettings) {

        try {
            let added:AddDeviceResult|undefined
            const udid = this.getDeviceConfiguration().add(deviceSettings,{legacy:false, onAdded:(result)=>{ added=result }})
            this.logEvent({message:'device detected',device:deviceSettings,udid, isScanning:this.isScanning()})

            if(!udid) {
                this.logEvent({message:'device could not be added', reason:'add() failed'})
                return;
            }

            // add() just (re-)added this device to every capability it supports. If the user
            // deleted it from specific capabilities earlier in this session, retract it from
            // those capabilities only - a capability it was NOT deleted from should still show
            // the device if it's announced again (e.g. deleted from 'heartrate' but not 'power').
            // If it was deleted from every capability it supports, this naturally purges the
            // adapter/settings entirely too, via configuration.delete()'s own cascade - which also
            // means a *later* re-detection of the same physical device gets a brand-new udid (its
            // old adapter/settings row is gone, so add() can't recognize it). Match by settings
            // identity as a fallback so it's still recognized as "was deleted" and retracted again,
            // rather than reappearing under the new udid.
            const deletedCapabilities = (this.state.deleted||[])
                .filter( e=> e.udid===udid || (e.settings && this.getDeviceConfiguration().isEqualDeviceSettings(e.settings,deviceSettings)))
                .map( e=> e.capability)
            deletedCapabilities.forEach( capability => {
                this.getDeviceConfiguration().delete(udid,capability,true)
            })

            if (added)
                this.onDeviceAdded(udid, added, deletedCapabilities)

            const adapter = this.getDeviceConfiguration().getAdapter(udid)

            if (adapter) {
                adapter.onScanStart()
                this.markConnected(adapter, udid);
    
                if (this.isScanning() && this.state.scan.adapters) {
                    
                    if ( !this.state.scan.adapters.some( a=>a.udid===udid)  ) {
                        const handler = ( deviceSettings:DeviceSettings, data:DeviceData)=>{
                            this.onDeviceData(data,udid)
                        }
                        adapter.on('data',handler)
                        this.state.scan.adapters.push( {udid,adapter, handler})
                    }
        
                }
    
                this.checkCanStart()
            }
            else {
                this.logEvent({message:'Could not get adapter', deviceSettings})
            }
            
            // a device that was merely announced is not necessarily connected: entries that are
            // connecting or have failed keep their state
            this.onPairingStatusUpdate(udid,'connected',true,true)

        }
        catch(err) {
            this.logError(err,'onDeviceDetected')
        }
    }

    private markConnected(adapter: IncyclistDeviceAdapter, udid: string) {
        const capabilites = adapter.getCapabilities();

        capabilites.forEach(c => {

            if (this.isOnDeletedList(c,udid))
                return;

            const info = this.getCapability(c);
            if  (!info) {
                this.logEvent({message:'warning: capabability not found',c, caps:this.state.capabilities})
                return
            }
            let device = this.getCapabilityDevice(c, udid);

            if (device) {
                if (!this.isConnectAttemptState(device.connectState))
                    device.connectState = 'connected';
            }
            else {
                device = { udid, connectState: 'connected', selected: false, name: adapter.getUniqueName(), interface: adapter.getInterface() };
                info.devices.push(device);
            }

            if (info.selected === udid && !this.isConnectAttemptState(info.connectState)) {
                info.connectState = 'connected';
            }
        });
    }

    private isConnectAttemptState(connectState?:string):boolean {
        return connectState==='connecting' || connectState==='failed'
    }

    protected disconnectInterface(name:string):void {
        
        this.access.disableInterface(name)
            .catch ( (err) =>{ this.logError(err,'disableInterface')})
    }

    protected connectInterface(name:string):void {
        this.access.enableInterface(name)
            .catch ( (err) =>{ this.logError(err,'enableInterface')})
    }

    protected updateCapabilityConfig() {
        try {
            const {capabilities} = this.state

            capabilities.filter(c=>!!c).forEach(c => {
                if (c.connectState!=='connected' && c.selected && this.getDeviceAdapter(c.selected)?.isStarted() )
                    c.connectState = 'connected'

            })
        }
        catch(err) {
            console.log(err)
        }
    }


    protected checkCanStart():boolean {
        try {
            const prev = this.state.canStartRide
            const canStartRide = this.checkPairingSuccess()

            if (canStartRide!==prev) {
                this.state.canStartRide = canStartRide
                this.emitStartStatus()
            }
        }
        catch(err) {
            this.logError(err,'checkCanStart')
        }
        return this.state.canStartRide
    }

    /**
     * Determines if the pairing process was successful and the system is ready to start a ride.
     *
     * The method checks if at least one required device capability is connected using a priority hierarchy:
     * 1. Control device (smart trainer) - highest priority
     * 2. Power meter - if no control device is available
     * 3. Speed sensor - if neither control nor power devices are available
     *
     * The system is ready to start a ride only if:
     * - Device configuration is valid and ready
     * - Not currently scanning (or in page mode)
     * - At least one of the prioritized capabilities is connected
     *
     * @returns {boolean} True if pairing is successful and at least one required device is connected; false otherwise
     */
    checkPairingSuccess():boolean {
        const configReadyToRide = this.getDeviceConfiguration().canStartRide()

        if (!configReadyToRide || (this.isScanning() && this.usage!=='page' ))
            return false;

        const control = this.getCapability(IncyclistCapability.Control)
        const power = this.getCapability(IncyclistCapability.Power)
        const speed =  this.getCapability(IncyclistCapability.Speed)

        const controlActive = isCapabilityActive(control)
        const powerActive = isCapabilityActive(power)
        const speedActive = isCapabilityActive(speed)

        // a switched-off or excluded tier is skipped entirely, not treated as "still occupying
        // the slot" - a disabled Resistance tile with a connected power meter must not block
        // the ride on the power meter's tier
        const controlOK = (controlActive && control?.connectState==='connected')
        const powerOK = (!controlActive && powerActive && power?.connectState==='connected')
        const speedOK = (!controlActive && !powerActive && speedActive && speed?.connectState==='connected')

        const success = controlOK || powerOK || speedOK
            

        this.state.canStartRide = success
        return success
    }


    // returns true if all selected devices have been started
    checkPairingComplete():boolean {

        const incomplete = this.state.capabilities.find(c => {
            return (isCapabilityActive(c) && c.connectState !== 'connected')
        });

        return !incomplete
    }


    async stopScanning() {
        const props = this.state.props || {}
        if (this.isScanning()) {
            this.removeScanningCallbacks()
            this.pauseAdapters(this.state.adapters);
            this.logEvent({ message: 'Stop Scanning', props });
            await this.access.stopScan();
            this.cleanupScan()
        }
    }

    async stopPairing() {
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
        
        if (this.usage==='page')
            return;

        this.emit('run')

        // pairing already ongoing ? stop previous paring
        if ((this.isPairing() || this.isScanning()) && !this.state.waiting)  {
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

        const adapters = this.state.adapters = this.getDeviceConfiguration().getAdapters(false)

        const goodToGo = await this.rideService.waitForPreviousStartToFinish()
        if (!goodToGo)  {
            return;
        }

        const configOKToStart = this.getDeviceConfiguration().canStartRide()


        if (this.state.stopRequested || this.state.stopped) {
            this.state.stopped = true;
            this.state.stopRequested = false
            return;
        }

        //await this.waitForInterfacesInitialized()

        if (configOKToStart && !this.deviceSelectState && !props.enforcedScan)  {
            // ready to ride, but a device excluded as not available is still tried while the page is open
            if (this.checkPairingSuccess()!==true || this.isAwaitingExcludedDevice())
                await this.startPairing(adapters, props);
            else {
                this.logEvent({message:'Pairing completed'})
                this.prepareForRide()
            }

        }
        else {
            await this.startScanning(adapters, props);
        }
    }

    getState() {
        return this.state
    }

    prepareForRide() {
        this.initPairingCallbacks()
        this.resumeAdapters()
        this.emitStateChange()

    }

    async startPairing(adapters: AdapterInfo[], props: PairingProps) {
        if (this.isPairingSettled())  {
            if (this.usage==='page')
                this.emit('pairing-done');
            return;
        }

        // a pairing operation from an earlier (possibly already-closed) session is still genuinely
        // running (see prepareStart()) - don't start a second, overlapping attempt against hardware
        // that may already be connecting/connected. The still-running operation will emit its own
        // 'pairing-done' once it completes, which a freshly (re-)registered page picks up.
        if (this.isPairing() && this.state.check?.promise !== undefined) {
            return;
        }

        if (this.usage!=='page' && this.isPairing() )  {
            return;
        }

        const preparing = DevicePairingService.checkCounter++
        this.state.check={preparing}   // will cause that next call to isPairing() will be true
        this.state.interfaces = this.access.enrichWithAccessState(this.state.interfaces);
        
        this.emit('pairing-start');
        
        const { isReady, busyRequired } = this.isReadyToPair();


        if (!isReady) {
            this.logEvent({ message: 'Pairing: waiting for interfaces', interfaces:busyRequired?.name });

            this.state.check.to = setTimeout(() => {
                if (this.usage==='page') {
                    this.emit('pairing-done')
                    delete this.state.check
                    return;
                }


                if ( (!this.isPairing() || this.state.check.preparing===preparing) && !this.isScanning()) {
                    

                    const { isReady } = this.isReadyToPair();
                    if (isReady) {
                        delete this.state.check                    
                        //this.run()
                    }
                    
                }
            }, 1000);

            return;
        }
        
        this.state.tsPrevStart = Date.now();

        // unpause /adapt connectState for started adapters
        this.setPairingConnectState(adapters)
        this.resumeForPairing(adapters)
        
        this.emitStateChange({capabilities:this.state.capabilities})

        const selected = this.state.capabilities.map( c=>c.selected)

        const target = adapters.filter(ai => /*!ai.adapter.isStarted() &&*/ selected.includes(ai.udid));

        if ( this.usage!=='page' && this.isPairing() && this.state.check.preparing!==preparing) {
            return;
        }

        this.initPairingCallbacks();
        const selectedAdapters = target.map(ai=>({...ai, isStarted:false}))
        this.setRequestedCapabilties(selectedAdapters)

        this.onPairingStarted();
        const promise = this.rideService.startAdapters(selectedAdapters, 'pair');
        this.state.check={promise}


        this.logEvent({ message: 'Start Pairing', adapters, props });
        await this.state.check.promise;

        // if pairing was interrupted and a scan was started we don't need to continue here
        if (this.usage!=='page' && this.isScanning())
            return;

        this.checkCanStart()

        //targetResume.forEach( ai=> {ai.adapter.resume()})
        if (this.state.check)
            delete this.state.check

        this.emit('pairing-done');

        if (!this.isPairingSettled()) {
            this.logEvent({ message: 'Pairing done', adapters, props });
                await this.rideService.stop()

            if (this.usage==='page')
            return;

            await sleep(this.getPairingRetryDelay());
            if (!this.state.scan)
                this.run().catch( err=>{ this.logError(err,'startPairing') })
        }


    }

    protected setRequestedCapabilties(selectedAdapters: AdapterInfo[]) {
        selectedAdapters.forEach ( ai => {  
            const requested = this.state.capabilities.filter( c=> c.selected===ai.udid)  ?? []
            ai.capabilities = requested.map(c => c.capability);
            ai.isControl = requested.some(c => c.capability === 'control' || c.capability === 'power' || c.capability==='speed');
        })
    }

    private isReadyToPair() {
        const requiredInterfaces = this.getPairingInterfaces();



        const busyRequired = this.state.interfaces
            .filter(i => requiredInterfaces.includes(i.name))
            .find(i => i.enabled && i.state !== 'connected' && i.state !== 'unavailable');

        const isReady = true //busyRequired === undefined;

        return { isReady, busyRequired };
    }

    private setPairingConnectState(adapters: AdapterInfo[]) {
        this.state.capabilities.forEach(c => {
            c.connectState = c.connectState==='connected' ? 'connected' : 'waiting' 
        })


        const all = adapters??[]
        all.forEach(ai => {

            if (ai.adapter.isStarted() ) {
                this.state.capabilities.forEach(c => {
                    if (c.selected === ai.udid)
                        c.connectState = 'connected';
                    const device = this.getCapabilityDevice(c, ai.udid);
                    if (device)
                        device.connectState = 'connected';
                });
            }
            else {
                this.state.capabilities.forEach(c => {
                    if (c.selected === ai.udid)
                        c.connectState = 'connecting';

                    const device = this.getCapabilityDevice(c, ai.udid);
                    if (device)
                        device.connectState = 'connecting';
                });
            }

        });
    }
    private resumeForPairing(adapters: AdapterInfo[]) {

        const started = adapters.filter(ai => ai.adapter.isStarted());
        started.forEach(ai => {
            if (ai.adapter.isPaused())
                ai.adapter.resume();
        });
    }    

    async startScanning(adapters: AdapterInfo[], props: PairingProps) {
        this.state.interfaces = this.access.enrichWithAccessState(this.state.interfaces);

        
        let interfaces = this.state.interfaces.filter( i => this.isInterfaceEnabled(i) && i.state==='connected' )
                            .map(i=>i.name)


        if (this.isScanning()) {
            if (this.usage==='page')
                this.emit('scanning-done')
            return;
        }

        const preparing = DevicePairingService.scanCounter++
        this.state.scan={preparing,adapters:[]}   // will cause that next call to isPairing() will be true
                    

        if (interfaces.length===0) {
            if (this.state.scanTo) 
                return;

            this.state.scanTo = setTimeout(() => {
                delete this.state.scanTo
                if (this.usage==='page') {
                    this.emit('scanning-done')
                    delete this.state.scan
                    return;
                }

                if ( !this.isPairing() && (!this.isScanning()  || this.state.scan.preparing===preparing)) {
                    delete this.state.scan
                    this.run().catch( err=>{ this.logError(err,'startScanning') })
                }
            }, 1000);

            return;
        }


        this.emit('scanning-start')
        this.emitStateChange({capabilities:this.state.capabilities})

        this.state.tsPrevStart = Date.now();

        // multiple scans can be triggered within a few ms 

        if (this.usage!=='page' &&  this.isScanning() && this.state.scan.preparing!==preparing)
            return;


        this.logEvent({message:'Stopping Adapters',interfaces:interfaces.join(','),props})
        const stopPromises = []
        interfaces.forEach( i=> stopPromises.push(this.stopAdaptersOnInterface(i)))
        await Promise.allSettled(stopPromises)
        this.deregisterScanningDataHandlers()

        this.logEvent({message:'Start Scanning',interfaces:interfaces.join(','),props})
        this.initScanningCallbacks()
        
        const timeout = props.enforcedScan ? 1000*60*60 /*1h*/ : undefined
        interfaces = this.state.interfaces.filter( i => this.isInterfaceEnabled(i) && i.state==='connected' )
                            .map(i=>i.name)
        const promise = this.access.scan({interfaces,excludeDisabled:true},{includeKnown:props.enforcedScan, timeout})
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
        this.emitStateChange({capabilities:this.state.capabilities})
        

        if (this.usage==='page') {
            return;
        }
        // after timeout, re-start to either trigger pairing or scan again
        // we don't do this for enforced scans, as the don't have timeouts, i.e. are always trigger manually
        if (!props.enforcedScan) {

            this.cleanupScan()
            await sleep(500)
            this.run().catch( err=>{ this.logError(err,'startScanning') })
        }
        

        

    }

    protected deregisterScanningDataHandlers() {
        const ai = this.state.scan?.adapters
        if (!ai)
            return;

        ai.forEach( a=> {
            try {
                a.adapter?.onScanStop()
                a.adapter?.off('data',a.handler) 
            } 
            catch { // ignore
            }
        })

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

    protected disableAdaptersOnInterface(name:string) {
        const target = this.getAdaptersOnInterface(name)
        const {capabilities} = this.state


        target.forEach( ai => {
            const {udid} = ai;
            capabilities.forEach( c=> {
                const device = this.getCapabilityDevice(c,udid)
                if (device) {
                    device.interfaceInactive = true
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
                const device = this.getCapabilityDevice(c,udid)                
                if(device)
                    delete device.interfaceInactive 
            })
        })
    }



    protected unselectDisabledInterfaces() {
        const disabled = this.getDisabledInterfaces()
        disabled.forEach( i => this.unselectOnInterface(i.name) )    
    }

    
    protected unselectOnInterface(name: string) {
        const impactedCapabilties = this.getCapabilitiesUsingInterface(name);
        const enabledInterfaces = this.getEnabedInterfaces().filter(i => i.name !== name).map(i => i.name);

        impactedCapabilties.forEach(c => {
            const available = c.devices
                .filter(d => d.interface !== name && enabledInterfaces.includes(d.interface))
                .filter(d=>!this.isOnDeletedList(c,d.udid))

            if (!available?.length) {
                this.getDeviceConfiguration().unselect(c.capability, true);
            }
            else {
                this.getDeviceConfiguration().select(available[0].udid, c.capability, { emit: true });
            }
        });
    }

    protected selectFromInterface(name: string) {
        const impactedCapabilties = this.state.capabilities.filter( c=> !c.selected)
        const enabledInterfaces = this.getEnabedInterfaces().filter(i => i.name !== name).map(i => i.name);

        impactedCapabilties.forEach(c => {
            const available = c.devices
                .filter(d => d.interface === name || enabledInterfaces.includes(d.interface))
                .filter(d=>!this.isOnDeletedList(c,d.udid))


            if (available?.length>0) {
                this.getDeviceConfiguration().select(available[0].udid, c.capability, { emit: true });
            }
        });
    }


    protected getCapabilitiesUsingInterface(name: string):CapabilityData[] {
        return this.state.capabilities.filter(c => {
            return this.getCapabilityDevice(c)?.interface === name;
        });
    }

    protected getEnabedInterfaces():EnrichedInterfaceSetting[] {
        return this.state.interfaces.filter(i => i.enabled===true)
    }
    protected getDisabledInterfaces():EnrichedInterfaceSetting[] {
        return this.state.interfaces.filter(i => !i.enabled)
    }

    protected getPairingInterfaces():Array<string> {
        const interfaces = this.state.capabilities.map (ci=>ci.interface)
        const selected = []
        interfaces.forEach( i=> {
            if (!selected.includes(i))
                selected.push(i)
        })
        return selected;
    }



    protected getDeviceAdapter(udid:string) {
        const {adapters=[]} = this.state
        const target = adapters.find( ai=> ai.udid===udid )
        if (target?.adapter)
            return target?.adapter

        if (this.getDeviceConfiguration().getAdapter(udid)) {
            // Pairing Service and Device Config are out of sync, reload adapaters
            this.state.adapters = this.getDeviceConfiguration().getAdapters(false)            
            return this.getDeviceConfiguration().getAdapter(udid)
        }
    }

    protected async stopAdaptersWithCapability( capability:IncyclistCapability|CapabilityData,udid?:string) {

        const c = this.getCapability(capability)
        if(!c)
            return;
        
        const {adapters=[],capabilities} = this.state
        const maxRetries = 3;

        let target =  udid ? 
            adapters.filter( ai=> ai.udid!==udid && ai.adapter.hasCapability(c.capability) && ai.adapter.getInterface()!=='simulator' ) :
            adapters.filter( ai=> ai.adapter.hasCapability(c.capability) && ai.adapter.getInterface()!=='simulator' )
       
        // if one of the device is an Ant-Device, wee need to stop all other Ant-Devices
        // as Ant does not allow parallel scanning and pairing
        if (target.some( ai=>ai.adapter.getInterface()==='ant'))
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
        if (!adapters)
            return;

        const capabilities = this.state.capabilities??[];

        capabilities.forEach(c => {
            if (!enforced && !c.selected && c.connectState === 'failed')
                return;
            const adapter = adapters.find(ai => ai.udid === c.selected)?.adapter;
            adapter?.pause();

        });
    }

    protected resumeAdapters(adapters: AdapterInfo[]=this.state.adapters) {
        if (!adapters?.length)
            return;

        const capabilities = this.state.capabilities??[];

        capabilities.forEach(c => {
            if (!c.selected && c.connectState === 'failed')
                return;
            const adapter = adapters.find(ai => ai.udid === c.selected)?.adapter;
            adapter?.resume();

        });
    }


    protected getDeviceSelectionState():DeviceSelectState {
        const capability = this.settings.capabilityForScan
        const capabilityData = this.getCapability(capability)
        
        const devices = capabilityData?.devices||[]
        const available = devices.filter( d=> this.isInterfaceEnabled(d.interface))
        const isScanning = this.isScanning()
        return {capability, devices:available,isScanning}

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
       
        if (!this.wouldChangeCapability(capability,udid))
            return;

        const c = this.getCapability(capability)
        const device = this.getCapabilityDevice(capability,udid)        
        c.value = device?.value
        this.getDeviceConfiguration().select(udid,capability,{emit:emitUpdate})

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
            this.getDeviceConfiguration().unselect(capability,shouldEmit)
            c.value = undefined;
            c.connectState = undefined
        }
        
        // captured before delete() runs: if this is the device's last remaining capability,
        // delete() purges its adapter/settings entirely, so the udid can't be relied on to
        // recognize the same physical device again - the settings snapshot is the fallback.
        const settings = this.getDeviceAdapter(udid)?.getSettings?.() as IncyclistDeviceSettings

        // the 3rd parameter of DeviceConfigurationService.delete() is `forceSingle`, not `shouldEmit`.
        // deleteCapabilityDevice always deletes the device from this one capability only, so it must
        // always force a single-capability delete - otherwise, deleting the 'control'/'bike' capability
        // would cascade into removing the device from every capability it supports.
        this.getDeviceConfiguration().delete(udid,capability,true)
        this.addToDeletedList(capability,udid,settings)
        this.emitStateChange( {capabilities:this.state.capabilities})
    }

    isScanning() {
        return this.state.scan!==undefined && this.state.scan!==null
    }

    protected isPairing() {
        return this.state.check!==undefined && this.state?.check!==null
    }

    protected isPairingWaiting() {
        return this.isPairing() && this.state.check.to
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
            this.run().catch( err=>{ this.logError(err,'_stopDeviceSelection') })
        }
    }

    private numberOfSelectedCababilities(udid: string) {
        return (this.state.capabilities || []).map(c => c.selected === udid ? 1 : 0).reduce((a, c) => a + c, 0);
    }

    protected addToDeletedList(capability:IncyclistCapability|CapabilityData,udid:string,settings?:IncyclistDeviceSettings ) {
        if (this.isOnDeletedList(capability,udid))
            return;

        const c = this.getCapability(capability)
        this.state.deleted.push( { capability:c.capability,udid,settings })
    }

    protected isOnDeletedList(c:IncyclistCapability|CapabilityData,udid:string ):boolean {
        const capability = this.getCapability(c)

        return this.state.deleted.some( e=> e.capability===capability.capability && e.udid===udid)
    }

    mappedCapability (c:CapabilityInformation):CapabilityData {

        const {devices} = c;
    
        const mapped = {...c} as unknown  as CapabilityData
    
        const available = devices.filter( d=> !this.isOnDeletedList(c.capability as IncyclistCapability,d.udid))

        mapped.deviceNames = available.map(d=>d.name).join(';')
        mapped.selected = available.find( d => d.selected)?.udid
        mapped.deviceName = devices.find( d => d.selected)?.name
        mapped.interface = devices.find( d => d.selected)?.interface
        mapped.devices = devices as Array<DevicePairingData>
    
        return mapped
    }
    
    protected mappedCapabilities (capabilities:DeviceConfigurationInfo):Array<CapabilityData> {
        const caps = []
        const ci = capabilities ? Object.keys(capabilities) || [] : []
        ci.forEach( name=> {
            const c = capabilities[name]
            caps.push(this.mappedCapability(c))
        })        
        return caps
    }

    reset() {
        super.reset()

        if (this.state?.scanTo) {
            this.state.scanTo.unref()
            clearTimeout(this.state.scanTo)
        }

        if (this.state?.check?.to) {
            this.state.check.to.unref()
            clearTimeout(this.state.check.to)
        }
        this.removePairingCallbacks()
        this.removeScanningCallbacks()
        this.visitOpen = false
        delete this.visitOpenedAt
        this.pendingConflicts = []
    }

    @Injectable
    protected getUnitConverter() {
        return useUnitConverter()
    }

    @Injectable
    protected getDeviceConfiguration() {
        return this.configuration??useDeviceConfiguration()
    }

    @Injectable
    protected getDeviceAccess() {
        return this.access??useDeviceAccess()
    }

    @Injectable
    protected getDeviceRide() {
        return this.rideService??useDeviceRide()
    }

    
}


export const useDevicePairing = () => DevicePairingService.getInstance()



