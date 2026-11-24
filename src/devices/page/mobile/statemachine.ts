import { EventLogger } from 'gd-eventlog'
import { Injectable } from '../../../base/decorators'
import { useDevicePairing } from '../../pairing'
import type {PageState, SelectState} from '../base/types'
import { useDeviceConfiguration } from '../../configuration'
import { EventEmitter } from 'node:stream'
import { getBindings } from '../../../api'

const PAIRING_RETRY_DELAY = 2000
const SCANNING_RETRY_DELAY = 2000

export class PairingPageStateMachine {

    protected _state: PageState = 'Closed'
    protected _selectState: SelectState = 'Closed'
    protected logger: EventLogger
    protected eventHandlers: Record<string,any> = {}
    protected internalEvents: EventEmitter = new EventEmitter()
    protected stateChangeCallback: ()=>void
    protected selectStateChangeCallback: ()=>void
    protected retryTimeout: NodeJS.Timeout|undefined
    protected selectionTimeout: NodeJS.Timeout|undefined
    // in-flight markers used to prevent overlapping startPairing()/startScanning() calls
    // being triggered while a previous call from this same session hasn't settled yet
    // (see performCheck()) - overlapping calls used to race against each other and could
    // leave the state machine stuck in 'Pairing'/'Scanning' with no path back to 'Idle'
    protected pairingPromise: Promise<void>|undefined
    protected scanningPromise: Promise<void>|undefined

    // Session token: incremented by start(), stop() and pause(). Every continuation (await, timer, promise
    // callback) that outlives the call that created it captures the value and drops itself if the session
    // has ended meanwhile, so a leave can never be followed by work from the visit that was left.
    protected epoch: number = 0
    protected stoppedAt: number|undefined
    // the stopPairing()/stopScanning() call of this session; the selection timeout and the list close share it
    protected stopWorkPromise: Promise<void>|undefined
    // kept across pause() so that resume() can open the session again
    protected resumeCallback: (()=>void)|undefined
    // the attempt and the scan this session is waiting for: events of any other one are ignored
    protected currentAttemptId: number|undefined
    protected currentScanId: number|undefined
    // the attempt was started by a visit before this one
    protected adoptedAttempt = false

    constructor() {
        this.logger = new EventLogger('PairingPageState')
    }

    get state():PageState {
        return this._state
    }
    get selectState():SelectState {
        return this._selectState
    }

    start(  callback:()=>void ) {      
        try { 
            if (this._state!=='Closed') {
                this.logError( new Error(`State machine in illegal state ${this.state}`),'start')
                return;
            }

            this.epoch++
            this.stateChangeCallback = callback
            this.resumeCallback = callback
            this.registerServiceEventHandlers()
            this.setState('Idle')
            this.adoptWorkInFlight()
            this.logIncomingEvent('start()',undefined,this.state)

        }
        catch(err) {
            this.logError(err,'start')
        }
    }
    stop() {     
        try {
            const prev = this.state
            this.closeSession()
            delete this.resumeCallback
            this.logIncomingEvent('stop',prev,'Closed')
        } 
        catch(err) {
            this.logError(err,'stop')

        }
    }

    // What the visit before left running decides where this session begins (see 4.4 of the design):
    // a running attempt is adopted, anything else starts from Idle.
    protected adoptWorkInFlight() {
        const service = this.getDevicePairing()
        const activity = service.getActivity?.()
        if (!activity)
            return

        if (activity.pairing) {
            this.currentAttemptId = activity.pairing.attemptId
            this.adoptedAttempt = true
            this.setState('Pairing')
        }
        else if (activity.scanning) {
            // the leave stops scans, so this is not expected: treat it like a stop that has not finished
            this.logger.logEvent({message:'scan still running on start', scanId:activity.scanning.scanId, kind:activity.scanning.kind})
            service.stopScanning().catch( err=>{ this.logError(err,'start') })
        }
    }

    // Ends the session: nothing of it may run again. Device work is owned by the pairing service and is
    // not touched here.
    protected closeSession() {
        this.epoch++
        this.stoppedAt = Date.now()
        this.unregisterServiceEventHandlers()
        delete this.stateChangeCallback
        delete this.selectStateChangeCallback

        this.resetTimeouts()
        this.stopDeviceSelectionTimeout()
        this._selectState = 'Closed'

        // drop any in-flight markers from this session - a stale, still-pending
        // startPairing()/startScanning() promise from a previous session must not
        // block a fresh performCheck() after the next start()
        delete this.pairingPromise
        delete this.scanningPromise
        delete this.stopWorkPromise
        delete this.currentAttemptId
        delete this.currentScanId
        this.adoptedAttempt = false
        this.setState('Closed')
    }

    async pause() {
        const prev = this._state
        const service = this.getDevicePairing()

        // the session ends right away, the device work is stopped afterwards
        this.closeSession()
        this.logIncomingEvent('pause',prev,this.state)

        if (prev==='Pairing') {
            await service.stopPairing()
        }
        else if (prev==='Scanning' ) {
            await service.stopScanning()
        }
        await service.stop([], true)
    }

    // pause() and resume() are stop() and start(): the page is entered again like a new visit
    resume() {
        const prev = this._state
        if (prev!=='Closed' || !this.resumeCallback) 
            return

        this.start(this.resumeCallback)
        this.logIncomingEvent('resume',prev,this.state)
    }

    // true if the continuation that captured `epoch` belongs to a session that has ended
    protected isStale( epoch:number, fn:string):boolean {
        if (epoch===this.epoch && this._state!=='Closed')
            return false

        this.logger.logEvent({message:'stale continuation dropped', fn, msSinceStop: this.stoppedAt===undefined ? -1 : Date.now()-this.stoppedAt})
        return true
    }

    protected stopWork( stopFn:()=>Promise<void> ):Promise<void> {
        if (this.stopWorkPromise!==undefined)
            return this.stopWorkPromise

        const promise:Promise<void> = Promise.resolve(stopFn()).finally( ()=>{
            if (this.stopWorkPromise===promise)
                delete this.stopWorkPromise
        })
        this.stopWorkPromise = promise
        return promise
    }

    protected setState(state:PageState) {
        const prev = this._state        
        this._state = state

        if (this.stateChangeCallback) {
            this.stateChangeCallback()
        }
    }

    protected logError( err:Error, fn:string) {
        this.logger.logEvent({message:'error',fn, error:err.message, stack:err.stack})

    }

    protected registerServiceEventHandlers() {
        this.registerHandler('page-ready',this.onPageReady.bind(this))
        this.registerHandler('state-update',this.onStateUpdate.bind(this))
        this.registerHandler('pairing-start',this.onPairingStarted.bind(this))
        this.registerHandler('pairing-done',this.onPairingFinished.bind(this))
        this.registerHandler('scanning-start',this.onScanningStarted.bind(this))
        this.registerHandler('scanning-done',this.onScanningFinished.bind(this))
        this.registerHandler('retry',this.onRetry.bind(this))
        this.registerHandler('search-again',this.onSearchAgain.bind(this))
    }

    // the rider asked for another search; if something else is running, the next check picks it up
    protected onSearchAgain() {
        if (this.state==='Idle' || this.state==='Done') {
            this.resetTimeouts()
            this.performCheck()
        }
    }

    protected unregisterServiceEventHandlers() {
        const service = this.getDevicePairing()

        const registered = Object.keys( this.eventHandlers)
        for (const event of registered) {
            service.off(event, this.eventHandlers[event] )
            this.internalEvents.off(event, this.eventHandlers[event] )
        }
        this.eventHandlers = {}
    }

    protected registerHandler( event:string, handler:any) {
        const service = this.getDevicePairing()
        service.on(event,handler)
        this.internalEvents.on(event,handler)
        this.eventHandlers[event] = handler
    }

    protected logIncomingEvent( event:string, oldState:PageState, newState:PageState) {
        this.logger.logEvent( {message:'handle event',notified:event, stateTransition:{from:oldState,to:newState} })
    }

    protected emit(event:string) {
        this.internalEvents.emit(event)
    }

    onPageReady() {
        // the attempt of the visit before is running: nothing to start
        if (this.state==='Pairing' && this.adoptedAttempt)
            return

        if (this.state!=='Idle') {
            this.logError( new Error('Illegal state'),'onPageStartedEventHandler')
            return;
        }

        const prev = this._state
        this.performCheck()
        this.logIncomingEvent('page-ready',prev,this.state)

    }

    protected onStateUpdate() {

        
        if (this.selectState==='Closed') {
            if (this.stateChangeCallback)
                this.stateChangeCallback()
        }
        else {
            if (this.selectStateChangeCallback)
                this.selectStateChangeCallback()
        }   
    }

    protected performCheck( prevState?:PageState) {
        try  {
            const oldState = this.state
            const configuration = this.getDeviceConfiguration()
            const service = this.getDevicePairing()

            const hasDevices = configuration.canStartRide()
            const adapters = configuration.getAdapters(false)

            // the page's search keeps running (or starts, when the rider asked for another one) even
            // if what it found is already enough to ride; once it has ended, nothing searches by itself
            const searchPending = this.selectState==='Closed' && service.isSearchPending?.()===true
            const searchEnded = this.selectState==='Closed' && service.isSearchAllowed?.()===false

            this.logger.logEvent({message:'check next action', hasDevices})

            if (hasDevices && this.selectState==='Closed' && !searchPending) {
                this.checkPairingProgress(service, adapters)
            }
            else if ((this.selectState==='Closed' && !searchEnded) || this.selectState==='Active'){
                this.checkScanningProgress(service, adapters)
            }


            if (this.state!==oldState)
                this.logger.logEvent( {message:'state changed',stateTransition:{from:oldState,to:this.state} })

        }
        catch(err) {
            this.logError(err,'performCheck')
        }

    }

    protected checkPairingProgress( service:ReturnType<typeof this.getDevicePairing>, adapters:ReturnType<ReturnType<typeof this.getDeviceConfiguration>['getAdapters']>) {
        // same "done" rule as the direct pairing loop, which also covers retrying a device
        // excluded as not available while the page is open
        const pairingDone = service.isPairingSettled()

        if (pairingDone) {
            //service.stopPairing
            service.prepareForRide()
            this.resetTimeouts()
            this.setState('Done')
            //this.setState('Idle')
        }
        else if (!this.pairingPromise) {
            // guard against overlapping startPairing() calls: performCheck() can be
            // triggered multiple times (e.g. repeated onDeviceSelectionClosed() calls)
            // before a previous startPairing() call has settled. DevicePairingService's
            // own reentrancy guard doesn't apply while usage==='page', so without this
            // the state machine could end up with several overlapping pairing attempts
            // racing each other and get stuck in 'Pairing' forever.
            this.setState('Pairing')
            const promise:Promise<void> = Promise.resolve(service.startPairing(adapters, {}))
                .catch( err=>{ this.logError(err,'startPairing') })
                .finally( ()=>{ if (this.pairingPromise===promise) delete this.pairingPromise })
            this.pairingPromise = promise
        }
    }

    protected checkScanningProgress( service:ReturnType<typeof this.getDevicePairing>, adapters:ReturnType<ReturnType<typeof this.getDeviceConfiguration>['getAdapters']>) {
        if (!this.scanningPromise) {
            // same overlap guard as above, applied to startScanning()
            this.setState('Scanning')
            const props = this.selectState==='Active' ? {deviceList:true} : {}
            const promise:Promise<void> = Promise.resolve(service.startScanning(adapters, props))
                .catch( err=>{ this.logError(err,'startScanning') })
                .finally( ()=>{ if (this.scanningPromise===promise) delete this.scanningPromise })
            this.scanningPromise = promise
        }
    }

    // events of an attempt or scan this session does not wait for (an older one) are dropped
    protected isForeign( event:string, id:number|undefined, current:number|undefined):boolean {
        if (id===undefined || id===current)
            return false
        this.logger.logEvent({message:'foreign attempt event ignored', event, attemptId:id})
        return true
    }

    protected onPairingStarted(payload?:{attemptId?:number}) {
        if (payload?.attemptId!==undefined && this.state==='Pairing')
            this.currentAttemptId = payload.attemptId

        // nothing to do for now just verify we are in the expected state
        if (this.state!=='Pairing') {
            this.logError( new Error('Illegal state'),'onPairingStarted')
            return;
        }
        this.sendUpdate()

    }
    protected onPairingFinished(payload?:{attemptId?:number}) {
        if (this.state==='Closed' || this.isForeign('pairing-done', payload?.attemptId, this.currentAttemptId))
            return
        delete this.currentAttemptId
        this.adoptedAttempt = false
        const prev = this.state
        this.setState('Idle')

        // device selector was opened and is currently within or beyond 3s waiting period
        if (this._selectState==='Waiting') {
            // don't retry pairing
            this.resetTimeouts()

            // if selection timeout already expired
            if (!this.selectionTimeout) {                
                // call perform Check which should trigger a scan
                this.performCheck()
            }
            
        }
        else {
            this.logger.logEvent( {message:'setup retry timeout', delay:PAIRING_RETRY_DELAY})

            this.resetTimeouts()
            this.retryTimeout = setTimeout( ()=>{
                this.onRetry(prev)
            },PAIRING_RETRY_DELAY )

            this.sendUpdate()
            this.logIncomingEvent('pairing-done',prev,this.state)
        }
    }

    protected sendUpdate() {
        if (this.stateChangeCallback)
            this.stateChangeCallback()        
    }

    protected onScanningStarted(payload?:{scanId?:number}) {      
        if (payload?.scanId!==undefined && this.state==='Scanning')
            this.currentScanId = payload.scanId

        // nothing to do for now just verify we are in the expected state
        if (this.state!=='Scanning') {
            this.logError( new Error('Illegal state'),'onScanningStarted')
            return;
        }
    }

    protected onScanningFinished(payload?:{scanId?:number}) {
        if (this.state==='Closed' || this.isForeign('scanning-done', payload?.scanId, this.currentScanId))
            return
        delete this.currentScanId
        const prev = this.state

        this.setState('Idle')
        this.resetTimeouts()
        this.retryTimeout = setTimeout( ()=>{
            this.onRetry( prev)
        },SCANNING_RETRY_DELAY )


        this.logIncomingEvent('started',prev,this.state)

    }

    protected onRetry(prevState:PageState) {

        this.resetTimeouts()
        if (this.state!=='Idle') {
            return;
        }
            
        this.performCheck( prevState)
    }


    onDeviceSelectionOpened( onSelectionStateChanged:()=>void) {
        if (this.state==='Closed')
            return

        if (this.state==='Pairing' )  {
            this.startDeviceSelectionTimeout()
            this._selectState = 'Waiting'
        }
        else {
            this._selectState = 'Active'

        }
        this.logIncomingEvent('list-open',this.state, this.state)

        if (this.state==='Idle' || this.state==='Done') {
            this.performCheck()
        }
    }

    async onDeviceSelectionClosed() {
        const epoch = this.epoch
        const prev = this.state
        this._selectState = 'Closed'
        delete this.selectStateChangeCallback
        this.stopDeviceSelectionTimeout()

        if (this.state==='Pairing' )  {
            await this.stopWork( ()=>this.getDevicePairing().stopPairing() )
            if (this.isStale(epoch,'onDeviceSelectionClosed')) return
            this.setState('Idle')
        }
        else if (this.state==='Scanning' )  {
            await this.stopWork( ()=>this.getDevicePairing().stopScanning() )
            if (this.isStale(epoch,'onDeviceSelectionClosed')) return
            this.setState('Idle')
        }
        else if (this.state==='Closed')
            return

        this.logIncomingEvent('list-close',prev, this.state)
        this.performCheck()
        
    }

    protected startDeviceSelectionTimeout() {
        this.stopDeviceSelectionTimeout()
        this.selectionTimeout = setTimeout( this.onDeviceSelectionTimeout.bind(this), 3000)

    }

    protected stopDeviceSelectionTimeout() {
        if (this.selectionTimeout) 
            clearTimeout(this.selectionTimeout)
        delete this.selectionTimeout
    }


    async onDeviceSelectionTimeout    () {
        const epoch = this.epoch
        this.stopDeviceSelectionTimeout()

        this.logIncomingEvent('list-timeout',this.state, this.state)
        if (this.state==='Idle') {
            this._selectState = 'Active'
            this.performCheck()
        }
        else if(this.state==='Pairing') {
            // the 3s grace period is over and the in-flight pairing attempt (for some other
            // capability) still hasn't finished - abandon it and honour the user's request to
            // see devices for the capability they opened instead. It isn't lost: the normal
            // retry cycle (see onPairingFinished()) picks it up again once we're back at 'Idle'.
            await this.stopWork( ()=>this.getDevicePairing().stopPairing() )
            if (this.isStale(epoch,'onDeviceSelectionTimeout')) return
            this._selectState = 'Active'
            this.performCheck()
        }
    }

    protected resetTimeouts() {

        if (this.retryTimeout!==undefined) {
            clearTimeout(this.retryTimeout)
            delete this.retryTimeout
        }

    }


    @Injectable
    protected getDevicePairing() {
        return useDevicePairing()
    }

    @Injectable
    protected getDeviceConfiguration() {
        return useDeviceConfiguration()
    }

    protected getBleBinding() {
        return this.getBindings().ble as any
    }
    @Injectable
    protected getBindings() {
        return getBindings()
    }




}