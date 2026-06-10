import { getBindings } from "../../../api";
import { Injectable, Singleton } from "../../../base/decorators";
import { IncyclistService } from "../../../base/service";
import { Observer } from "../../../base/types";
import { IObserver } from "../../../types";
import { UserSettingsService, useUserSettings } from "../../service";
import { RideSettingsDisplayProps, TRideView } from "./types";

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
            this.getUserSettings().get('preferences.rideView',rideView)       
        }
        catch(err) {
            this.logError(err,'setRideView')
        }

    }

    protected emitChanged() {
        if (this.observer)
            this.observer.emit('changed', this.getDisplayProps())
    }


    protected getRideView():TRideView {
        if (this.isMobile() && !this.isAndroid()) 
            return 'map'
       
        const rideView = this.getUserSettings().get('preferences.rideView','sv')       
        return rideView

    }

    protected getRideViewOptions():Map<TRideView,string> {
        const map:Map<TRideView,string> = new Map()

        if (!this.isIOS())
            map.set('sv','Street View')
        map.set('map','Map')

        if (!this.isMobile())
            map.set('sat','Satellite View')
        
        return map
    }

    protected isMobile() {
        return this.getBindings().appInfo?.getChannel()==='mobile'
    }

    protected isAndroid() {
        return this.getBindings().appInfo?.getOS()?.platform==='android'
    }
    protected isIOS() {
        return this.getBindings().appInfo?.getOS()?.platform==='darwin'
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