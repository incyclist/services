import { Card, CardList } from "../../../base/cardlist";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../base/types";
import { RouteCard } from "../cards/RouteCard";
import { checkIsNew } from "../utils";

const score = (r:RouteInfo):number =>{
    let val = 0;
    const tsAction = (Date.now()-Math.max(r.tsImported||0,r.tsLastStart||0))/1000/3600/24      // days since last action
    const isNew = checkIsNew(r)

    if (r.hasVideo) val+=1
    if ((1-tsAction)>0) val+=1
    if (!r.isDemo) val+=0.1
    if (isNew) val++
    return val
}

const sortFn = (a:RouteCard,b:RouteCard):number=> {
    const routeA = a.getRouteDescription()
    const routeB = b.getRouteDescription()

    const scores = score(routeB)-score(routeA)    
    if (scores!==0)
        return scores
    return b.getTitle()>a.getTitle() ? -1 : 1
       

}

export class AlternativeRoutes extends CardList<Route> {

    getCards(): Array<Card<Route>> {
        const sorted = this.cards.sort( sortFn )
        return sorted.map(c=>c as Card<Route>);
    }

}