import { Card, CardList } from "../../../base/cardlist";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../base/types";
import { RouteCard } from "../cards/RouteCard";
import { RouteCardType } from "../cards/types";

const score = (r:RouteInfo):number =>{
    let val = 0;

    const tsAction = (Date.now()-Math.max(r.tsImported||0,r.tsLastStart||0))/1000/3600/24      // days since last action

    if (r.hasVideo || (1-tsAction)>0) val+=1
    if (!isNaN(tsAction) && tsAction>=0 && tsAction<365 ) {
        if ((7-tsAction)>0 )
            val+=1
        val += Math.log10(365-tsAction)
    }

    
    return val;

}


const sortFn = (a:RouteCard,b:RouteCard):number=> {
    const routeA = a.getRouteDescription()
    const routeB = b.getRouteDescription()

    const scores = score(routeB)-score(routeA)
    if (scores!==0)
        return scores
    return b.getTitle()>a.getTitle() ? -1 : 1
        

}

export class MyRoutes extends CardList<Route> {

    getCards(): Array<Card<Route>> {
        return this.sort()
    }

    sort(): Array<Card<Route>> {


        const fixed = this.cards.filter( c=> (c.getCardType() as RouteCardType)!=='Route')
        
        const sortable = Array.from(this.cards.filter( c=> (c.getCardType() as RouteCardType)==='Route'))
        sortable.sort( sortFn )
        const sorted = [ ...fixed,...sortable ]

        return sorted
    }

    add(card:Card<Route>, fromImport:boolean=false) {
        const type = card.getCardType() as RouteCardType
        if (type!=='Route')
            return super.add(card)
        
        const route:Route =card.getData()
        if (fromImport)
            route.description.tsImported = Date.now()

        super.add(card)        
    }

    addImport(card:Card<Route>) {
        const idx = this.cards.findIndex(c=> (c.getCardType() as RouteCardType)==='Route')
        if (idx===-1)
            this.cards.push(card)
        else 
            this.cards.splice( idx,0,card)
    }

    remove( card:Card<Route>) {
        this.cards = this.cards.filter ( c=> (c.getId()!==card.getId() ))
    }

    removeActiveImports() {
        this.cards = this.cards.filter( c=> (c.getCardType() as RouteCardType)!=='ActiveImport')
    }

    



}