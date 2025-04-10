import { Route } from "incyclist-devices";
import { RoutePoint } from "../../routes/base/types";
import { GpxDisplayProps, RouteDisplayProps } from "../base";
import { RouteDisplayService } from "./RouteDisplayService";

export class GpxDisplayService extends RouteDisplayService {

    protected mode: 'sv' | 'map' | 'sat'

    // for StreetView we can't update the position more frequently than every 3 seconds
    // also: we need to provide heading for StreetView
    getStreetViewProps() {
        return {}
    }

    // We might need to restrict the position update frequency, similar to StreetView
    getSatteliteViewProps() {
        return {}
    }

    getDisplayProperties():GpxDisplayProps {
        let props:RouteDisplayProps = super.getDisplayProperties()

        if (this.mode==='sv') {
            props = {...props, ...this.getStreetViewProps()}
        }
        else if (this.mode==='sat') {
            props = {...props, ...this.getSatteliteViewProps()}
        }

        console.log('# route display props', props)
        return {
            mode: this.mode,
            ...props
        }    
    }
    
}
