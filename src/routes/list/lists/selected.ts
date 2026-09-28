import { Card, CardList } from "../../../base/cardlist";
import { Route } from "../../base/model/route";
import { RouteInfo } from "../../base/types";
import { RouteCard } from "../cards/RouteCard";
import { checkIsNew } from "../utils";

/**
 * Scores a route for the `Suggested` ordering - recently started or imported routes rank
 * highest, with small bonuses for a video route and for a route the user has not seen yet.
 *
 * Exported so `RouteListService.searchRepo()` (routes/list/service.ts) can reuse it as the
 * `Suggested` sort order rather than inventing a second ranking - this is the same scoring that
 * has driven the "Selected For Me" list.
 *
 * @param r the route's (cached) display properties - only `isLocal`, `tsImported`,
 *          `tsLastStart` and `hasVideo` are read, plus what {@link checkIsNew} reads
 * @param idx the route's position in its unsorted source list - a small tie-breaking nudge
 *            towards routes that were already earlier in that list
 */
export const score = (r:RouteInfo,idx:number):number =>{
    let val = 0;
    const isNew = checkIsNew(r)
    const tsUserImport = (r.isLocal) ? r.tsImported || 0 : 0
    const tsAction = (Date.now()-Math.max(tsUserImport,r.tsLastStart||0))/1000/3600/24      // days since last action

    val+=(1-idx/1000)

    if (r.hasVideo) val++
    if ((1-tsAction)>0) val+=2.1
    if (isNew) val++

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

        const cards:Array<ExtRouteCard> = Array.from(this.cards.map( (c,idx) => {
            const card = c as ExtRouteCard
            card.idx = idx
            return card
        }))
        cards.sort( sortFn )

        return cards
    }

}