import { IncyclistService } from "../base/service";
import { Singleton } from "../base/types";
import { Coach } from "./coach";
import { CoachSettings } from "./types";

@Singleton
export class CoachesService extends IncyclistService {

    protected coaches: Array<Coach> = []

    constructor() {
        super('Coaches')
    }

    openCoachSettings() {

    }

    
    add(settings:CoachSettings) {
        const coach = new Coach(settings)
        this.coaches.push(coach)
    }


    startRide() {

    }

    updateRiderPosition( routeDistance:number) {
        
    }

}

export const getCoachesService = () => new CoachesService()