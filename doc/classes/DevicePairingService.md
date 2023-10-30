[incyclist-services - v1.0.36](../README.md) / DevicePairingService

# Class: DevicePairingService

Service to be used by device pairing screens

Device pairing is required to select the devices to be used by the user and verify the connection to all selected devices/sensors and interfaces

If the user already has selected devices (in previous launches) and at least a SmartTrainer or PowerMeter is connected, 
then the service will just try to connect with the devices/sensors.

If there are no devices (no SmartTrainer/Powermeter) configured yet, then the service will trigger a full scan

The service also allows to enable/disable the Interfaces (ant, ble,serial, tcpip) that should be used for the scan and verifies the connection state of these interfaces.
If an interface gets disabled by the user, then all device/sensors on this interface are exluded from pairing/scanning

This service depends on
 - [DeviceConfiguration Service](./doc/classes/DeviceConfigurationService.md)
 - [DeviceAccess Service](./doc/classes/DeviceAccessService.md)
 - DeviceRide Service

## Hierarchy

- `EventEmitter`

  ↳ **`DevicePairingService`**

## Table of contents

### Constructors

- [constructor](DevicePairingService.md#constructor)

### Methods

- [start](DevicePairingService.md#start)
- [stop](DevicePairingService.md#stop)
- [startDeviceSelection](DevicePairingService.md#startdeviceselection)
- [stopDeviceSelection](DevicePairingService.md#stopdeviceselection)
- [selectDevice](DevicePairingService.md#selectdevice)
- [delectDevice](DevicePairingService.md#delectdevice)
- [changeInterfaceSettings](DevicePairingService.md#changeinterfacesettings)
- [getInstance](DevicePairingService.md#getinstance)

## Constructors

### constructor

• **new DevicePairingService**(`services?`)

#### Parameters

| Name | Type |
| :------ | :------ |
| `services?` | [`Services`](../interfaces/Services.md) |

#### Overrides

EventEmitter.constructor

## Methods

### start

▸ **start**(`onStateChanged`): `Promise`<`void`\>

Starts the pairing process

It will use the [DeviceConfigurationService](DeviceConfigurationService.md) to read the current device and interface configuration
Depending on the device configuration, it will either trigger Pairing(connection with devices/sensors) 
or it will trigger a full scan. The full scan will timeout every 30s and will be repeated until either [stop](DevicePairingService.md#stop) is called or sufficient devices were detected

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `onStateChanged` | (`newState`: [`PairingState`](../interfaces/PairingState.md)) => `void` | callback to be called whenever the Pairing state changes which would require a re-rendering |

#### Returns

`Promise`<`void`\>

**`Example`**

```ts
const service = useDevicePairing()
service.start( (state:PairingState)=>{ 
  console.log('New State:', state)
})
```

**`Throws`**

Does not throw errors

___

### stop

▸ **stop**(): `Promise`<`void`\>

Stops the pairing process

Stop should be called as soon as the user leaves the Device Pairing Screen, as
this will free resources (event handlers) 
Also: The method will pause the devices, so that communication can be properly resumed once that ride is started/resumed

#### Returns

`Promise`<`void`\>

**`Example`**

```ts
const service = useDevicePairing()
await service.stop())
```

**`Throws`**

Does not throw errors

___

### startDeviceSelection

▸ **startDeviceSelection**(`capability`, `onDeviceSelectStateChanged`): [`DeviceSelectState`](../interfaces/DeviceSelectState.md)

Starts a device selection

Incyclist UI provides a screen to select a device/sensor of a certain capability (Control, Power, Heartrate, Speed, Cadence)
When this screen is shown, the service will automatically perform a background scan (no timeout)
to add any devices that can be detected

This method should be called to trigger this process. 

Whenever this is called, any ongoing pairing (initiated by [start](DevicePairingService.md#start)) will be stopped and restarted once [stopDeviceSelection](DevicePairingService.md#stopdeviceselection) or [selectDevice](DevicePairingService.md#selectdevice) has been called

[!WARNING] There can be only one active device selection process. Calling this method twice without subsequent calls to [stopDeviceSelection](DevicePairingService.md#stopdeviceselection) or [selectDevice](DevicePairingService.md#selectdevice) will lead to an unpredicated state

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `capability` | `IncyclistCapability` | the capability to be managed <br><br> One of ( 'control', 'power', 'heartrate', 'speed', 'cadence') |
| `onDeviceSelectStateChanged` | (`newState`: [`DeviceSelectState`](../interfaces/DeviceSelectState.md)) => `void` | callback to be called whenever the content of the device list has changed and a re-render is required |

#### Returns

[`DeviceSelectState`](../interfaces/DeviceSelectState.md)

The initial state

**`Example`**

```ts
const service = startDeviceSelection(IncyclistCapability.Control, (state) => {
   console.log( 
        'Capability:', state.capability, 
        'Devices:', state.devices.map(d=>d.name).join(',') 
   )
})
```

**`Throws`**

Does not throw errors

___

### stopDeviceSelection

▸ **stopDeviceSelection**(): `Promise`<`void`\>

Stops the device selection process

Stop should be called as soon as the user closes the device selection screen. This will stop the current scan and will free all resources (event handlers) 

This method will also automatically restart the pairing process

#### Returns

`Promise`<`void`\>

**`Example`**

```ts
const service = useDevicePairing()
await service.stopDeviceSelection())
```

**`Throws`**

Does not throw errors

___

### selectDevice

▸ **selectDevice**(`capability`, `udid`, `addAll?`): `Promise`<`void`\>

Should be called when the user has selcted a device. This device will then become the active(selected) device for this capability.
Typically the UI will close the Device selectio screen. Therefore, this method will also internally call [stopDeviceSelection](DevicePairingService.md#stopdeviceselection)

This method will also automatically restart the pairing process

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `capability` | `IncyclistCapability` | `undefined` | the capability to be managed <br><br> One of ( 'control', 'power', 'heartrate', 'speed', 'cadence') |
| `udid` | `string` | `undefined` | The unique device ID of the device to be selected |
| `addAll` | `boolean` | `false` | if true, the device will be selected for all capability it supports |

#### Returns

`Promise`<`void`\>

**`Example`**

```ts
const service = useDevicePairing()
await service.selectDevice('control,'508c6bf1-3f2f-4e8d-bcef-bc1910bd2f07', true)
```

**`Throws`**

Does not throw errors

___

### delectDevice

▸ **delectDevice**(`capability`, `udid`, `deleteAll?`): `Promise`<`void`\>

Should be called when the user want to delete a device. This device will then be removed from this capability

In case the debice was previously selected, the next device (by order in list) will become active

As the user might want to delete multiple devices, the screen will typically remain open

This method not stop an ongoing scan. I.e. if the device will be detected again in the scan, it will be re-added

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `capability` | `IncyclistCapability` | `undefined` | the capability to be managed <br><br> One of ( 'control', 'power', 'heartrate', 'speed', 'cadence') |
| `udid` | `string` | `undefined` | The unique device ID of the device to be selected |
| `deleteAll` | `boolean` | `false` | if true, the device will be deleted in all capabilities it supports |

#### Returns

`Promise`<`void`\>

**`Example`**

```ts
const service = useDevicePairing()
await service.deleteDevice('control,'508c6bf1-3f2f-4e8d-bcef-bc1910bd2f07', true)
```

**`Throws`**

Does not throw errors

___

### changeInterfaceSettings

▸ **changeInterfaceSettings**(`name`, `settings`): `Promise`<`void`\>

Should be called when the user has changed the iterface settings ( enabled/disabled and interface)

If the enable state has changed it will then 
- unselect all devices of the given interface from all capabilities
- stop and restart any ongoing pairing or device selection process

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | the name of the interface <br><br> One of ( 'ant', 'ble', 'tcpip', 'serial', 'cadence') |
| `settings` | [`InterfaceSetting`](../interfaces/InterfaceSetting.md) | The updated settings |

#### Returns

`Promise`<`void`\>

**`Example`**

```ts
const service = useDevicePairing()
await service.changeInterfaceSettings('serial',{enabled:'true, protocol:''Daum Classic})
```

**`Throws`**

Does not throw errors

___

### getInstance

▸ `Static` **getInstance**(): [`DevicePairingService`](DevicePairingService.md)

#### Returns

[`DevicePairingService`](DevicePairingService.md)
