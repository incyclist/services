[incyclist-services - v1.2.2](../README.md) / DeviceRideService

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

- [logEvent](DeviceRideService.md#logevent)
- [setDebug](DeviceRideService.md#setdebug)
- [lazyInit](DeviceRideService.md#lazyinit)
- [getAdapterStateInfo](DeviceRideService.md#getadapterstateinfo)
- [prepareEppRoute](DeviceRideService.md#prepareepproute)
- [waitForPreviousStartToFinish](DeviceRideService.md#waitforpreviousstarttofinish)
- [startCheck](DeviceRideService.md#startcheck)
- [getAdapters](DeviceRideService.md#getadapters)
- [setSerialPortInUse](DeviceRideService.md#setserialportinuse)
- [startAdapters](DeviceRideService.md#startadapters)
- [startHealthCheck](DeviceRideService.md#starthealthcheck)
- [stopHealthCheck](DeviceRideService.md#stophealthcheck)
- [prepareReconnect](DeviceRideService.md#preparereconnect)
- [start](DeviceRideService.md#start)
- [startRetry](DeviceRideService.md#startretry)
- [cancelStart](DeviceRideService.md#cancelstart)
- [startRide](DeviceRideService.md#startride)
- [stop](DeviceRideService.md#stop)
- [pause](DeviceRideService.md#pause)
- [resume](DeviceRideService.md#resume)
- [onData](DeviceRideService.md#ondata)
- [sendUpdate](DeviceRideService.md#sendupdate)
- [getCyclingMode](DeviceRideService.md#getcyclingmode)
- [resetCyclingMode](DeviceRideService.md#resetcyclingmode)
- [onCyclingModeChanged](DeviceRideService.md#oncyclingmodechanged)
- [onDeviceDeleted](DeviceRideService.md#ondevicedeleted)
- [enforceSimulator](DeviceRideService.md#enforcesimulator)
- [getInstance](DeviceRideService.md#getinstance)

## Constructors

### constructor

• **new DeviceRideService**(): [`DeviceRideService`](DeviceRideService.md)

#### Returns

[`DeviceRideService`](DeviceRideService.md)

#### Overrides

EventEmitter.constructor

## Methods

### logEvent

▸ **logEvent**(`event`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | `any` |

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

### lazyInit

▸ **lazyInit**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

___

### getAdapterStateInfo

▸ **getAdapterStateInfo**(`adapterInfo`): [`AdapterStateInfo`](../interfaces/AdapterStateInfo.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `adapterInfo` | [`AdapterInfo`](../interfaces/AdapterInfo.md) |

#### Returns

[`AdapterStateInfo`](../interfaces/AdapterStateInfo.md)

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

### waitForPreviousStartToFinish

▸ **waitForPreviousStartToFinish**(): `Promise`\<`boolean`\>

#### Returns

`Promise`\<`boolean`\>

___

### startCheck

▸ **startCheck**(`filter`): `Promise`\<`void`\>

Performs a check if a given device or a group of devices can be started
The check can be filltered by various criteria: interface(s), capability, udid
If multiple filter criteria are specified, the will be combined with an AND operation

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `filter` | [`RideServiceCheckFilter`](../interfaces/RideServiceCheckFilter.md) | allows to filter the devices that should be started |

#### Returns

`Promise`\<`void`\>

void

___

### getAdapters

▸ **getAdapters**(`filter`): [`AdapterRideInfo`](../interfaces/AdapterRideInfo.md)[]

Filters the list of adapters based on various criteria: interface(s), capability, udid
If multiple filter criteria are specified, the will be combined with an AND operation

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `filter` | [`RideServiceCheckFilter`](../interfaces/RideServiceCheckFilter.md) | allows to filter the devices that should be started |

#### Returns

[`AdapterRideInfo`](../interfaces/AdapterRideInfo.md)[]

void

___

### setSerialPortInUse

▸ **setSerialPortInUse**(`adapter`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `adapter` | `IncyclistDeviceAdapter` |

#### Returns

`void`

___

### startAdapters

▸ **startAdapters**(`adapters`, `startType`, `props?`): `Promise`\<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `adapters` | [`AdapterRideInfo`](../interfaces/AdapterRideInfo.md)[] |
| `startType` | ``"start"`` \| ``"check"`` \| ``"pair"`` |
| `props?` | [`RideServiceDeviceProperties`](../interfaces/RideServiceDeviceProperties.md) |

#### Returns

`Promise`\<`boolean`\>

___

### startHealthCheck

▸ **startHealthCheck**(`ai`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ai` | [`AdapterRideInfo`](../interfaces/AdapterRideInfo.md) |

#### Returns

`void`

___

### stopHealthCheck

▸ **stopHealthCheck**(`ai`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ai` | [`AdapterRideInfo`](../interfaces/AdapterRideInfo.md) |

#### Returns

`void`

___

### prepareReconnect

▸ **prepareReconnect**(`unhealthy`): `Promise`\<`void`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `unhealthy` | [`AdapterRideInfo`](../interfaces/AdapterRideInfo.md) |

#### Returns

`Promise`\<`void`\>

___

### start

▸ **start**(`props`): `Promise`\<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `props` | [`RideServiceDeviceProperties`](../interfaces/RideServiceDeviceProperties.md) |

#### Returns

`Promise`\<`boolean`\>

___

### startRetry

▸ **startRetry**(`props`): `Promise`\<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `props` | [`RideServiceDeviceProperties`](../interfaces/RideServiceDeviceProperties.md) |

#### Returns

`Promise`\<`boolean`\>

___

### cancelStart

▸ **cancelStart**(): `Promise`\<`boolean`\>

#### Returns

`Promise`\<`boolean`\>

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

▸ **stop**(`udid?`): `Promise`\<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `udid?` | `string` |

#### Returns

`Promise`\<`boolean`\>

___

### pause

▸ **pause**(): `void`

#### Returns

`void`

___

### resume

▸ **resume**(): `void`

#### Returns

`void`

___

### onData

▸ **onData**(`deviceSettings`, `data`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `deviceSettings` | `DeviceSettings` |
| `data` | `IncyclistAdapterData` |

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

### getCyclingMode

▸ **getCyclingMode**(`udid?`): `CyclingMode`

#### Parameters

| Name | Type |
| :------ | :------ |
| `udid?` | `string` |

#### Returns

`CyclingMode`

___

### resetCyclingMode

▸ **resetCyclingMode**(`sendInit?`): `Promise`\<`void`\>

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `sendInit` | `boolean` | `false` |

#### Returns

`Promise`\<`void`\>

___

### onCyclingModeChanged

▸ **onCyclingModeChanged**(`udid`, `mode`, `settings`): `Promise`\<`void`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `udid` | `string` |
| `mode` | `string` |
| `settings` | `any` |

#### Returns

`Promise`\<`void`\>

___

### onDeviceDeleted

▸ **onDeviceDeleted**(`settings`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `settings` | [`IncyclistDeviceSettings`](../README.md#incyclistdevicesettings) |

#### Returns

`void`

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

### getInstance

▸ **getInstance**(): [`DeviceRideService`](DeviceRideService.md)

#### Returns

[`DeviceRideService`](DeviceRideService.md)
