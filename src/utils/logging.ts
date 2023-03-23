import { AntDeviceSettings, BleDeviceSettings, IncyclistDeviceAdapter, SerialDeviceSettings } from "incyclist-devices";

export function getLegacyInterface(d:IncyclistDeviceAdapter) {
    if (!d)
        return;

    const settings = d.getSettings()

    
    switch (settings?.interface) {
        case 'serial':
        case 'tcpip':
            return (settings as SerialDeviceSettings).protocol
        case 'simulator':
            return 
        case 'ant':
            return "ANT-"+(settings as AntDeviceSettings).profile
        case 'ble':
            return "BLE-"+(settings as BleDeviceSettings).protocol
    
    }
}