import { IncyclistService } from "../../base/service";
import { Singleton } from "../../base/types";
import { Observer } from "../../base/types/observer";

/**
 * OnlineStateMonitoringService is responsible for monitoring and emitting the online status of the application.
 * It provides methods to set and get the online status, as well as an observer to listen for changes.
 * 
 * A page,component or service should use start() and stop() to subscribe and unsubscribe from the online status changes, 
 * provinding a unique context string identifying the page/component/service
 *
 * @noInheritDoc
 * @extends IncyclistService
 */@Singleton
export class OnlineStateMonitoringService extends IncyclistService {

    protected isOnline:boolean 
    protected _observer:Observer
    protected contextHandlers: Record<string,(online:boolean)=>void> = {}
    protected _isInitialized = false

    constructor() {
        super('OnlineStatee')
        this._observer = new Observer()
    }


    /**
     * Initialize the service by setting the initial online status.
     * 
     * This method is called automatically when the service is first used.
     * It sets the online status to the given value, and emits an 'onlineStatus' event
     * if the status is changed.
     * 
     * @param isOnline {boolean} The initial online status.
     */
    initialize(isOnline:boolean ) {
        this._isInitialized = true
        this.setOnline(isOnline)
    }

    /**
     * Indicates whether the service has been initialized.
     * @returns {boolean} True if the service has been initialized, false otherwise.
     */
    isInitialized():boolean {
        return this._isInitialized
    }

    
    /**
     * Set the online status of the application.
     * If the status is changed, it emits an 'onlineStatus' event.
     * @param isOnline {boolean} Whether the application is online or not.
     */
    setOnline( isOnline:boolean ) {
        if (this.isOnline===undefined || this.isOnline!==isOnline) {
            this.isOnline = isOnline
            this.emit('onlineStatus', isOnline)
        }
    }

    /**
     * Retrieves the online status of the application.
     * @returns {boolean} True if the application is online, false otherwise.
     */
    get onlineStatus ():boolean {
        return this.isOnline
    }

    /**
     * Provides access to the Observer instance for listening to online status changes.
     * 
     * @returns {Observer} The Observer instance associated with this service.
     */
    get observer():Observer {
        return this._observer
    }

    /**
     * Subscribes to the online status changes for the given context.
     * 
     * The context is a string identifying the subscriber. This string is used to identify the
     * subscriber and to avoid duplicate subscriptions.
     * 
     * The onlineStatusChanged callback is called whenever the online status of the application
     * is changed.
     * 
     * @param context {string} The context string identifying the subscriber.
     * @param onlineStatusChanged {(online:boolean)=>void} The callback function to call whenever the online status changes.
     * @returns {Observer} The Observer instance associated with this service.
     */
    start(context:string, onlineStatusChanged:(online:boolean)=>void):Observer {

        if (this.contextHandlers[context])
            this.stop(context)

        this.contextHandlers[context] = onlineStatusChanged
        this._observer.on('onlineStatus', onlineStatusChanged)
        return this._observer
    }

    /**
     * Unsubscribes the given context from online status changes.
     * 
     * This method removes the callback associated with the specified context
     * and deletes the context from the list of handlers.
     * 
     * @param context {string} The context string identifying the subscriber to unsubscribe.
     */
    stop(context:string ):void {
        const onlineStatusChanged = this.contextHandlers[context] 
        if (onlineStatusChanged===undefined)
            return
        this._observer.off('onlineStatus', onlineStatusChanged)
        delete this.contextHandlers[context]
    }

    emit<K>(eventName: string | symbol, ...args: any[]): boolean {

        if (this._observer) {
            this._observer.emit(eventName as string,...args)
            return true
        }
        // istanbul ignore next
        return false
    }


}

export const useOnlineStatusMonitoring = ()=> new OnlineStateMonitoringService()