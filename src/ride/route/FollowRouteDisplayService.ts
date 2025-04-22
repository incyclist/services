import { GpxDisplayService } from "./GpxDisplayService";

export class FollowRouteDisplayService extends GpxDisplayService {

    getLogProps(): object {

        const route = this.route
        const settings  = this.startSettings
        const rideView = this.getUserSettings().get('preferences.rideView',undefined)
        const bikeProps = this.getBikeLogProps()

        const props =  {
            rideMode:'follow route',
            rideView,
            route: route.description.title,
            start: settings.startPos,
            realityFactor: settings.realityFactor,
            showPrev: settings.showPrev,
            ...bikeProps
        }
        
        return props
    }

    protected savePosition(startPos?:number) {

        
        try {
            const { lapDistance  } = this.position
            const routeId = this.route.description.id
            this.getUserSettings().set(`routeSelection.followRoute.prevSetting.${routeId}.startPos`,startPos??lapDistance)

        }
        catch (err) {
            this.logEvent({ message: 'error', fn: 'savePosition()', position: this.position, error:err.message, stack:err.stack })
        }

    }




    
}