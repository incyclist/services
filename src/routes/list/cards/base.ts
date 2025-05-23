import { Card   } from "../../../base/cardlist";
import { PromiseObserver } from "../../../base/types/observer";
import { useUserSettings } from "../../../settings";
import { Route } from "../../base/model/route";

export class BaseCard implements Card<Route> {
  

    protected visible=true;
    protected initialized

    setInitialized(val: boolean) {
        this.initialized = val
    }

    reset(onlyObserver:boolean=false) {        
        this.setInitialized(false)
        this.setVisible(false)
    }
    

    delete(): PromiseObserver<boolean> {
        throw new Error("Method not implemented.");
    }

    get id():string {
        return this.getId()
    }
    getId(): string {
        throw new Error("Method not implemented.");
    }
    getTitle(): string {
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
        catch {
            return false
        }

    }

    onMounted(){
        // optional: can be implemented by subclass
    }

    protected getUserSetting(key:string,defValue?) {
        try {
            const userSettings = useUserSettings();

            const res = userSettings.get(key,defValue)
            return res
        }
        catch  {
            return defValue
        }
    }

    select() {
        // optional: can be implemented by subclass
    }
    unselect() {
        // optional: can be implemented by subclass

    }


}


