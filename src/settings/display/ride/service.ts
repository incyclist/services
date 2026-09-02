import { getBindings } from "../../../api";
import { Injectable, Singleton } from "../../../base/decorators";
import { IncyclistService } from "../../../base/service";
import { Observer } from "../../../base/types";
import { IObserver } from "../../../types";
import { UserSettingsService, useUserSettings } from "../../service";
import { RideSettingsDisplayProps, TRideView, TRideViewOption } from "./types";

@Singleton
export class RideSettingsDisplayService extends IncyclistService {

    protected observer:Observer;


    constructor() {
        super('GearSettings')
    }

    open():IObserver {
        if (this.observer)
            this.close()
        
        this.observer =  new Observer()
        return this.observer
    }

    close() {
        this.observer.stop()
        delete this.observer
    }


    getDisplayProps():RideSettingsDisplayProps { 
        return {
            rideView: this.getRideView(),
            rideViewOptions:  this.getRideViewOptions()
        }        
    }

    setRideView(rideView:TRideView) {
        try {
            this.getUserSettings().set('preferences.rideView',rideView)       
        }
        catch(err) {
            this.logError(err,'setRideView')
        }

    }

    protected emitChanged() {
        if (this.observer)
            this.observer.emit('changed', this.getDisplayProps())
    }


    getRideView():TRideView {
        const rideView = this.getUserSettings().get('preferences.rideView','sv')

        const availability = this.getBindings().mapAvailability?.isAvailable(rideView)
        if (availability?.status === 'unavailable' || availability?.status === 'not-supported')
            return 'map'

        return rideView

    }

    getRideViewOptions():Map<TRideView,TRideViewOption> {
        const map:Map<TRideView,TRideViewOption> = new Map()

        this.addRideViewOption(map,'sv','Street View')
        map.set('map',{label:'Map'})
        this.addRideViewOption(map,'sat','Satellite View')

        return map
    }

    protected addRideViewOption(map:Map<TRideView,TRideViewOption>, key:TRideView, label:string) {
        const availability = this.getBindings().mapAvailability?.isAvailable(key)

        if (availability?.status === 'not-supported')
            return

        if (availability?.status === 'unavailable') {
            map.set(key,{label, disabled:true, messageKey:availability.messageKey})
            return
        }

        map.set(key,{label})
    }

    protected isMobile() {
        return this.getBindings().appInfo?.getChannel()==='mobile'
    }

    protected isAndroid() {
        return this.getBindings().appInfo?.getOS()?.platform==='android'
    }
    protected isIOS() {
        return this.getBindings().appInfo?.getOS()?.platform==='ios'
    }

    /* istanbul ignore next */
    @Injectable
    protected getUserSettings(): UserSettingsService {
        return useUserSettings()
    }


    /* istanbul ignore next */
    @Injectable
    protected getBindings() {
        return getBindings()
    }

}

export const useRideSettingsDisplay = ()=> new RideSettingsDisplayService()