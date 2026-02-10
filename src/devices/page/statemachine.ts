import { EventLogger } from 'gd-eventlog'
import { Injectable } from '../../base/decorators'
import { useDevicePairing } from '../pairing'
import type {PageState} from './types'
import { useDeviceConfiguration } from '../configuration'
import { EventEmitter } from 'node:stream'

const PAIRING_RETRY_DELAY = 2000
const SCANNING_RETRY_DELAY = 2000

export class PairingPageStateMachine {

    protected _state: PageState = 'Closed'
    protected logger: EventLogger
    protected eventHandlers: Record<string,any> = {}
    protected internalEvents: EventEmitter = new EventEmitter()
    protected stateChangeCallback: ()=>void
    protected retryTimeout: NodeJS.Timeout|undefined



    constructor() {
        this.logger = new EventLogger('PairingPageState')
    }

    get state():PageState {
        return this._state
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
            this.logIncomingEvent('stop()',prev,'Idle')

        } 
        catch(err) {
            this.logError(err,'stop')

        }
    }

    pause() {
        const prev = this._state
        const service = this.getDevicePairing()

        if (this.state==='Pairing') {
            service.stopPairing()
        }
        else if (this.state==='Scanning') {
            service.stopScanning()
        }

        this.resetTimeouts()
        this.setState('Idle')      
        
        this.logIncomingEvent('pause',prev,this.state)
        
    }

    resume() {
        this.performCheck()        
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
        if (this.stateChangeCallback)
            this.stateChangeCallback()
    }

    protected performCheck() {
        
        const oldState = this.state
        const configuration = this.getDeviceConfiguration()
        const service = this.getDevicePairing()

        const hasDevices = configuration.canStartRide()
        const adapters = configuration.getAdapters(false)

        this.logger.logEvent({message:'check next action', hasDevices})
        if (hasDevices) {

            const pairingDone = service.checkPairingSuccess()

            if (pairingDone) {
                service.prepareForRide()
                this.resetTimeouts()
                this.setState('Done')
            }
            else {
                this.setState('Pairing')
                service.startPairing(adapters, {})
            }

        }
        else {
            this.setState('Scanning')
            service.startScanning(adapters, {})
        }

        if (this.state!==oldState)
            this.logger.logEvent( {message:'state changed',stateTransition:{from:oldState,to:this.state} })

    }

    protected onPairingStarted() {      
        // nothing to do for now just verify we are in the expected state
        if (this.state!=='Pairing') {
            this.logError( new Error('Illegal state'),'onPairingStarted')
            return;
        }
    }
    protected onPairingFinished() {
        const prev = this.state
        this.setState('Idle')

        this.logger.logEvent( {message:'setup retry timeout', delay:PAIRING_RETRY_DELAY})

        this.retryTimeout = setTimeout( ()=>{
            console.log('#emit retry')
            this.onRetry()
        },PAIRING_RETRY_DELAY )
        this.logIncomingEvent('pairing-done',prev,this.state)

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
            this.onRetry()
        },SCANNING_RETRY_DELAY )
        this.logIncomingEvent('started',prev,this.state)

    }

    protected onRetry() {
        console.log('# retry', this.state)

        this.resetTimeouts()
        if (this.state!=='Idle') {
            return;
        }
        this.performCheck()
    }

    protected resetTimeouts() {
        console.log('# reset retry timeout')

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



}