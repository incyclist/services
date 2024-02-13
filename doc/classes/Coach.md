[incyclist-services - v1.1.98](../README.md) / Coach

# Class: Coach

## Table of contents

### Constructors

- [constructor](Coach.md#constructor)

### Accessors

- [id](Coach.md#id)
- [settings](Coach.md#settings)
- [lead](Coach.md#lead)

### Methods

- [setProgress](Coach.md#setprogress)
- [getProgess](Coach.md#getprogess)
- [setPosition](Coach.md#setposition)
- [getPosition](Coach.md#getposition)
- [setRiderPosition](Coach.md#setriderposition)
- [sendDeviceUpdate](Coach.md#senddeviceupdate)
- [getDisplayProperties](Coach.md#getdisplayproperties)
- [update](Coach.md#update)
- [initSimulator](Coach.md#initsimulator)
- [start](Coach.md#start)
- [stop](Coach.md#stop)

## Constructors

### constructor

• **new Coach**(`settings`): [`Coach`](Coach.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `settings` | [`CoachSettings`](../README.md#coachsettings) |

#### Returns

[`Coach`](Coach.md)

## Accessors

### id

• `get` **id**(): `string`

#### Returns

`string`

___

### settings

• `get` **settings**(): [`CoachSettings`](../README.md#coachsettings)

#### Returns

[`CoachSettings`](../README.md#coachsettings)

___

### lead

• `get` **lead**(): `number`

#### Returns

`number`

## Methods

### setProgress

▸ **setProgress**(`routeDistance`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `routeDistance` | `number` |

#### Returns

`void`

___

### getProgess

▸ **getProgess**(): `number`

#### Returns

`number`

___

### setPosition

▸ **setPosition**(`point`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `point` | `RoutePoint` |

#### Returns

`void`

___

### getPosition

▸ **getPosition**(): `RoutePoint`

#### Returns

`RoutePoint`

___

### setRiderPosition

▸ **setRiderPosition**(`routeDistance`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `routeDistance` | `number` |

#### Returns

`void`

___

### sendDeviceUpdate

▸ **sendDeviceUpdate**(`request`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `request` | `any` |

#### Returns

`void`

___

### getDisplayProperties

▸ **getDisplayProperties**(): [`CoachEditProps`](../README.md#coacheditprops)

#### Returns

[`CoachEditProps`](../README.md#coacheditprops)

___

### update

▸ **update**(`settings`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `settings` | [`CoachEditProps`](../README.md#coacheditprops) |

#### Returns

`void`

___

### initSimulator

▸ **initSimulator**(`user`, `bikeType`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `user` | `Object` |
| `user.weight` | `number` |
| `bikeType` | `string` |

#### Returns

`void`

___

### start

▸ **start**(`onData`): `Promise`\<`void`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `onData` | `any` |

#### Returns

`Promise`\<`void`\>

___

### stop

▸ **stop**(): `void`

#### Returns

`void`
