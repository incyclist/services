
export type CoachType = 'Speed'|'Power'

export type CoachSettings = {
    name: string;
    type: CoachType;
    target: number;
    lead?:number;
}

export type CoachStatus = {
    routePosition?: number
    riderPosition?: number
    speed?:number
    power?:number
}

