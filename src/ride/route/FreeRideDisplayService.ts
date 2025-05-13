import { getTotalDistance, validateRoute } from "../../routes";
import { RouteApiDetail } from "../../routes/base/api/types";
import { Route } from "../../routes/base/model/route";
import { RouteInfo, RoutePoint } from "../../routes/base/types";
import { FreeRideOption, FreeRideStartSettings } from "../../routes/list/types";
import { distanceBetween, LatLng } from "../../utils/geo";
import { CurrentRideDisplayProps, GpxDisplayProps } from "../base";
import { GpxDisplayService } from "./GpxDisplayService";

export class FreeRideDisplayService extends GpxDisplayService {

    protected currentOptions: FreeRideOption[]
    protected initialPosition: LatLng


    protected get route():Route {
        return this.currentRoute
    }


    getDisplayProperties(props:CurrentRideDisplayProps):GpxDisplayProps {
        let routeProps:GpxDisplayProps = super.getDisplayProperties(props)


        return {
            ...routeProps,
            upcomingElevation: {show:false},
            totalElevation: {show:false},
        }    
    }

    getLogProps(): object {

        const rideView = this.getUserSettings().get('preferences.rideView',undefined)??'sv(default)'
        const bikeProps = this.getBikeLogProps()
        const {lat,lng} = this.initialPosition

        const props =  {
            mode:'free ride',
            rideView,
            lat,lng,
            ...bikeProps
        }
        
        return props
    }


    protected initRoute() {
        try {
            const {position,option} = this.getRouteList().getStartSettings() as FreeRideStartSettings

            this.currentRoute = this.createRoute(position,option)
            this.initialPosition = position
            this.currentOptions = []

            
        }
        catch(err) {
            this.logError(err,'init')
        }
    }

    protected createRoute( position:LatLng,option:FreeRideOption):Route {
        try{

            let routeDistance:number
            
            let pPrev;
            const points:RoutePoint[] = option.path.map( (p,idx)=> {
                const distance = idx===0 ? 0 : (p.distance?? distanceBetween(pPrev,p))
                routeDistance  = idx===0 ? 0 : routeDistance+distance;            
                pPrev = p
                return {lat:p.lat,lng:p.lng,distance:distance??0,routeDistance, elevation:0}
            } )

            const uuid = this.getUserSettings().get('uuid','')

            const details: RouteApiDetail = {
                id: `Free-Ride:${uuid}:${Date.now()}`,
                title: 'Free Ride',
                routeHash: `Free-Ride:${uuid}:${Date.now()}`,
                points
            }
            const desription: RouteInfo = {
                id: `Free-Ride:${uuid}:${Date.now()}`,
                title: 'Free Ride',
                routeHash: `Free-Ride:${uuid}:${Date.now()}`,
                points,
                hasGpx:true,
                hasVideo: false,
                isLoop: false


            }
            const route =  new Route( desription,details)
            validateRoute(route)        

            route.description.distance = route.details.distance = getTotalDistance(details)
            route.updateCountryFromPoints()

            console.log('# create route', position, option.path, route)
            return route
        }
        catch(err) {
            console.log('# error',err)
        }        

    }

    prepareOptions(opts) {
        /*
        let options = opts;
        if (options === undefined)
            options = this.state.options;

        if (options === undefined)
            return;

        options.sort((a, b) => {
            let dA = a.direction;
            let dB = b.direction;

            if (dA > 180) dA = dA - 360;
            if (dB > 180) dB = dB - 360;
            if (dA > dB) return 1
            if (dA < dB) return -1;
            return 0;
        })
        options.forEach((opt, i) => opt.color = OPTION_COLOR[i % OPTION_COLOR.length])
        */

    }




    


    
}
