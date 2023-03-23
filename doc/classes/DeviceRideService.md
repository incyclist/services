[incyclist-services - v1.0.0](../README.md) / DeviceRideService

# Class: DeviceRideService

Provides method to consume a devcie
 - start/stop/pause/resume a ride
 - check availability of a device
 - process bike updates
 - send bike updates

## Hierarchy

- `EventEmitter`

  ↳ **`DeviceRideService`**

## Table of contents

### Constructors

- [constructor](DeviceRideService.md#constructor)

### Methods

- [cancelStart](DeviceRideService.md#cancelstart)
- [enforceSimulator](DeviceRideService.md#enforcesimulator)
- [getCyclingMode](DeviceRideService.md#getcyclingmode)
- [lazyInit](DeviceRideService.md#lazyinit)
- [logEvent](DeviceRideService.md#logevent)
- [onCyclingModeChanged](DeviceRideService.md#oncyclingmodechanged)
- [onData](DeviceRideService.md#ondata)
- [pause](DeviceRideService.md#pause)
- [prepareEppRoute](DeviceRideService.md#prepareepproute)
- [resume](DeviceRideService.md#resume)
- [sendUpdate](DeviceRideService.md#sendupdate)
- [setDebug](DeviceRideService.md#setdebug)
- [start](DeviceRideService.md#start)
- [startRide](DeviceRideService.md#startride)
- [stop](DeviceRideService.md#stop)
- [getInstance](DeviceRideService.md#getinstance)

## Constructors

### constructor

• **new DeviceRideService**()

#### Overrides

EventEmitter.constructor

## Methods

### cancelStart

▸ **cancelStart**(): `Promise`<`boolean`\>

#### Returns

`Promise`<`boolean`\>

___

### enforceSimulator

▸ **enforceSimulator**(`enforced?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `enforced` | `boolean` | `true` |

#### Returns

`void`

___

### getCyclingMode

▸ **getCyclingMode**(`udid?`): `default`

#### Parameters

| Name | Type |
| :------ | :------ |
| `udid?` | `string` |

#### Returns

`default`

___

### lazyInit

▸ **lazyInit**(): `Promise`<`void`\>

#### Returns

`Promise`<`void`\>

___

### logEvent

▸ **logEvent**(`event`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | `any` |

#### Returns

`void`

___

### onCyclingModeChanged

▸ **onCyclingModeChanged**(`udid`, `mode`, `settings`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `udid` | `string` |
| `mode` | `string` |
| `settings` | `any` |

#### Returns

`void`

___

### onData

▸ **onData**(`deviceSettings`, `data`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `deviceSettings` | `DeviceSettings` |
| `data` | `DeviceData` |

#### Returns

`void`

___

### pause

▸ **pause**(): `void`

#### Returns

`void`

___

### prepareEppRoute

▸ **prepareEppRoute**(`props`): [`PreparedRoute`](../interfaces/PreparedRoute.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `props` | [`RideServiceDeviceProperties`](../interfaces/RideServiceDeviceProperties.md) |

#### Returns

[`PreparedRoute`](../interfaces/PreparedRoute.md)

___

### resume

▸ **resume**(): `void`

#### Returns

`void`

___

### sendUpdate

▸ **sendUpdate**(`request`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `request` | `UpdateRequest` |

#### Returns

`void`

___

### setDebug

▸ **setDebug**(`enabled`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `enabled` | `boolean` |

#### Returns

`void`

___

### start

▸ **start**(`props`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `props` | [`RideServiceDeviceProperties`](../interfaces/RideServiceDeviceProperties.md) |

#### Returns

`Promise`<`boolean`\>

___

### startRide

▸ **startRide**(`_props`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `_props` | `any` |

#### Returns

`void`

___

### stop

▸ **stop**(): `Promise`<`boolean`\>

#### Returns

`Promise`<`boolean`\>

___

### getInstance

▸ `Static` **getInstance**(): [`DeviceRideService`](DeviceRideService.md)

#### Returns

[`DeviceRideService`](DeviceRideService.md)
