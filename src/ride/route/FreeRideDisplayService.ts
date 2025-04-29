import { CurrentRideDisplayProps, GpxDisplayProps } from "../base";
import { GpxDisplayService } from "./GpxDisplayService";

export class FreeRideDisplayService extends GpxDisplayService {
        getDisplayProperties(props:CurrentRideDisplayProps):GpxDisplayProps {
            let routeProps:GpxDisplayProps = super.getDisplayProperties(props)
    
    
            return {
                ...routeProps,
                upcomingElevation: {show:false},
                totalElevation: {show:false},
            }    
        }
    
}
