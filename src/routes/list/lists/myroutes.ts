import { Card, CardList } from "../../../base/cardlist";
import { Route } from "../../base/model/route";
import { RouteCardType } from "../cards/types";


const sortFn = (a:Card<Route>,b:Card<Route>):number=> {
    const routeA = a.getData().description
    const routeB = b.getData().description

    if (routeA.next === routeB.id) return -1
    if (routeB.next === routeA.id) return 1

    return Math.max(routeB.tsImported||0,routeB.tsLastStart||0)-Math.max(routeA.tsImported||0, routeA.tsLastStart||0)

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