import { EventLogger } from 'gd-eventlog'
import { Injectable } from '../../base/decorators'
import { useDevicePairing } from '../pairing'
import type {PageState, SelectState} from './types'
import { useDeviceConfiguration } from '../configuration'
import { EventEmitter } from 'node:stream'
import { getBindings } from '../../api'

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

            this.stateChangeCallback = callback
            this.registerServiceEventHandlers()
            this.setState('Idle')
            this.logIncomingEvent('start()',undefined,'Idle')

        }
        catch(err) {
            this.logError(err,'start')
        }
    }
    stop() {      
        try {
            const prev = this.state
            this.unregisterServiceEventHandlers()
            delete this.stateChangeCallback

            this.resetTimeouts()
            this.setState('Closed')        
            this.logIncomingEvent('stop',prev,'Idle')

        } 
        catch(err) {
            this.logError(err,'stop')

        }
    }

    async pause() {
        const prev = this._state
        const service = this.getDevicePairing()

        if (this.state==='Pairing') {
            await service.stopPairing()
        }
        else if (this.state==='Scanning' ) {
            await service.stopScanning()
        }
        await service.stop([], true)

        this.resetTimeouts()
        this.setState('Closed')      
        
        this.logIncomingEvent('pause',prev,this.state)

        
        
    }

    resume() {
        const prev = this._state
        this.setState('Idle')
        this.logIncomingEvent('resume',prev,this.state)

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
                this.selectStateChangeCallback
        }   
    }

    protected performCheck( prevState?:PageState) {
        try  {
            const oldState = this.state
            const configuration = this.getDeviceConfiguration()
            const service = this.getDevicePairing()

            const hasDevices = configuration.canStartRide()
            const adapters = configuration.getAdapters(false)

            this.logger.logEvent({message:'check next action', hasDevices})

            if (hasDevices && this.selectState==='Closed') {

                const pairingDone = service.checkPairingComplete()

                if (pairingDone) {
                    //service.stopPairing
                    service.prepareForRide()
                    this.resetTimeouts()
                    this.setState('Done')
                    //this.setState('Idle')
                }
                else {
                    this.setState('Pairing')
                    service.startPairing(adapters, {})
                }

            }
            else if (this.selectState==='Closed' || this.selectState==='Active'){
                this.setState('Scanning')
                service.startScanning(adapters, {})
            }
            

            if (this.state!==oldState)
                this.logger.logEvent( {message:'state changed',stateTransition:{from:oldState,to:this.state} })

        }
        catch(err) {
            this.logError(err,'performCheck')
        }

    }

    protected onPairingStarted() {      
        // nothing to do for now just verify we are in the expected state
        if (this.state!=='Pairing') {
            this.logError( new Error('Illegal state'),'onPairingStarted')
            return;
        }
        this.sendUpdate()

    }
    protected onPairingFinished() {
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

    protected onScanningStarted() {      
        // nothing to do for now just verify we are in the expected state
        if (this.state!=='Scanning') {
            this.logError( new Error('Illegal state'),'onScanningStarted')
            return;
        }
    }

    protected onScanningFinished() {
        const prev = this.state


        this.setState('Idle')
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

        const prev = this.state
        this._selectState = 'Closed'
        delete this.selectStateChangeCallback
        this.stopDeviceSelectionTimeout()

        if (this.state==='Pairing' )  {
            await this.getDevicePairing().stopPairing()
            this.setState('Idle')
        }
        else if (this.state==='Scanning' )  {
            await this.getDevicePairing().stopScanning()
            this.setState('Idle')
        }

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
        this.stopDeviceSelectionTimeout()

        this.logIncomingEvent('list-timeout',this.state, this.state)
        if (this.state==='Idle') {
            this._selectState = 'Active'
            this.performCheck()
        }
        else if(this.state==='Pairing') {
            this.getDevicePairing().stopPairing()
            this.selectionTimeout = setTimeout( this.onDeviceSelectionTimeout.bind(this), 1000)
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