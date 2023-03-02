[incyclist-services - v1.0.0-beta.1](../README.md) / DeviceConfigurationService

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
- [disableInterface](DeviceConfigurationService.md#disableinterface)
- [enableInterface](DeviceConfigurationService.md#enableinterface)
- [getCapabilityInfo](DeviceConfigurationService.md#getcapabilityinfo)
- [getSelected](DeviceConfigurationService.md#getselected)
- [init](DeviceConfigurationService.md#init)
- [initFromLegacy](DeviceConfigurationService.md#initfromlegacy)
- [isInitialized](DeviceConfigurationService.md#isinitialized)
- [isInterfaceEnabled](DeviceConfigurationService.md#isinterfaceenabled)
- [setInterfaceSettings](DeviceConfigurationService.md#setinterfacesettings)
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

• **settings**: `DeviceConfigurationSettings`

___

### userSettings

• **userSettings**: `any`

## Methods

### add

▸ **add**(`device`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `device` | `IncyclistDeviceAdapter` \| `IncyclistDeviceSettings` |

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

▸ **delete**(`device`, `capability?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `device` | `IncyclistDeviceAdapter` \| `IncyclistDeviceSettings` |
| `capability?` | `IncyclistCapability` \| ``"bike"`` |

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

### enableInterface

▸ **enableInterface**(`ifName`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifName` | `string` |

#### Returns

`void`

___

### getCapabilityInfo

▸ **getCapabilityInfo**(`capability`): `CapabilityListDetails`

#### Parameters

| Name | Type |
| :------ | :------ |
| `capability` | `IncyclistCapability` \| ``"bike"`` |

#### Returns

`CapabilityListDetails`

___

### getSelected

▸ **getSelected**(`capability`): `IncyclistDeviceAdapter`

#### Parameters

| Name | Type |
| :------ | :------ |
| `capability` | `IncyclistCapability` \| ``"bike"`` |

#### Returns

`IncyclistDeviceAdapter`

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
| `settings` | `LegacySettings` |

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

### setInterfaceSettings

▸ **setInterfaceSettings**(`ifName`, `settings`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifName` | `any` |
| `settings` | `InterfaceSetting` |

#### Returns

`void`

___

### unselect

▸ **unselect**(`capability`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `capability` | `IncyclistCapability` \| ``"bike"`` |

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

▸ **select**(`device`, `capability`): `void`

Marks a device as selected for a given capability

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `device` | `IncyclistDeviceAdapter` \| `IncyclistDeviceSettings` | The device (either specified by the adapter or via the DeviceSettings) |
| `capability` | `IncyclistCapability` \| ``"bike"`` | The cability for which the device should be marked as selected device-changed in case the settings were changed device-added in case the device was not yet known |

#### Returns

`void`
