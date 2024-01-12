import { Card, CardList } from "../../../base/cardlist";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../base/types";
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

    if( val>1)
    console.log('~~~ info',r.title, tsAction, val)
    return val;

}


const sortFn = (a:Card<Route>,b:Card<Route>):number=> {
    const routeA = a.getData().description
    const routeB = b.getData().description

    const scores = score(routeB)-score(routeA)
    if (scores!==0)
        return scores
    return routeB.title>routeA.title ? -1 : 1
        

}

export class MyRoutes extends CardList<Route> {

    getCards(): Array<Card<Route>> {
        return this.sort()
    }

    sort(): Array<Card<Route>> {

        const importCard = this.cards.find( c=> (c.getCardType() as RouteCardType)==='Import')
        const freeRideCard = this.cards.find( c=> (c.getCardType() as RouteCardType)==='Free-Ride')

        const cards = this.cards.filter( c=> (c.getCardType() as RouteCardType)==='Route')



        const sorted = [ importCard,freeRideCard,...cards.sort( sortFn ) ]
        return sorted.map(c=>c as Card<Route>);
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

    



}