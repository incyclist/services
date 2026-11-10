import { EventLogger } from 'gd-eventlog'
import { Injectable } from '../../../base/decorators'
import { IncyclistPageService } from '../../../base/pages'
import {
    useDevicePairing, PAIRING_CAPABILITY_ROLES, getCapabilityHelpText, getEmptyTileFooterText, getPairingGuidanceText,
    getPairingRowLabelId, getPairingStatusDisplay, getPairingTileState, isCapabilityActive,
    getFallbackActionLabel, getPairingHelperFooter, getPairingHelperReasonLabel, getPairingHelperTip, getPairingHelperTitle, hasContinueWithoutDeviceAction,
    PAIRING_HELPER_RESOLVED_TEXT, PAIRING_HELPER_SUBLINE,
    getCapabilityTitle, getConflictKeepLabel, getConflictQueuedText, getConflictReplaceLabel, getConflictStepSubline, getConflictStepTitle
} from '../../pairing'

import type { CapabilityDisplayProps, DeviceSelectionItemProps, DeviceSelectionProps, IObserver, PairingButtonProps, PairingDisplayProps, TConnectState, TDisplayCapability, TIncyclistCapability } from '../../../types'
import type {
    CapabilityData, ConflictDismissal, ContinueWithoutDeviceTarget, DevicePairingData, InternalPairingState, PairingHelperReason, PairingInterfaceState,
    PairingPlatform, PairingRole, PairingStatusDisplayProps, PairingStatusSource, PairingStatusTrainerPhase, PairingTileState, SearchStatus,
    PairingState, SelectDeviceMode, SelectionConflict
} from '../../pairing'
import { PageLogObserver } from './logobserver'
import { IncyclistCapability } from 'incyclist-devices'
import { useDeviceConfiguration } from '../../configuration'
import { usePairingVisitTracker } from './visit-log-factory'
import type { PairingVisitTracker } from './visit-log'
import type { ConflictChoice, ConflictStepProps, PairingExitVia, PairingHelperActionProps, PairingHelperDisplayProps } from './types'
import type { PairingHelperState } from './guidance/types'
import type { DesktopPairingDisplayProps } from '../desktop/types'
import type { PairingOrchestrator } from './orchestrator'
import { PairingGuidance } from './guidance'

/**
 * Pairing page logic shared by all platforms: page lifecycle, device list, tile and button props,
 * navigation handlers and visit tracking.
 *
 * Platform differences live in the abstract hooks: the orchestrator, the page display props and
 * any platform-only handlers in the subclass.
 */
export abstract class PairingPageService extends IncyclistPageService {

    protected promiseOpen:Promise<void>|undefined
    protected stateMachine: PairingOrchestrator
    protected logObserver:PageLogObserver
    protected _openedCapability: IncyclistCapability|undefined
    protected isPairingForRide: boolean = false
    protected isVisitOpen: boolean = false

    // set by onOK/onSimulate (via prepareForRide()) right before moveTo() navigates away - closePage()
    // reads it to skip the full stop() that would otherwise re-pause the adapter(s) just handed to
    // the ride. Deliberately separate from DevicePairingService.isReadyToStart(): that flag has its
    // own, broader meaning elsewhere (skip re-pairing on the *next* ride start) and Simulate must
    // never set it - only a confirmed real device should.
    protected handingOffToRide: boolean = false

    protected guidance: PairingGuidance
    protected onPairingStateHandler = this.onPairingState.bind(this)
    protected onExclusionRevertedHandler = this.onExclusionReverted.bind(this)
    protected onSelectionConflictHandler = this.updatePage.bind(this)

    // the second step of a pick in the Resistance list, while it's open, and the rider's choices in it
    protected conflictStep?: { conflict: SelectionConflict, choices: Map<IncyclistCapability, ConflictChoice> }
    // the rider's choices on the conflict card, for the conflict it shows
    protected cardChoices?: { id: string, choices: Map<IncyclistCapability, ConflictChoice> }

    constructor() {
        super('pairing')
        this.stateMachine = this.createOrchestrator()
        this.logObserver = new PageLogObserver('Pairing')
        this.guidance = new PairingGuidance({
            log: (message, fields)=>{ this.logEvent({message, ...fields}) },
            onChange: ()=>{ this.updatePage() },
            configuration: ()=>this.getDeviceConfiguration(),
        })
    }

    // the capability whose device list is open. The guidance hears about every change, from either
    // platform's list handling, so the helper waits while a list is open.
    protected get openedCapability(): IncyclistCapability|undefined {
        return this._openedCapability
    }

    protected set openedCapability(cap: IncyclistCapability|undefined) {
        this._openedCapability = cap
        this.guidance?.setDeviceListOpen(cap!==undefined)
    }

    /** The orchestrator that drives the pairing lifecycle for this platform. */
    protected abstract createOrchestrator(): PairingOrchestrator

    /** The display props for this platform's pairing screen. Desktop's interface shape differs
     * from mobile's (raw state vs. the 4-value display mapping, see page/types.ts), hence the union. */
    abstract getPageDisplayProperties(): PairingDisplayProps | DesktopPairingDisplayProps

    /**
     * The `DevicePairingService.usage` mode for this platform: 'page' drives pairing through the
     * state machine orchestrator (mobile); 'direct' makes `DevicePairingService` run its own
     * scan/pair loop (desktop). See `start()`.
     */
    protected abstract getUsageMode(): 'page' | 'direct'

    /** Which platform's status line rules and copy apply. */
    protected abstract getPlatform(): PairingPlatform

    openPage(forRide?:boolean):IObserver {
        try {
            this.logEvent({message:'page shown', page:'Pairing', forRide})
            this.isPairingForRide = forRide??false
            this.handingOffToRide = false
            this.openVisit()
            this.listenToPairingState(true)

            EventLogger.setGlobalConfig('page','Pairing')
            super.openPage()

            // shielding against duplicate calls
            if (this.promiseOpen!==undefined)  {
                return this.getPageObserver()
            }

            const onStateMachineUpdate = ()=>{
                this.updatePage()
            }

            this.stateMachine.start( onStateMachineUpdate)

            // self-heal: start() is a no-op (and logs an error) if the state machine wasn't
            // in 'Closed' state - this can happen if a previous session got stuck (e.g. an
            // earlier pairing/scanning reentrancy issue) and was never cleanly stopped. Without
            // this, openPage() would silently continue without ever wiring up
            // stateChangeCallback, leaving the Pairing screen stuck with no further updates.
            if (this.stateMachine.state!=='Idle') {
                this.logEvent({message:'state machine was not in expected state on open, resetting', page:'Pairing', state:this.stateMachine.state})
                // orchestrator.stop() is `Promise<void> | void` depending on implementation - fine
                // to not await here, start() right below re-arms regardless of when stop() settles
                void this.stateMachine.stop()
                this.stateMachine.start( onStateMachineUpdate)
            }

            this.promiseOpen = new Promise<void> ((done)=> {
                this.start()
                .catch( (err)=>{this.logError(err,'openPage')})
                .finally(done)
            })
            .then( ()=>{delete this.promiseOpen})


            }
        catch(err)  {
            this.logError(err,'openPage')

        }
        return this.getPageObserver()

    }

    closePage() {
        try {
            this.logEvent({message:'page closed', page:'Pairing'})
            this.isVisitOpen = false
            this.setPairingVisitOpen(false)
            this.listenToPairingState(false)
            this.trackVisit( t=>t.setExitFields(undefined), 'closePage')
            this.withGuidance( g=>g.closeVisit(), 'closeVisit')
            EventLogger.setGlobalConfig('page',null)
            this.isPairingForRide =false

            // stopped before the page observer is deleted, so the orchestrator is already winding
            // down when the observer goes away (see openPage(): stop() may or may not return a
            // promise). Whatever it still has in flight is fenced off by updatePage().
            void this.stateMachine.stop()

            super.closePage()

            // OK/Simulate already called prepareForRide(), which pauses every adapter except the
            // one(s) handed off to the ride - a plain stop() here (no adapter filter) would
            // re-pause those too, right as the ride page needs them. Skip/Cancel never prepare
            // for a ride, so handingOffToRide is still false there.
            if (!this.handingOffToRide)
                this.stop().catch( err=>{ this.logError(err,'closePage') })
            this.handingOffToRide = false

        }
        catch(err) {
            this.logError(err,'closePage')
        }
    }

    async pausePage() {
        try {
            this.trackVisit( t=>t.onBackground({canStartRide:this.canStartRide()}), 'onBackground')
            this.withGuidance( g=>g.pauseVisit(), 'pauseVisit')
            await this.stateMachine.pause()
            this.logEvent({message:'page paused', page:'Pairing'})
        }
        catch(err) {
            this.logError(err,'pausePage')
        }
    }

    async resumePage() {
        try {
            this.trackVisit( t=>t.onForeground(), 'onForeground')
            this.withGuidance( g=>g.resumeVisit(), 'resumeVisit')
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
        catch(err) {
            this.logError(err,'pausePage')
        }

    }

    protected getCapabilityDisplayProps(data:CapabilityData, noSearch:boolean=false):CapabilityDisplayProps {
        const {capability:cap,deviceName, connectState,value,unit,disabled} = data

        const capability = this.getTCapability(cap)
        const title = this.getDisplayCapability(cap)
        const openList = ()=> { this.openDeviceSelection(cap)}

        const role = PAIRING_CAPABILITY_ROLES.find( r=>r.capability===cap)?.role
        const helpText = {
            full: getCapabilityHelpText(capability, 'full') ?? '',
            short: getCapabilityHelpText(capability, 'short') ?? '',
        }

        // the rider turned this capability off (disabled, not merely unselected). This takes
        // priority over the "not searching" (S1) and case B framing. T16: a device is still
        // remembered (unselectDevices() keeps it, only disables the capability), shown dimmed
        // with a toggle that turns it straight back on, no new scan needed. T16b: nothing is
        // remembered (e.g. its device was deleted), shown as a plain tile inviting a fresh search.
        if (disabled) {
            return this.getDisabledCapabilityDisplayProps(data, {title,capability,role,helpText,onClick:openList})
        }

        const adapaters = this.state.adapters??[]
        const adapter = adapaters.find( ai=>data.selected && ai.udid===data.selected)
        const ifName = adapter?.adapter?.getInterface()

        const tileState = this.getTileState(data, role, noSearch)
        // a tile dimmed for the fallback has no switch; the Resistance tile's tap takes the trainer back
        const onUnselect = data.selected && !tileState.dimmed ? ()=> { this.onCapabilityUnselect(cap) } : undefined
        const useTrainerAgain = tileState.dimmed && cap===IncyclistCapability.Control
        const onClick = useTrainerAgain ? ()=> { this.onUseTrainerAgain() } : openList
        const emptyFooter = this.getActiveCapabilityEmptyFooter(cap, role, noSearch)

        // during a search, a device that was only seen and hasn't been started yet is "found", not connected
        const found = Boolean(data.selected) && this.getSearchStatus()?.running===true && adapter?.adapter?.isStarted()!==true
        const stateText = found ? 'Found' : undefined

        return {
            title, capability,deviceName, disabled:false, connectState,value:value?.toString(),unit,interface:ifName,
            role, helpText, emptyFooter, stateText,
            ...tileState,
            onClick, onUnselect
        }

    }

    // how the tile relates to the configured trainer, and whether the page is waiting for it
    protected getTileState(data:CapabilityData, role:CapabilityDisplayProps['role'], noSearch:boolean):PairingTileState {
        try {
            const control = (this.state.capabilities??[]).find( c=>c.capability===IncyclistCapability.Control)
            const { trainerPhase, trainerRetry, fallback } = this.guidance.getState()
            const { selectedReason, separateSensor } = this.guidance.getHelper()

            return getPairingTileState({
                capability: data.capability, role, disabled: data.disabled, selected: data.selected, connectState: data.connectState,
                noSearch, canStartRide: this.canStartRide(),
                trainerPhase, trainerRetry, trainerUdid: control?.selected,
                trainerUnavailablePicked: selectedReason==='trainer_unavailable',
                separateSensor: separateSensor!==undefined,
                fallbackActive: fallback!==undefined,
            })
        }
        catch(err) {
            this.logError(err,'getTileState')
            return { awaited:false }
        }
    }

    protected getDisabledCapabilityDisplayProps(data:CapabilityData, common:{title:TDisplayCapability,capability:TIncyclistCapability,role:CapabilityDisplayProps['role'],helpText:CapabilityDisplayProps['helpText'],onClick:()=>void}):CapabilityDisplayProps {
        const {capability:cap,deviceName} = data
        const {title,capability,role,helpText,onClick} = common
        const hasRememberedDevice = Boolean(deviceName)

        return {
            title, capability,
            deviceName: hasRememberedDevice ? deviceName : undefined,
            disabled: true,
            role, helpText,
            emptyFooter: hasRememberedDevice ? 'Not used' : 'Tap to search',
            // the page never waits for a capability the rider switched off
            awaited: false,
            onClick,
            onUse: hasRememberedDevice ? ()=> { this.onCapabilityUse(cap) } : undefined,
        }
    }

    protected getActiveCapabilityEmptyFooter(cap:IncyclistCapability, role:CapabilityDisplayProps['role'], noSearch:boolean):string|undefined {
        if (noSearch)
            return 'Not searching'
        if (role==='required' && this.getSearchStatus()?.ended)
            // the search is over: the page isn't looking for this one any more
            return cap===IncyclistCapability.Control && this.canStartRide() ? 'Not found · tap to search' : 'Not found'
        if (role)
            return getEmptyTileFooterText(role)
        return undefined
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
            onClick: (addAll?:boolean)=> {this.onDeviceSelected(d,addAll) },
            onDelete: ()=> {this.onDeviceDelete(d) }

        }))

        const disabled = devices.length>0 && !devices.some( d=> d.isSelected)

        const props:DeviceSelectionProps = {
            capability: this.openedCapability,
            devices,
            isScanning: this.stateMachine.selectState==='Active',
            changeForAll: false,
            canSelectAll: this.openedCapability==='control',
            disabled,

            onClose: ()=>{ this.closeDeviceSelection()},

        }
        return this.withConflictStep(props)
    }

    // the list's second step, while a pick in the Resistance list asks about slots held by another device
    protected withConflictStep(props:DeviceSelectionProps):DeviceSelectionProps {
        const step = this.conflictStep
        if (step) {
            props.conflictStep = this.getConflictStepProps(step.conflict, step.choices, 0, {
                onDone: ()=>{ this.closeConflictStep('done') },
                onDismiss: ()=>{ this.closeConflictStep('dismissed') },
            })
        }
        return props
    }

    /**
     * The card of the oldest conflict raised by the search, with the number of conflicts behind it.
     * Not set while the panel it takes is busy - the helper is shown, or a device list is open - so the
     * UI never checks that itself; the conflicts stay queued and the card comes back once both are closed.
     */
    protected getPendingConflictDisplayProps():ConflictStepProps|undefined {
        try {
            if (!this.isVisitOpen || this.isPanelSlotTaken())
                return undefined

            const pending = this.getDevicePairing().getPendingConflicts?.() ?? []
            const [head] = pending
            if (!head) {
                delete this.cardChoices
                return undefined
            }
            if (this.cardChoices?.id!==head.id)
                this.cardChoices = { id:head.id, choices:new Map() }

            return this.getConflictStepProps(head, this.cardChoices.choices, pending.length-1, {
                onDone: ()=>{ this.onConflictCardDone(head.id) },
                onDismiss: ()=>{ this.onConflictCardDismissed(head.id) },
            })
        }
        catch(err) {
            this.logError(err,'getPendingConflictDisplayProps')
            return undefined
        }
    }

    // the card shares its panel with the helper, also while the helper says the row is ready
    protected isPanelSlotTaken():boolean {
        if (this.openedCapability!==undefined)
            return true
        try {
            return this.guidance.getHelper().phase!=='hidden'
        }
        catch(err) {
            this.logError(err,'isPanelSlotTaken')
            return false
        }
    }

    protected getConflictStepProps(conflict:SelectionConflict, choices:Map<IncyclistCapability,ConflictChoice>, queued:number,
            handlers:Pick<ConflictStepProps,'onDone'|'onDismiss'>):ConflictStepProps {
        const {id, origin, deviceName, filled} = conflict
        const props:ConflictStepProps = {
            id, origin, deviceName,
            title: getConflictStepTitle(deviceName),
            subline: getConflictStepSubline(origin, deviceName, filled),
            rows: conflict.conflicts.map( c=>({
                capability: this.getTCapability(c.capability),
                capabilityTitle: getCapabilityTitle(c.capability),
                currentName: c.currentName,
                choice: choices.get(c.capability) ?? 'keep',
                keepLabel: getConflictKeepLabel(c.currentName),
                replaceLabel: getConflictReplaceLabel(deviceName),
            })),
            queued,
            onChoice: (capability, choice)=>{
                choices.set(capability as IncyclistCapability, choice)
                this.updatePage()
            },
            ...handlers,
        }
        const queuedText = getConflictQueuedText(queued)
        if (queuedText)
            props.queuedText = queuedText
        return props
    }

    protected getReplacedCapabilities(choices:Map<IncyclistCapability,ConflictChoice>):IncyclistCapability[] {
        return [...choices].filter( ([,choice])=>choice==='replace').map( ([capability])=>capability)
    }

    // the card's Done: the conflict itself is answered, so the other conflicts aren't checked again
    protected onConflictCardDone(id:string):void {
        const replace = this.getReplacedCapabilities(this.cardChoices?.choices ?? new Map())
        delete this.cardChoices
        this.getDevicePairing().resolveConflict(id, replace)
            .catch( err=>{ this.logError(err,'onConflictCardDone') })
        this.updatePage()
    }

    // the card's ✕: every current device is kept
    protected onConflictCardDismissed(id:string):void {
        delete this.cardChoices
        try {
            this.getDevicePairing().dismissConflict(id, 'dismissed')
        }
        catch(err) {
            this.logError(err,'onConflictCardDismissed')
        }
        this.updatePage()
    }

    /**
     * A selection changed somewhere other than in a conflict: the pending conflicts are checked again
     * right away, so the next page update never shows a conflict this change already settled.
     *
     * @param changed the capabilities whose selection changed; all are checked if not given
     */
    protected reevaluateConflicts(changed?:IncyclistCapability[]):void {
        try {
            this.getDevicePairing().reevaluatePendingConflicts?.(changed)
        }
        catch(err) {
            this.logError(err,'reevaluateConflicts')
        }
    }

    /**
     * Tells the UI to re-read the display props. A no-op once the page is closed: the scan/pair
     * loop and already-queued UI events can still call back after `closePage()` has deleted the
     * page observer.
     */
    protected updatePage() {
        this.getPageObserver()?.emit('page-update')
    }

    protected onEnableCapability(enabled:boolean) {
        const all = this.state.capabilities??[]
        const requested = all.find( c=>c.capability === this.openedCapability)
        requested.disabled = !enabled
        this.updatePage()

    }

    protected openDeviceSelection(cap:IncyclistCapability) {
        this.logEvent( {message:'capability clicked', capability:cap, eventSource:'user'})

        // opening the list to browse does not switch the capability back on by itself: only
        // picking a device (selectSingleDevice) or the tile's own toggle (onCapabilityUse) does
        this.openedCapability = cap;
        this.stateMachine.onDeviceSelectionOpened( ()=>{ this.updatePage() })
        this.updatePage()
    }

    protected onDeviceSelected (d:DevicePairingData,addAll?:boolean) {
        const capability = this.openedCapability
        this.logEvent( {message:'device selected', capability, device:d.name})

        // a pick in the Resistance list without the deprecated "for all" switch: free slots are filled,
        // and slots held by another device are asked about first
        if (capability===IncyclistCapability.Control && addAll===undefined) {
            this.onResistanceDevicePicked(d)
            return
        }

        this.closeDeviceSelection()
        this.selectDevice( capability, d.udid, addAll??false)
        this.updatePage()
    }

    protected onResistanceDevicePicked(d:DevicePairingData):void {
        const conflict = this.startManualConflict(d.udid)
        if (conflict) {
            this.conflictStep = { conflict, choices:new Map() }
            this.updatePage()
            return
        }

        this.closeDeviceSelection()
        this.selectDevice( IncyclistCapability.Control, d.udid, {others:'fill-empty', replace:[]})
        this.updatePage()
    }

    protected startManualConflict(udid:string):SelectionConflict|undefined {
        try {
            return this.getDevicePairing().startManualConflict?.(IncyclistCapability.Control, udid)
        }
        catch(err) {
            this.logError(err,'startManualConflict')
            return undefined
        }
    }

    // a pick in a device list; the pending conflicts are checked again before the page shows them
    protected selectDevice(capability:IncyclistCapability, udid:string, mode:SelectDeviceMode):void {
        this.getDevicePairing().selectDevice( capability, udid, mode)
            .catch( err=>{ this.logError(err,'onDeviceSelected') })
        this.reevaluateConflicts( mode===false ? [capability] : undefined)
    }

    // the list's second step closes: the pick is applied with the choices made in it
    protected closeConflictStep(via:'done'|ConflictDismissal):void {
        if (!this.commitConflictStep(via))
            return
        this.closeDeviceSelection()
        this.updatePage()
    }

    /** @returns whether a step was open */
    protected commitConflictStep(via:'done'|ConflictDismissal):boolean {
        const step = this.conflictStep
        if (!step)
            return false
        delete this.conflictStep

        this.getDevicePairing().commitManualConflict(step.conflict.id, this.getReplacedCapabilities(step.choices), via)
            .catch( err=>{ this.logError(err,'commitConflictStep') })
        this.reevaluateConflicts()
        return true
    }

    protected onCapabilityUnselect(cap:IncyclistCapability) {
        this.logEvent( {message:'capability unselect clicked', capability:cap, eventSource:'user'})

        // while the trainer connects or can't be reached, switching Resistance off means "my trainer
        // isn't available today": the helper opens, and the trainer stays the rider's trainer
        if (cap===IncyclistCapability.Control && this.getResistanceUnselectAction()==='open-helper') {
            this.withGuidance( g=>g.openHelperForUnavailableTrainer('tile_unselect'), 'onCapabilityUnselect')
            this.updatePage()
            return
        }

        this.getDevicePairing().unselectDevices(cap)
            .catch( err=>{ this.logError(err,'onCapabilityUnselect') })
        this.reevaluateConflicts([cap])

        this.updatePage()
    }

    protected getResistanceUnselectAction():'open-helper'|'unselect' {
        try {
            return this.guidance.getResistanceUnselectAction()
        }
        catch(err) {
            this.logError(err,'getResistanceUnselectAction')
            return 'unselect'
        }
    }

    // turns a switched-off capability (T16) back on, restoring its remembered device with no scan
    protected onCapabilityUse(cap:IncyclistCapability) {
        this.logEvent( {message:'capability use clicked', capability:cap, eventSource:'user'})

        this.getDevicePairing().useCapability(cap)
        this.reevaluateConflicts([cap])

        this.updatePage()
    }

    protected onDeviceDelete (d:DevicePairingData) {
        const capability = this.openedCapability
        this.logEvent( {message:'device delete requested', capability, device:d.name})

        this.getDevicePairing().deleteDevice( capability, d.udid)
            .catch( err=>{ this.logError(err,'onDeviceDelete') })
        this.reevaluateConflicts([capability])

        this.updatePage()
    }


    // closing the list never unselects: unselecting is done from the tile
    protected closeDeviceSelection() {
        // diagnostic: production logs have shown this firing multiple times while the
        // Pairing screen was reportedly not the active page - the caller could not be
        // confirmed from static analysis alone, so capture the call stack to identify it
        // the next time this is captured in production.
        this.logEvent( {message:'capability closed', capability:this.openedCapability, caller:new Error().stack})

        // closing the list during its second step (Esc, a tap outside) applies the choices made so far
        this.commitConflictStep('dismissed')

        this.openedCapability = undefined
        Promise.resolve(this.stateMachine.onDeviceSelectionClosed())
            .catch( err=>{ this.logError(err,'closeDeviceSelection') })
        this.updatePage()
    }

    // Simulate only makes sense when pairing for a ride - there's nothing to simulate when the
    // page was opened outside a ride (e.g. "Devices" in the desktop nav bar, or mobile's device
    // settings), so only Skip is offered there. Simulate itself used to also be gated on
    // DeviceRideService.canEnforceSimulator(), which protected the maps API key from being used
    // to simulate a GPX route without the rider's own key; that protection now belongs on the
    // ride page itself (falling back when there is no personal key), not here.
    //
    // While a search runs, OK isn't offered; Stop searching is, once something to ride with was found.
    // After a search that ended without a trainer, Search again is offered - next to OK if the ride is
    // ready, otherwise as the main action, but not while a found device is still connecting. It's
    // never offered when nothing can search (noSearch).
    protected getButtonsDisplayProps(noSearch:boolean=false) : PairingButtonProps{
        const labelOK = this.isPairingForRide ? 'Start' : 'OK'
        const labelSkip = this.isPairingForRide ? 'Cancel' : 'Skip'
        const search = this.getSearchStatus()
        const skip = (primary:boolean) => ({ label:labelSkip, primary, onClick:this.onSkip.bind(this) })
        const searchAgain = (primary:boolean) => ({ label:'Search again', primary, onClick:this.onSearchAgain.bind(this) })

        if (search?.running && search.canStop)
            return [
                { label:'Stop searching', primary:true, onClick:this.onStopSearch.bind(this) },
                skip(false)
            ]

        const offerSearchAgain = !noSearch && search?.canSearchAgain===true

        if (this.canStartRide()) {
            const ok = { label:labelOK, primary:true, onClick:this.onOK.bind(this) }
            return offerSearchAgain ? [ ok, searchAgain(false) ] : [ ok ]
        }

        const nothingFound = offerSearchAgain && !search?.rideCapableFound

        if (!this.isPairingForRide)
            return nothingFound ? [ searchAgain(true), skip(false) ] : [ skip(true) ]

        if (nothingFound)
            return [
                searchAgain(true),
                { label:'Simulate', primary:false, onClick:this.onSimulate.bind(this) },
                skip(false)
            ]

        return [
            { label:'Simulate', primary:true, onClick:this.onSimulate.bind(this) },
            { label:labelSkip, primary:false, onClick:this.onSkip.bind(this) }
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


    protected trackVisit( fn:(tracker:PairingVisitTracker)=>void, name:string):void {
        try {
            fn(this.getPairingVisitTracker())
        }
        catch(err) {
            this.logError(err,name)
        }
    }

    protected openVisit():void {
        // runs on every open, also when a visit is already open: the pairing service clears
        // the exclusions that last until the next visit each time
        this.setPairingVisitOpen(true)

        if (this.isVisitOpen)
            return
        let visitId:string|undefined
        this.trackVisit( t=>{ visitId = t.openVisit({forRide:this.isPairingForRide})?.visitId }, 'openVisit')
        this.withGuidance( g=>{
            g.openVisit({visitId, platform:this.getPlatform(), forRide:this.isPairingForRide})
            g.setDeviceListOpen(this.openedCapability!==undefined)
        }, 'openVisit')
        // whichever way the visit ends - also by app exit - its exit event carries the guidance fields
        this.trackVisit( t=>t.setExitFields( ()=>({...this.guidance.getExitFields()}) ), 'openVisit')
        this.isVisitOpen = true
    }

    protected closeVisit(via:PairingExitVia):void {
        // a pick in the Resistance list still asking about slots is applied with the choices made so far
        this.commitConflictStep('left_page')
        delete this.cardChoices
        this.trackVisit( t=>t.closeVisit(via,{canStartRide:this.canStartRide()}), 'closeVisit')
        this.trackVisit( t=>t.setExitFields(undefined), 'closeVisit')
        this.withGuidance( g=>g.closeVisit(), 'closeVisit')
        this.isVisitOpen = false
        this.setPairingVisitOpen(false)
    }

    protected withGuidance( fn:(guidance:PairingGuidance)=>void, name:string):void {
        try {
            fn(this.guidance)
        }
        catch(err) {
            this.logError(err,name)
        }
    }

    // observes the pairing state alongside the orchestrator, which keeps the onStateChanged callback
    protected listenToPairingState(listen:boolean):void {
        try {
            const pairing = this.getDevicePairing()
            pairing.off?.('pairing-state', this.onPairingStateHandler)
            pairing.off?.('exclusion-reverted', this.onExclusionRevertedHandler)
            pairing.off?.('selection-conflict', this.onSelectionConflictHandler)
            if (listen) {
                pairing.on?.('pairing-state', this.onPairingStateHandler)
                pairing.on?.('exclusion-reverted', this.onExclusionRevertedHandler)
                pairing.on?.('selection-conflict', this.onSelectionConflictHandler)
            }
        }
        catch(err) {
            this.logError(err,'listenToPairingState')
        }
    }

    protected onPairingState(state:PairingState):void {
        this.withGuidance( g=>g.onPairingState(state), 'onPairingState')
    }

    // a device excluded as not available connected while the page is open, and is in use again
    protected onExclusionReverted(event:{udid:string}):void {
        this.withGuidance( g=>g.onFallbackReverted(event?.udid), 'onExclusionReverted')
        this.updatePage()
    }

    /**
     * The status line, from the page's current state and the guidance it tracks.
     *
     * @param interfaces the interface states the status line considers (each platform decides which)
     */
    protected getStatusDisplayProps(interfaces:ReadonlyArray<PairingInterfaceState>):PairingStatusDisplayProps {
        const src:PairingStatusSource = {
            platform: this.getPlatform(),
            interfaces,
            capabilities: this.state.capabilities??[],
            canStartRide: this.canStartRide(),
            loading: this.promiseOpen!==undefined,
            rideMode: this.isPairingForRide,
            ...this.getSearchStatusSource(),
        }
        try {
            return this.guidance.getStatus(src)
        }
        catch(err) {
            // without the guidance, the status line still follows the pairing state
            this.logError(err,'getStatusDisplayProps')
            return getPairingStatusDisplay(src)
        }
    }

    /**
     * The tiles in their rows - required first, then optional, in tile order - and the row labels.
     *
     * @param noSearch nothing can search (the status line says so), so tiles don't claim to be searching
     */
    protected getCapabilityRowsDisplayProps(noSearch:boolean):NonNullable<PairingDisplayProps['capabilities']> {
        const caps = this.state.capabilities??[]
        const capProps = caps.map( c=>this.getCapabilityDisplayProps(c, noSearch))

        const row = (role:PairingRole) => PAIRING_CAPABILITY_ROLES
            .filter( r=>r.role===role)
            .map( r=>capProps.find( c=>c.capability===this.getTCapability(r.capability)))
            .filter( c=>c!==undefined)

        const trainerSelected = isCapabilityActive(caps.find( c=>c.capability===IncyclistCapability.Control))
        const fallbackReady = this.isFallbackActive() && this.canStartRide()
        return {
            top: row('required'),
            bottom: row('optional'),
            rowLabels: {
                top: getPairingGuidanceText(getPairingRowLabelId(trainerSelected, this.isStillLooking(), this.getTrainerPhase(), fallbackReady)),
                bottom: getPairingGuidanceText('row-optional'),
            },
        }
    }

    // the ride falls back to another device because the trainer isn't available
    protected isFallbackActive():boolean {
        try {
            return this.guidance.getState().fallback!==undefined
        }
        catch(err) {
            this.logError(err,'isFallbackActive')
            return false
        }
    }

    // the configured trainer's connection phase; unknown if the guidance can't tell
    protected getTrainerPhase():PairingStatusTrainerPhase|undefined {
        try {
            return this.guidance.getState().trainerPhase
        }
        catch(err) {
            this.logError(err,'getTrainerPhase')
            return undefined
        }
    }

    /** The guidance part of the display props. Not yet rendered by any consumer. */
    protected getGuidanceDisplayProps():Pick<PairingDisplayProps,'pairingCase'|'trainerPhase'|'helper'> {
        try {
            const {pairingCase, trainerPhase} = this.guidance.getState()
            return {pairingCase, trainerPhase, helper:this.getHelperDisplayProps()}
        }
        catch(err) {
            this.logError(err,'getGuidanceDisplayProps')
            return {}
        }
    }

    protected getHelperDisplayProps():PairingHelperDisplayProps|undefined {
        if (!this.isVisitOpen)
            return undefined

        const helper = this.guidance.getHelper()
        const {platform, selectedReason, separateSensor} = helper
        const trainerConfigured = helper.trainerPhase!==undefined

        const props:PairingHelperDisplayProps = {
            phase: helper.phase,
            title: getPairingHelperTitle(trainerConfigured),
            reasons: helper.reasons.map( id=>({
                id,
                label: getPairingHelperReasonLabel(id, platform),
                selected: id===selectedReason,
                onSelect: ()=>{ this.onHelperReasonSelected(id) },
            })),
            footer: getPairingHelperFooter(trainerConfigured),
            onOpen: ()=>{ this.onHelperOpen() },
            onDismiss: ()=>{ this.onHelperDismissed() },
        }

        if (helper.phase==='resolved')
            props.resolvedText = PAIRING_HELPER_RESOLVED_TEXT

        if (!selectedReason) {
            props.subline = PAIRING_HELPER_SUBLINE
            return props
        }

        props.tip = getPairingHelperTip(selectedReason, {platform, separateSensor})
        const action = this.getHelperActionProps(selectedReason, helper)
        if (action)
            props.action = action
        return props
    }

    // under "not available today": riding on the separate device if there is one, otherwise the no-device action
    protected getHelperActionProps(reason:PairingHelperReason, helper:PairingHelperState):PairingHelperActionProps|undefined {
        const {fallbackCandidate, separateSensor} = helper
        if (reason==='trainer_unavailable' && fallbackCandidate)
            return { label: getFallbackActionLabel(fallbackCandidate), onClick: ()=>{ this.onChooseFallback() } }

        if (!hasContinueWithoutDeviceAction(reason, separateSensor))
            return undefined

        const {label, note} = this.guidance.getContinueWithoutDeviceAction()
        const action:PairingHelperActionProps = { label, onClick: ()=>{ this.onContinueWithoutDevice() } }
        if (note)
            action.note = note
        return action
    }

    /** The rider chose to ride on the separate power meter or speed sensor while the trainer isn't available. */
    protected onChooseFallback():void {
        this.withGuidance( g=>{ g.chooseFallback() }, 'onChooseFallback')
        this.updatePage()
    }

    /**
     * The rider tapped the dimmed Resistance tile while the ride falls back to another device: the
     * trainer is taken back into use, and a connection attempt starts right away, so the page goes
     * straight to trying to reach it instead of waiting for the next automatic attempt.
     */
    protected onUseTrainerAgain():void {
        this.logEvent( {message:'use trainer again clicked', eventSource:'user'})

        let started = false
        this.withGuidance( g=>{
            g.cancelFallback()
            started = g.startRiderRetry({trigger:'tile'})
        }, 'onUseTrainerAgain')

        const covered = this.reconnectNow()
        if (started)
            this.withGuidance( g=>g.logRiderRetry(covered), 'onUseTrainerAgain')

        this.updatePage()
    }

    protected reconnectNow():IncyclistCapability[] {
        try {
            return this.getDevicePairing().reconnectNow() ?? []
        }
        catch(err) {
            this.logError(err,'reconnectNow')
            return []
        }
    }

    // the status line's link: while the trainer can't be reached it's "not available today?"
    protected onHelperOpen():void {
        if (this.getTrainerPhase()==='unavailable') {
            this.onTrainerUnavailable()
            return
        }
        this.withGuidance( g=>g.openHelper(), 'onHelperOpen')
        this.updatePage()
    }

    /** The status line's "not available today?" link: the helper opens with that answer picked. */
    protected onTrainerUnavailable():void {
        this.withGuidance( g=>g.openHelperForUnavailableTrainer('trainer_unavailable_link'), 'onTrainerUnavailable')
        this.updatePage()
    }

    protected onHelperDismissed():void {
        this.withGuidance( g=>g.dismissHelper(), 'onHelperDismissed')
        this.updatePage()
    }

    protected onHelperReasonSelected(reason:PairingHelperReason):void {
        this.withGuidance( g=>g.selectReason(reason), 'onHelperReasonSelected')
        this.updatePage()
    }

    /**
     * The helper's no-device action. It runs this page's own Simulate, Skip or Cancel, so a
     * platform's override of those applies here too.
     */
    protected onContinueWithoutDevice():void {
        const target = this.getContinueWithoutDeviceTarget()
        if (target==='simulate')
            this.onSimulate()
        else if (target==='cancel')
            this.onCancel()
        else
            this.onSkip()
    }

    protected getContinueWithoutDeviceTarget():ContinueWithoutDeviceTarget {
        try {
            return this.guidance.continueWithoutDevice()
        }
        catch(err) {
            // the rider still gets away from the page
            this.logError(err,'onContinueWithoutDevice')
            return this.isPairingForRide ? 'cancel' : 'skip'
        }
    }

    protected setPairingVisitOpen(open:boolean):void {
        try {
            this.getDevicePairing().setVisitOpen(open)
        }
        catch(err) {
            this.logError(err,'setPairingVisitOpen')
        }
    }

    // ready to ride right now: never while the page's search is still running
    protected canStartRide():boolean {
        if (this.getSearchStatus()?.running)
            return false
        return this.state?.canStartRide ?? false
    }

    protected getSearchStatus():SearchStatus|undefined {
        try {
            return this.getDevicePairing().getSearchStatus?.()
        }
        catch(err) {
            this.logError(err,'getSearchStatus')
            return undefined
        }
    }

    protected isSearchEndedWithNothing():boolean {
        const search = this.getSearchStatus()
        return search?.ended===true && !search.rideCapableFound
    }

    // the search is running and has found something to ride with, but is still looking for more.
    // Shown with the same delay as Stop searching, so a fast, complete search never flashes it.
    protected isStillLooking():boolean {
        const search = this.getSearchStatus()
        return search?.running===true && search.canStop
    }

    /** The search state the status line needs, for {@link getPairingStatusDisplay}. */
    protected getSearchStatusSource():{searchEndedWithNothing:boolean, stillLooking:boolean, missing:string[], searchEndedWithoutTrainer:boolean} {
        const search = this.getSearchStatus()
        return {
            searchEndedWithNothing: this.isSearchEndedWithNothing(),
            stillLooking: this.isStillLooking(),
            missing: search?.missing ?? [],
            searchEndedWithoutTrainer: search?.ended===true && !search.trainerFound,
        }
    }

    protected onStopSearch():void {
        this.logEvent( {message:'stop searching clicked', eventSource:'user'})
        this.getDevicePairing().stopSearch()
        this.updatePage()
    }

    protected onSearchAgain():void {
        this.logEvent( {message:'search again clicked', eventSource:'user'})
        this.getDevicePairing().searchAgain()
        this.updatePage()
    }

    protected onSkip():void {
        this.closeVisit('skip')
        const nextPage = this.getAppState().getPersistedState('page')??'routes'
        this.moveTo(`/${nextPage}`)

    }

    // prepares DevicePairingService for hand-off to the ride (pausing every adapter except
    // `adapterFilter`) and flags closePage() to skip its own, unfiltered stop() - shared by
    // onOK/onSimulate on both platforms.
    protected prepareForRide(adapterFilter:Array<string>=[]):void {
        this.getDevicePairing().prepareStart(adapterFilter)
            .catch( err=>{ this.logError(err,'prepareForRide') })
        this.handingOffToRide = true
    }

    protected onOK():void {
        this.closeVisit('ok')
        this.prepareForRide()
        this.getDevicePairing().setReadyToStart()
        this.getAppState().setState('paired',true)

        const prevContentPage = this.getPrevContentPage()
        const prevPage = this.getAppState().getState('prevPage')
        if (!prevPage) { // we just launched, go to content selection page
            this.moveTo(`/${prevContentPage}`)
        }
        else { // we were called from somewhere
            if (this.isPairingForRide)
                this.moveTo('/rideDeviceOK')
            else
                this.moveTo(`/${prevContentPage}`)

        }

    }

    protected onSimulate():void {
        this.closeVisit('simulate')
        const simulator = this.getDeviceConfiguration().getSimulatorAdapterId()
        this.prepareForRide([simulator])

        const prevContentPage = this.getPrevContentPage()

        if (this.isPairingForRide)
            this.moveTo('/rideSimulate')
        else
            this.moveTo(`/${prevContentPage}`)
    }

    protected onCancel():void {
        this.closeVisit('cancel')
        const nextPage = this.getAppState().getState('prevPage')
        this.moveTo(`/${nextPage}`)
    }



    protected async start( ) {
        this.getDevicePairing().usage = this.getUsageMode()
        this.getDevicePairing().start( ()=>{
            this.updatePage()
        }).catch( err=>{ this.logError(err,'start') })
    }

    async stop(adapters:Array<string>=[],forExit:boolean=false ):Promise<void> {
        return await this.getDevicePairing().stop(adapters,forExit)
    }

    protected get state():InternalPairingState {
        return this.getDevicePairing().getState()
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
    protected getPairingVisitTracker():PairingVisitTracker {
        return usePairingVisitTracker()
    }
}
