import { RouteState } from "../base/types";
import { CardInfo, CardType } from "./types";

export class FreeRideCard implements CardInfo {
    type: CardType;
    state: RouteState;
    title?: string;

    constructor(state,title?) {
        this.type = 'free-ride' 
        this.state = state
        this.title = title||'Free Ride'
    }

    
}