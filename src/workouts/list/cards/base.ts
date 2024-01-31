import { Card   } from "../../../base/cardlist";
import { PromiseObserver } from "../../../base/types/observer";
import { Workout } from "../../base/model/Workout";

export class BaseCard implements Card<Workout> {
  

    protected visible=true;
    protected initialized

    setInitialized(val: boolean) {
        this.initialized = val
    }

    reset() {        
        this.setInitialized(false)
        this.setVisible(false)
    }
    

    delete(): PromiseObserver<boolean> {
        throw new Error("Method not implemented.");
    }

    getId(): string {
        throw new Error("Method not implemented.");
    }
    getData(): Workout {
        throw new Error("Method not implemented.");
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    setData(_data: Workout) {
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
    equals(card: Card<Workout>): boolean {
        if (!card)
            return false
        try {
            return card.getCardType()===this.getCardType() && card.getId()===this.getId()
        }
        catch(err) {
            return false
        }

    }

    onMounted(){}
    select() {}
    unselect() {}


}


