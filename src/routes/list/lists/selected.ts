import { Card, CardList } from "../../../base/cardlist";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../base/types";
import { RouteCard } from "../cards/RouteCard";

const score = (r:RouteInfo,idx:number):number =>{
    let val = 0;
    const tsAction = (Date.now()-Math.max(r.tsImported||0,r.tsLastStart||0))/1000/3600/24      // days since last action

    val+=(1-idx/1000)

    if (r.hasVideo || (1-tsAction)>0) val+=1
    return val
}

interface ExtRouteCard extends RouteCard {
    idx:number
}

const sortFn = (a:ExtRouteCard,b:ExtRouteCard):number=> {
    const routeA = a.getRouteDescription()
    const routeB = b.getRouteDescription()

    const scores = score(routeB,b.idx)-score(routeA,a.idx)
    if (scores!==0)
        return scores
    return b.getTitle()>a.getTitle() ? -1 : 1
       

}

export class SelectedRoutes extends CardList<Route> {

    getCards(): Array<Card<Route>> {

        const cards:Array<ExtRouteCard> = this.cards.map( (c,idx) => {
            const card = c as ExtRouteCard
            card.idx = idx
            return card
        })
        const sorted = cards.sort( sortFn )
        return sorted.map(c=>c as Card<Route>);
    }

}