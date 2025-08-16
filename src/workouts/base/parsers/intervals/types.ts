
export interface IntervalsWorkout {
    description: string;
    description_locale?: Record<string, string>;
    duration?: number;
    distance?: number;
    ftp?: number;
    lthr?: number;
    max_hr?: number;
    threshold_pace?: number; // meters/sec
    pace_units?: 'SECS_100M' | 'SECS_100Y' | 'MINS_KM' | 'MINS_MILE' | 'SECS_500M';
    sportSettings: any;
    category?: string;
    target?: IntervalsWorkoutTarget;
    steps: IntervalsStep[];
    zoneTimes?: Array<number | object>; // sometimes array of ints otherwise array of objects
    options?: Record<string, string>;
    locales?: string[];
}

export enum Option {
    category = 'category',
    pool_length = 'pool_length',
    power = 'power'
}

export interface IntervalsStep {
    text?: string;
    text_locale?: Record<string, string>;
    duration?: number;
    distance?: number;
    until_lap_press?: boolean;
    reps?: number;
    warmup?: boolean;
    cooldown?: boolean;
    intensity?: "active" | "rest" | "warmup" | "cooldown" | "recovery" | "interval" | "other";
    steps?: IntervalsStep[];
    ramp?: boolean;
    freeride?: boolean;
    maxeffort?: boolean;
    power?: IntervalsValue;
    hr?: IntervalsValue;
    pace?: IntervalsValue;
    cadence?: IntervalsValue;
    hidepower?: boolean;
    _power?: IntervalsValue;
    _hr?: IntervalsValue;
    _pace?: IntervalsValue;
    _distance?: number;
}


export type IntervalsWorkoutTarget = 'A' | 'W' | 'H' | 'P'

export type PowerUnits = '%ftp'| 'power_zone' | '%mmp' | 'w'

export  interface IntervalsValue {
    value?: number;
    start?: number;
    end?: number;
    units?: string;
    target?: string;
    mmp_duration?: number;
}