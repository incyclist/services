import { EventLogger } from "gd-eventlog";
import { Card } from "../../../base/cardlist";
import { PromiseObserver } from "../../../base/types/observer";
import { useUserSettings } from "../../../settings";
import { geo } from "../../../utils";
import { LatLng } from "../../../utils/geo";
import { valid } from "../../../utils/valid";
import { Route } from "../../base/model/route";
import { getRouteList } from "../service";
import { FreeRideOption, FreeRideStartSettings } from "../types";
import { BaseCard } from "./base";
import { RouteCardType } from "./types";
import { AppStatus } from "../../base/types";



export type FreeRideSettings = {
    position?: LatLng;
    options?;
};

export interface FreeRideDisplayProps extends LatLng {
    visible: boolean
}

export class FreeRideCard extends BaseCard implements Card<Route> {

    protected position: LatLng;
    protected options: [];
    protected logger: EventLogger

    constructor() {
        super()
        this.logger = new EventLogger('FreeRideCard')
    }

    delete():PromiseObserver<boolean> {
        // not possible to delete FreeRide Card
        return PromiseObserver.alwaysReturning(false)
    }

    canStart(status:AppStatus) {
        const {isOnline} = status
        return isOnline
    }

    setVisible(): void {
        this.visible = true // always visible
    }

    isVisible(): boolean {
        return true
    }
    getId() {
        return 'Free-Ride';
    }

    getCardType(): RouteCardType {
        return 'Free-Ride';
    }

    getDisplayProperties(): FreeRideDisplayProps {
        try {
            return {...this.position,visible:true}
        }
        catch(err) {
            this.logError(err, 'getDisplayProperties')
        }
    }

    getPosition(): LatLng {
        return this.position;
    }

    setOptions() {
    }
    selectOption() {
    }

    getSelectedOption() {
    }

    getData(): Route {
        // TODO: build route based on option
        return new Route({});
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setData(_data: Route) {
        // ignore
    }

    openSettings(): FreeRideSettings {
        try {
            getRouteList().unselect();

            if (!this.position)
                this.loadSettings();

            const position: LatLng = this.position;
            return { position };
        }
        catch(err) {
            this.logError(err, 'openSettings')
            return {}
        }

    }

    changeSettings(props: FreeRideSettings) {
        try {
            const { position: pos } = props;

            this.position = geo.getLatLng(pos);
            this.saveSettings();
        }
        catch(err) {
            this.logError(err, 'changeSettings')
        }

    }

    accept(option: FreeRideOption) {
        try {
            // delete all distances from option
            option.path = option.path.map(p => ({ lat: p.lat, lng: p.lng, ways: p.ways, tag: p.tag }));

            const settings: FreeRideStartSettings = {
                type: this.getCardType(),
                position: this.position,
                option
            };
            getRouteList().setStartSettings(settings);

        }
        catch(err) {
            this.logError(err, 'accept')
        }

    }

    cancel() {
    }

    protected loadSettings() {
        const prevSetting = this.getUserSetting(`routeSelection.freeRide`, null);
        if (prevSetting) {
            this.position = prevSetting.position;
        }
        else {
            this.position = this.getUserSetting(`position`, null);
        }

        if (!valid(this.position?.lat) || !valid(this.position?.lng))
            this.position= undefined
    }

    protected saveSettings() {
        if (!this.position)
            return;

        const userSettings = useUserSettings();
        userSettings.set('routeSelection.freeRide', { position: this.position });

    }

    protected logError(err:Error,fn:string) {
        this.logger.logEvent({message:'error', error:err.message, fn, stack:err.stack})
    }


}
