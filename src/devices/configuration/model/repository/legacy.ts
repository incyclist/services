
export interface LegacyGearSetting {
    name: string;
    displayName?: string;
    selected: boolean;
    protocol: string;
    deviceID?: string;
    profile?: string;
    host?: string;
    port?: string
    interface: string
}

export interface LegacyDeviceSelectionSettings {
    bikes?: LegacyGearSetting[],
    hrms?: LegacyGearSetting[],
    disableHrm?:boolean
}

export interface LegacySerialPortInfo {
    [index: string]: {
        name: string;
        enabled: boolean
    };
}

export interface LegacySerialSettings {
    enabled: boolean;
    protocols: {
        name: string;
        selected: boolean;
        id?: number
    } []
}

export interface LegacyAntSettings {
    enabled: boolean
    bike: boolean
    hrm: boolean
}


export interface LegacyDeviceConnectionSettings {
    serial: LegacySerialSettings & LegacySerialPortInfo;
    ant:LegacyAntSettings
    tcpip: {
        enabled: boolean
    }
}

export interface IncyclistModeSettings {
    mode: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    settings: any 
}

export interface LegacyModeSettings {
    [index: string] :IncyclistModeSettings 
}

export interface LegacyPreferences {
    gear: LegacyModeSettings
}

export interface LegacySettings {
    connections?: LegacyDeviceConnectionSettings;
    gearSelection?: LegacyDeviceSelectionSettings;
    modeSettings?: LegacyModeSettings;
}