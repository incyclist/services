import { UpdateRequest } from "incyclist-devices";
import { RoutePoint } from "../../routes/base/types";
import { ActiveWorkoutLimit } from "../../workouts";
import { RideModeService } from "../base/base";

export class RouteDisplayService extends RideModeService {
    protected prevRequestSlope: number
    protected position: RoutePoint

    onActivityUpdate(data: any, request?: ActiveWorkoutLimit): UpdateRequest {
        const newSlope = this.position?.slope ?? undefined; // should convert null to undefined

        const update:UpdateRequest = {...(request??{})}
        if (newSlope !== undefined && newSlope !== this.prevRequestSlope) {
            update.slope = newSlope;
        }
        this.prevRequestSlope = this.position?.slope
        return update
    }

}
