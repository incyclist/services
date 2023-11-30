import { Route } from "../routes";

/**
 * Returns if the argument is a valid object, i.e. does not equal null or undefined and can be stringified
 *
 * @param {Object}  v - argument 
 */
export function valid(v) {
    if ( v===undefined || v===null)
        return false;
    try {JSON.stringify(v)} catch {
        return false
    }
    return true;
}

/*
export const validate = (route: Route) => {
    const points = route.data?.points;

    if (points === undefined || points.length === 0)
        return;

    const inValid = (d) => (d === undefined || d === null || isNaN(d));

    const useLatLng = !this.gpxDisabled();
    let routeDistance = 0;
    let isLap = this.isLap();
    let prevHeading;
    points.forEach((p, cnt) => {

        if (inValid(p.distance)) {
            p.distance = cnt === 0 ? 0 : geo.distanceBetween(points[cnt - 1], p, { latLng: useLatLng });
        }

        if (inValid(p.routeDistance))
            p.routeDistance = p.distance + routeDistance;

        if (inValid(p.heading) && !this.gpxDisabled()) {
            let p1;
            if (cnt < points.length - 1) {
                p1 = points[cnt + 1];
            }
            else {
                p1 = isLap ? points[0] : undefined;
            }

            const heading = headingBetween(p, p1);
            if (heading !== undefined) {
                p.heading = heading;
                prevHeading = p.heading;
            }
            else {
                p.heading = prevHeading;
            }
        }
        p.cnt = cnt;
        routeDistance = p.routeDistance;

    });
    this.data.distance = routeDistance;

    if (route === undefined) {
        this.updateSlopeProfile();
        this.calculateStats();
        this.isValidated = true;
    }

    this.getHash();

    this.data.validated = true;
};
*/