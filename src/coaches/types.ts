import { FormattedNumber } from "../i18n";

export type CoachType = 'speed'|'power'

export type CoachSettings = {
    name: string;
    type: CoachType;
    target: number;
    lead?:number;
}

export type CoachEditProps = {
    name: string;
    type: string;
    power?: number;
    speed?: number|FormattedNumber;
    lead?:number|FormattedNumber;
}

export type CoachStatus = {
    routePosition?: number
    riderPosition?: number
    speed?:number
    power?:number
    name:string;
    avatar:string;
    lat?:number;
    lng?:number;

}


