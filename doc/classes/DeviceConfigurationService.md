[incyclist-services - v1.0.0](../README.md) / DeviceConfigurationService

# Class: DeviceConfigurationService

Manages the user configuration of devices and interfaces
 - Detected Devices and Sensors
 - Selected Devices and Sensors per Capability
 - Cycling Mode settings for all devices.
 - Enabled/Disabled Interfaces

## Hierarchy

- `EventEmitter`

  ↳ **`DeviceConfigurationService`**

## Table of contents

### Constructors

- [constructor](DeviceConfigurationService.md#constructor)

### Properties

- [adapters](DeviceConfigurationService.md#adapters)
- [settings](DeviceConfigurationService.md#settings)
- [userSettings](DeviceConfigurationService.md#usersettings)

### Methods

- [add](DeviceConfigurationService.md#add)
- [canStartRide](DeviceConfigurationService.md#canstartride)
- [delete](DeviceConfigurationService.md#delete)
- [disableCapability](DeviceConfigurationService.md#disablecapability)
- [disableInterface](DeviceConfigurationService.md#disableinterface)
- [emitInterfaceChanged](DeviceConfigurationService.md#emitinterfacechanged)
- [emitModeChanged](DeviceConfigurationService.md#emitmodechanged)
- [enableInterface](DeviceConfigurationService.md#enableinterface)
- [getAdapter](DeviceConfigurationService.md#getadapter)
- [getAdapters](DeviceConfigurationService.md#getadapters)
- [getInterfaceSettings](DeviceConfigurationService.md#getinterfacesettings)
- [getModeSettings](DeviceConfigurationService.md#getmodesettings)
- [getSelected](DeviceConfigurationService.md#getselected)
- [getUdid](DeviceConfigurationService.md#getudid)
- [init](DeviceConfigurationService.md#init)
- [initFromLegacy](DeviceConfigurationService.md#initfromlegacy)
- [isInitialized](DeviceConfigurationService.md#isinitialized)
- [isInterfaceEnabled](DeviceConfigurationService.md#isinterfaceenabled)
- [setDisplayName](DeviceConfigurationService.md#setdisplayname)
- [setInterfaceSettings](DeviceConfigurationService.md#setinterfacesettings)
- [setMode](DeviceConfigurationService.md#setmode)
- [setModeSettings](DeviceConfigurationService.md#setmodesettings)
- [unselect](DeviceConfigurationService.md#unselect)
- [updateUserSettings](DeviceConfigurationService.md#updateusersettings)
- [getInstance](DeviceConfigurationService.md#getinstance)

### Events

- [select](DeviceConfigurationService.md#select)

## Constructors

### constructor

• **new DeviceConfigurationService**()

#### Overrides

EventEmitter.constructor

## Properties

### adapters

• **adapters**: `DeviceAdapterList` = `{}`

___

### settings

• **settings**: [`DeviceConfigurationSettings`](../interfaces/DeviceConfigurationSettings.md)

___

### userSettings

• **userSettings**: `any`

## Methods

### add

▸ **add**(`deviceSettings`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `deviceSettings` | [`IncyclistDeviceSettings`](../README.md#incyclistdevicesettings) |

#### Returns

`void`

___

### canStartRide

▸ **canStartRide**(): `boolean`

provides information if for all requires capabilities a device has been selected, so that a training can be started

#### Returns

`boolean`

___

### delete

▸ **delete**(`udid`, `capability?`, `forceSingle?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `udid` | `string` | `undefined` |
| `capability?` | [`ExtendedIncyclistCapability`](../README.md#extendedincyclistcapability) | `undefined` |
| `forceSingle` | `boolean` | `false` |

#### Returns

`void`

___

### disableCapability

▸ **disableCapability**(`cability`, `disabled?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `cability` | [`ExtendedIncyclistCapability`](../README.md#extendedincyclistcapability) | `undefined` |
| `disabled` | `boolean` | `true` |

#### Returns

`void`

___

### disableInterface

▸ **disableInterface**(`ifName`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifName` | `string` |

#### Returns

`void`

___

### emitInterfaceChanged

▸ **emitInterfaceChanged**(`ifName`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifName` | `string` |

#### Returns

`void`

___

### emitModeChanged

▸ **emitModeChanged**(`udid`, `mode`, `settings`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `udid` | `string` |
| `mode` | `string` |
| `settings` | `any` |

#### Returns

`void`

___

### enableInterface

▸ **enableInterface**(`ifName`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifName` | `string` |

#### Returns

`void`

___

### getAdapter

▸ **getAdapter**(`udid`): `IncyclistDeviceAdapter`

#### Parameters

| Name | Type |
| :------ | :------ |
| `udid` | `string` |

#### Returns

`IncyclistDeviceAdapter`

___

### getAdapters

▸ **getAdapters**(): [`AdapterInfo`](../interfaces/AdapterInfo.md)[]

provides the list of selected adapters (to be used by the DeviceRideService)

#### Returns

[`AdapterInfo`](../interfaces/AdapterInfo.md)[]

___

### getInterfaceSettings

▸ **getInterfaceSettings**(`ifName`): [`InterfaceSetting`](../interfaces/InterfaceSetting.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifName` | `string` |

#### Returns

[`InterfaceSetting`](../interfaces/InterfaceSetting.md)

___

### getModeSettings

▸ **getModeSettings**(`requestedUdid?`, `requestedMode?`): [`DeviceModeInfo`](../interfaces/DeviceModeInfo.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `requestedUdid?` | `string` |
| `requestedMode?` | `string` |

#### Returns

[`DeviceModeInfo`](../interfaces/DeviceModeInfo.md)

___

### getSelected

▸ **getSelected**(`capability`): `IncyclistDeviceAdapter`

#### Parameters

| Name | Type |
| :------ | :------ |
| `capability` | [`ExtendedIncyclistCapability`](../README.md#extendedincyclistcapability) |

#### Returns

`IncyclistDeviceAdapter`

___

### getUdid

▸ **getUdid**(`deviceSettings`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `deviceSettings` | [`IncyclistDeviceSettings`](../README.md#incyclistdevicesettings) |

#### Returns

`string`

___

### init

▸ **init**(): `Promise`<`void`\>

Initializes the Device Settings

It will use the [UserSettingsService](UserSettingsService.md) to read the data and stores it in the [settings](DeviceConfigurationService.md#settings) property

The init method will check if the settings format is

**`Emits`**

__initialized__ Emitted once the configuration is fully initialized

#### Returns

`Promise`<`void`\>

___

### initFromLegacy

▸ **initFromLegacy**(`settings?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `settings` | [`LegacySettings`](../interfaces/LegacySettings.md) |

#### Returns

`void`

___

### isInitialized

▸ **isInitialized**(): `boolean`

Provides the initialization state of the interface

#### Returns

`boolean`

`true` if the interface has been initialized, `false` otherwise

___

### isInterfaceEnabled

▸ **isInterfaceEnabled**(`ifName`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifName` | `string` |

#### Returns

`boolean`

___

### setDisplayName

▸ **setDisplayName**(`deviceSettings`, `displayName?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `deviceSettings` | [`IncyclistDeviceSettings`](../README.md#incyclistdevicesettings) |
| `displayName?` | `string` |

#### Returns

`void`

___

### setInterfaceSettings

▸ **setInterfaceSettings**(`ifName`, `settings`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifName` | `any` |
| `settings` | [`InterfaceSetting`](../interfaces/InterfaceSetting.md) |

#### Returns

`void`

___

### setMode

▸ **setMode**(`udid`, `mode`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `udid` | `string` |
| `mode` | `string` |

#### Returns

`void`

___

### setModeSettings

▸ **setModeSettings**(`udid`, `mode`, `settings`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `udid` | `string` |
| `mode` | `string` |
| `settings` | `any` |

#### Returns

`void`

___

### unselect

▸ **unselect**(`capability`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `capability` | [`ExtendedIncyclistCapability`](../README.md#extendedincyclistcapability) |

#### Returns

`void`

___

### updateUserSettings

▸ **updateUserSettings**(): `void`

#### Returns

`void`

___

### getInstance

▸ `Static` **getInstance**(): [`DeviceConfigurationService`](DeviceConfigurationService.md)

#### Returns

[`DeviceConfigurationService`](DeviceConfigurationService.md)

## Events

### select

▸ **select**(`udid`, `capability`, `noRecursive?`): `void`

Marks a device as selected for a given capability

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `udid` | `string` | `undefined` | The unique device id of the device |
| `capability` | [`ExtendedIncyclistCapability`](../README.md#extendedincyclistcapability) | `undefined` | The cability for which the device should be marked as selected device-changed in case the settings were changed device-added in case the device was not yet known |
| `noRecursive` | `boolean` | `false` | - |

#### Returns

`void`
