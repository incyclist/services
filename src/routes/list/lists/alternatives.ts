import { Card, CardList } from "../../../base/cardlist";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../base/types";
import { RouteCard } from "../cards/RouteCard";
import { checkIsNew } from "../utils";

const score = (r:RouteInfo):number =>{
    let val = 0;

    const recentlyImported = r.tsImported && (Date.now()-(r.tsImported??0))/1000/3600/24<1
    const daysSinceLastStart = (Date.now()-(r.tsLastStart??0))/1000/3600/24
    const isStarted = r.tsLastStart && daysSinceLastStart<1
    const isNew = checkIsNew(r)

    if (r.hasVideo) val+=1
    if (recentlyImported) val+=1
    if (isStarted) val+=(1-daysSinceLastStart)
    if (daysSinceLastStart<7) val+=0.1

    if (!r.isDemo) val+=0.1
    if (isNew||isStarted) val++

    return val
}

const sortFn = (a:RouteCard,b:RouteCard):number=> {
    const routeA = a.getRouteDescription()
    const routeB = b.getRouteDescription()

    const scores = score(routeB)-score(routeA)    
    if (scores!==0) {
        return scores
    }
    return b.getTitle()>a.getTitle() ? -1 : 1
       

}

export class AlternativeRoutes extends CardList<Route> {

    getCards(): Array<Card<Route>> {
        
        const sorted = Array.from(this.cards)
        sorted.sort(sortFn)
        return sorted
        
    }

}