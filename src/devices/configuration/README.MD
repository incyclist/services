# DeviceConfiguration Service

Pseudo Declaration

```
DeviceConfigurationService <Singleton>
    (/) init()

    (/) select(adapter, capability):void 
    (/) add(adapter):void
    (/) delete(adapter,capability?):void

    (/) getSelected(capability): IncyclistDeviceAdapter
    (/) getCapabilityInfo(capability):TODO[]

    (/) enableInterface(interface)
    (/) disableInterface(interface)
    (/) isEnabled(interface)

    getInterfaceSettings(interface) // Serial: select protocl, TCPIP/BLE/Ant: nothing

    setMode(adapter,mode, settings?)
    getModeSettings(adapter,mode)

Events:
   changed
   device-added
   initialized
```
