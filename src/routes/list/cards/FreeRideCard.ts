import { Card } from "../../../base/cardlist";
import { useUserSettings } from "../../../settings";
import { geo } from "../../../utils";
import { LatLng } from "../../../utils/geo";
import { Route } from "../../base/model/route";
import { getRouteList } from "../service";
import { FreeRideOption, FreeRideStartSettings } from "../types";
import { BaseCard, RouteCardType } from "./cards";



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
        return {...this.position,visible:true}
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
        getRouteList().unselect();

        if (!this.position)
            this.loadSettings();

        const position: LatLng = this.position;
        return { position };

    }

    changeSettings(props: FreeRideSettings) {
        const { position: pos } = props;

        this.position = geo.getLatLng(pos);
        this.saveSettings();
    }

    accept(option: FreeRideOption) {
        // delete all distances from option
        option.path = option.path.map(p => ({ lat: p.lat, lng: p.lng, ways: p.ways, tag: p.tag }));

        const settings: FreeRideStartSettings = {
            type: this.getCardType(),
            position: this.position,
            option
        };
        getRouteList().setStartSettings(settings);

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
    }

    protected saveSettings() {
        if (!this.position)
            return;

        const userSettings = useUserSettings();
        userSettings.set('routeSelection.freeRide', { position: this.position });

    }


}
