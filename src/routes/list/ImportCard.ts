import { RouteState } from "../base/types";
import { CardInfo, CardType } from "./types";

export class ImportCard implements CardInfo {
    type: CardType;
    state: RouteState;
    title?: string;

    constructor(state,title?) {
        this.type = 'import' 
        this.state = state
        this.title = title||'Import Route'
    }

    
}