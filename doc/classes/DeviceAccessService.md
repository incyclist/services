[incyclist-services - v1.0.0-beta.1](../README.md) / DeviceAccessService

# Class: DeviceAccessService

Manages the access to devices and interfaces
 - Allows to scan for devices
 - Enable/Disable Interfaces

## Hierarchy

- `EventEmitter`

  ↳ **`DeviceAccessService`**

## Table of contents

### Constructors

- [constructor](DeviceAccessService.md#constructor)

### Methods

- [connect](DeviceAccessService.md#connect)
- [disableInterface](DeviceAccessService.md#disableinterface)
- [disconnect](DeviceAccessService.md#disconnect)
- [enableInterface](DeviceAccessService.md#enableinterface)
- [isScanning](DeviceAccessService.md#isscanning)
- [scan](DeviceAccessService.md#scan)
- [setDefaultInterfaceProperties](DeviceAccessService.md#setdefaultinterfaceproperties)
- [setInterfaceProperties](DeviceAccessService.md#setinterfaceproperties)
- [stopScan](DeviceAccessService.md#stopscan)
- [getInstance](DeviceAccessService.md#getinstance)

## Constructors

### constructor

• **new DeviceAccessService**()

#### Overrides

EventEmitter.constructor

## Methods

### connect

▸ **connect**(`ifaceName`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName` | `string` |

#### Returns

`Promise`<`boolean`\>

___

### disableInterface

▸ **disableInterface**(`ifaceName`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName` | `string` |

#### Returns

`void`

___

### disconnect

▸ **disconnect**(`ifaceName?`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName?` | `string` |

#### Returns

`Promise`<`boolean`\>

___

### enableInterface

▸ **enableInterface**(`ifaceName`, `binding?`, `props?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName` | `string` |
| `binding?` | `any` |
| `props` | `InterfaceAccessProps` |

#### Returns

`void`

___

### isScanning

▸ **isScanning**(`ifaceName?`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName?` | `string` |

#### Returns

`boolean`

___

### scan

▸ **scan**(`filter?`): `Promise`<`DeviceSettings`[]\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `filter` | `ScanFilter` |

#### Returns

`Promise`<`DeviceSettings`[]\>

___

### setDefaultInterfaceProperties

▸ **setDefaultInterfaceProperties**(`props`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `props` | `InterfaceAccessProps` |

#### Returns

`void`

___

### setInterfaceProperties

▸ **setInterfaceProperties**(`ifaceName`, `props`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName` | `string` |
| `props` | `InterfaceAccessProps` |

#### Returns

`void`

___

### stopScan

▸ **stopScan**(): `Promise`<`boolean`\>

#### Returns

`Promise`<`boolean`\>

___

### getInstance

▸ `Static` **getInstance**(): [`DeviceAccessService`](DeviceAccessService.md)

#### Returns

[`DeviceAccessService`](DeviceAccessService.md)
