[incyclist-services - v1.0.36](../README.md) / DeviceConfigurationService

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

- [settings](DeviceConfigurationService.md#settings)
- [userSettings](DeviceConfigurationService.md#usersettings)
- [adapters](DeviceConfigurationService.md#adapters)

### Methods

- [init](DeviceConfigurationService.md#init)
- [isInitialized](DeviceConfigurationService.md#isinitialized)
- [initFromLegacy](DeviceConfigurationService.md#initfromlegacy)
- [load](DeviceConfigurationService.md#load)
- [disableCapability](DeviceConfigurationService.md#disablecapability)
- [unselect](DeviceConfigurationService.md#unselect)
- [add](DeviceConfigurationService.md#add)
- [delete](DeviceConfigurationService.md#delete)
- [getUdid](DeviceConfigurationService.md#getudid)
- [setDisplayName](DeviceConfigurationService.md#setdisplayname)
- [getAdapter](DeviceConfigurationService.md#getadapter)
- [updateUserSettings](DeviceConfigurationService.md#updateusersettings)
- [canStartRide](DeviceConfigurationService.md#canstartride)
- [getModeSettings](DeviceConfigurationService.md#getmodesettings)
- [setMode](DeviceConfigurationService.md#setmode)
- [setModeSettings](DeviceConfigurationService.md#setmodesettings)
- [emitModeChanged](DeviceConfigurationService.md#emitmodechanged)
- [getAdapters](DeviceConfigurationService.md#getadapters)
- [getAllAdapters](DeviceConfigurationService.md#getalladapters)
- [getSelected](DeviceConfigurationService.md#getselected)
- [getSelectedDevices](DeviceConfigurationService.md#getselecteddevices)
- [getInterfaceSettings](DeviceConfigurationService.md#getinterfacesettings)
- [isInterfaceEnabled](DeviceConfigurationService.md#isinterfaceenabled)
- [enableInterface](DeviceConfigurationService.md#enableinterface)
- [disableInterface](DeviceConfigurationService.md#disableinterface)
- [setInterfaceSettings](DeviceConfigurationService.md#setinterfacesettings)
- [emitInterfaceChanged](DeviceConfigurationService.md#emitinterfacechanged)
- [emitDeviceDeleted](DeviceConfigurationService.md#emitdevicedeleted)
- [getInstance](DeviceConfigurationService.md#getinstance)

### Events

- [select](DeviceConfigurationService.md#select)

## Constructors

### constructor

• **new DeviceConfigurationService**()

#### Overrides

EventEmitter.constructor

## Properties

### settings

• **settings**: [`DeviceConfigurationSettings`](../interfaces/DeviceConfigurationSettings.md)

___

### userSettings

• **userSettings**: [`UserSettingsService`](UserSettingsService.md)

___

### adapters

• **adapters**: `DeviceAdapterList` = `{}`

## Methods

### init

▸ **init**(): `Promise`<`void`\>

Initializes the Device Settings

It will use the [[UserSettingsService]] to read the data and stores it in the [[settings]] property

The init method will check if the settings format is

#### Returns

`Promise`<`void`\>

**`Emits`**

__initialized__ Emitted once the configuration is fully initialized

___

### isInitialized

▸ **isInitialized**(): `boolean`

Provides the initialization state of the interface

#### Returns

`boolean`

`true` if the interface has been initialized, `false` otherwise

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

### load

▸ **load**(): `Object`

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `capabilities` | [`DeviceConfigurationInfo`](../interfaces/DeviceConfigurationInfo.md) |
| `interfaces` | [`InterfaceSetting`](../interfaces/InterfaceSetting.md)[] |

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

### unselect

▸ **unselect**(`capability`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `capability` | [`ExtendedIncyclistCapability`](../README.md#extendedincyclistcapability) |

#### Returns

`void`

___

### add

▸ **add**(`deviceSettings`, `props?`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `deviceSettings` | [`IncyclistDeviceSettings`](../README.md#incyclistdevicesettings) |
| `props?` | `Object` |
| `props.legacy?` | `boolean` |

#### Returns

`string`

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

### getUdid

▸ **getUdid**(`deviceSettings`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `deviceSettings` | [`IncyclistDeviceSettings`](../README.md#incyclistdevicesettings) |

#### Returns

`string`

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

### getAdapter

▸ **getAdapter**(`udid`): `IncyclistDeviceAdapter`

#### Parameters

| Name | Type |
| :------ | :------ |
| `udid` | `string` |

#### Returns

`IncyclistDeviceAdapter`

___

### updateUserSettings

▸ **updateUserSettings**(): `void`

#### Returns

`void`

___

### canStartRide

▸ **canStartRide**(): `boolean`

provides information if for all requires capabilities a device has been selected, so that a training can be started

#### Returns

`boolean`

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

### getAdapters

▸ **getAdapters**(): [`AdapterInfo`](../interfaces/AdapterInfo.md)[]

provides the list of selected adapters (to be used by the DeviceRideService)

#### Returns

[`AdapterInfo`](../interfaces/AdapterInfo.md)[]

___

### getAllAdapters

▸ **getAllAdapters**(): [`AdapterInfo`](../interfaces/AdapterInfo.md)[]

provides the list of all adapters (to be used by the DeviceRideService)

#### Returns

[`AdapterInfo`](../interfaces/AdapterInfo.md)[]

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

### getSelectedDevices

▸ **getSelectedDevices**(`capability?`): { `capability`: `IncyclistCapability` ; `selected?`: `string`  }[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `capability?` | `IncyclistCapability` |

#### Returns

{ `capability`: `IncyclistCapability` ; `selected?`: `string`  }[]

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

### isInterfaceEnabled

▸ **isInterfaceEnabled**(`ifName`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifName` | `string` |

#### Returns

`boolean`

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

### disableInterface

▸ **disableInterface**(`ifName`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifName` | `string` |

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

### emitInterfaceChanged

▸ **emitInterfaceChanged**(`ifName`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifName` | `string` |

#### Returns

`void`

___

### emitDeviceDeleted

▸ **emitDeviceDeleted**(`settings`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `settings` | [`IncyclistDeviceSettings`](../README.md#incyclistdevicesettings) |

#### Returns

`void`

___

### getInstance

▸ `Static` **getInstance**(): [`DeviceConfigurationService`](DeviceConfigurationService.md)

#### Returns

[`DeviceConfigurationService`](DeviceConfigurationService.md)

## Events

### select

▸ **select**(`udid`, `capability`, `props?`): `void`

Marks a device as selected for a given capability

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `udid` | `string` | The unique device id of the device |
| `capability` | [`ExtendedIncyclistCapability`](../README.md#extendedincyclistcapability) | The cability for which the device should be marked as selected device-changed in case the settings were changed device-added in case the device was not yet known |
| `props?` | `Object` | - |
| `props.noRecursive?` | `boolean` | - |
| `props.legacy?` | `boolean` | - |

#### Returns

`void`
