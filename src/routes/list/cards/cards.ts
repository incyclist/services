import { Card   } from "../../../base/cardlist";
import { ImportFilter } from "../../../base/cardlist/types";
import { useUserSettings } from "../../../settings";
import { Route } from "../../base/model/route";

export class BaseCard implements Card<Route> {
   

    protected visible=true;
    protected initialized

    setInitialized(val: boolean) {
        this.initialized = val
    }

    reset() {        
        this.setInitialized(false)
        this.setVisible(false)
    }
    


    getId(): string {
        throw new Error("Method not implemented.");
    }
    getState() {
        throw new Error("Method not implemented.");
    }
    getData(): Route {
        throw new Error("Method not implemented.");
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setData(_data: Route) {
        throw new Error("Method not implemented.");
    }

    getCardType() {
        throw new Error("Method not implemented.");
    }
    getDisplayProperties() {
        throw new Error("Method not implemented.");
    }

    isVisible(): boolean {
        return this.visible
    }
    setVisible(visible: boolean) {
        this.visible = visible
    }
    equals(card: Card<Route>): boolean {
        if (!card)
            return false
        try {
            return card.getCardType()===this.getCardType() && card.getId()===this.getId()
        }
        catch(err) {
            console.log('~~~~ ERROR',card,err)
            return false
        }

    }

    onMounted(){}

    protected getUserSetting(key:string,defValue?) {
        try {
            const userSettings = useUserSettings();

            const res = userSettings.get(key,defValue)
            return res
        }
        catch (err) {
            return defValue
        }
    }

}

export type RouteCardType = 'Import' | 'Route' | 'Free-Ride'


const DEFAULT_TITLE = 'Import Route'
const DEFAULT_FILTERS = [
    { name: 'Routes', extensions: ['gpx','epm','xml'] },
    { name: 'Tracks', extensions: ['gpx'] },
    { name: 'RLV: ErgoPlanet', extensions: ['epm'] }, 
    { name: 'RLV: Incyclist, KWT, Rouvy,Virtualtrainer ', extensions: ['xml'] }, 
]       

export interface RouteImportProps {
    title: string,
    filters: Array<ImportFilter>
    visible:boolean
}

export class RouteImportCard extends BaseCard implements Card<Route> {

    setVisible(): void {
        this.visible = true // always visible
    }

    setData() {
        //ignore
    }
    getData() {
        return undefined
    }
    getCardType():RouteCardType {
        return 'Import'
    }
    getId():RouteCardType {
        return 'Import'
    }

    getFilters(): Array<ImportFilter> {
        return DEFAULT_FILTERS
    }

    getTitle(): string{
        return DEFAULT_TITLE;
    }

    getDisplayProperties(): RouteImportProps {
        const title = this.getTitle()
        const filters = this.getFilters()
        return {title,filters,visible:true}
    }

}


