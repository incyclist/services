incyclist-services - v1.0.4

# incyclist-services - v1.0.4

## Table of contents

### Classes

- [DeviceAccessService](classes/DeviceAccessService.md)
- [DeviceConfigurationService](classes/DeviceConfigurationService.md)
- [DeviceRideService](classes/DeviceRideService.md)
- [UserSettingsBinding](classes/UserSettingsBinding.md)
- [UserSettingsService](classes/UserSettingsService.md)

### Interfaces

- [AdapterInfo](interfaces/AdapterInfo.md)
- [AdapterRideInfo](interfaces/AdapterRideInfo.md)
- [CapabilityInformation](interfaces/CapabilityInformation.md)
- [DeviceConfigurationInfo](interfaces/DeviceConfigurationInfo.md)
- [DeviceConfigurationSettings](interfaces/DeviceConfigurationSettings.md)
- [DeviceInformation](interfaces/DeviceInformation.md)
- [DeviceListEntry](interfaces/DeviceListEntry.md)
- [DeviceModeInfo](interfaces/DeviceModeInfo.md)
- [IUserSettingsBinding](interfaces/IUserSettingsBinding.md)
- [IncyclistModeSettings](interfaces/IncyclistModeSettings.md)
- [InterfaceAccessProps](interfaces/InterfaceAccessProps.md)
- [InterfaceInfo](interfaces/InterfaceInfo.md)
- [InterfaceList](interfaces/InterfaceList.md)
- [InterfaceSetting](interfaces/InterfaceSetting.md)
- [LegacyAntSettings](interfaces/LegacyAntSettings.md)
- [LegacyDeviceConnectionSettings](interfaces/LegacyDeviceConnectionSettings.md)
- [LegacyDeviceSelectionSettings](interfaces/LegacyDeviceSelectionSettings.md)
- [LegacyGearSetting](interfaces/LegacyGearSetting.md)
- [LegacyModeSettings](interfaces/LegacyModeSettings.md)
- [LegacyPreferences](interfaces/LegacyPreferences.md)
- [LegacySerialPortInfo](interfaces/LegacySerialPortInfo.md)
- [LegacySerialSettings](interfaces/LegacySerialSettings.md)
- [LegacySettings](interfaces/LegacySettings.md)
- [ModeListEntry](interfaces/ModeListEntry.md)
- [Point](interfaces/Point.md)
- [PreparedRoute](interfaces/PreparedRoute.md)
- [RideServiceCheckFilter](interfaces/RideServiceCheckFilter.md)
- [RideServiceDeviceProperties](interfaces/RideServiceDeviceProperties.md)
- [ScanFilter](interfaces/ScanFilter.md)

### Type Aliases

- [CapabilitySetting](README.md#capabilitysetting)
- [ExtendedIncyclistCapability](README.md#extendedincyclistcapability)
- [IncyclistDeviceSettings](README.md#incyclistdevicesettings)
- [InterfaceState](README.md#interfacestate)
- [ScanState](README.md#scanstate)

### Functions

- [getLegacyInterface](README.md#getlegacyinterface)
- [initUserSettings](README.md#initusersettings)
- [useDeviceAccess](README.md#usedeviceaccess)
- [useDeviceConfiguration](README.md#usedeviceconfiguration)
- [useDeviceRide](README.md#usedeviceride)
- [useUserSettings](README.md#useusersettings)

## Type Aliases

### CapabilitySetting

Ƭ **CapabilitySetting**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `capability` | [`ExtendedIncyclistCapability`](README.md#extendedincyclistcapability) |
| `devices` | `string`[] |
| `disabled?` | `boolean` |
| `selected` | `string` \| `undefined` |

___

### ExtendedIncyclistCapability

Ƭ **ExtendedIncyclistCapability**: `IncyclistCapability` \| ``"bike"``

___

### IncyclistDeviceSettings

Ƭ **IncyclistDeviceSettings**: `SerialDeviceSettings` \| `AntDeviceSettings` \| `BleDeviceSettings`

___

### InterfaceState

Ƭ **InterfaceState**: ``"connected"`` \| ``"disconnected"`` \| ``"unknown"`` \| ``"connecting"`` \| ``"disconnecting"`` \| ``"unavailable"``

___

### ScanState

Ƭ **ScanState**: ``"start-requested"`` \| ``"started"`` \| ``"stop-requested"`` \| ``"stopped"`` \| ``"idle"``

## Functions

### getLegacyInterface

▸ **getLegacyInterface**(`d`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `d` | `IncyclistDeviceAdapter` |

#### Returns

`string`

___

### initUserSettings

▸ **initUserSettings**(`binding`): [`UserSettingsService`](classes/UserSettingsService.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `binding` | [`IUserSettingsBinding`](interfaces/IUserSettingsBinding.md) |

#### Returns

[`UserSettingsService`](classes/UserSettingsService.md)

___

### useDeviceAccess

▸ **useDeviceAccess**(): [`DeviceAccessService`](classes/DeviceAccessService.md)

#### Returns

[`DeviceAccessService`](classes/DeviceAccessService.md)

___

### useDeviceConfiguration

▸ **useDeviceConfiguration**(): [`DeviceConfigurationService`](classes/DeviceConfigurationService.md)

#### Returns

[`DeviceConfigurationService`](classes/DeviceConfigurationService.md)

___

### useDeviceRide

▸ **useDeviceRide**(): [`DeviceRideService`](classes/DeviceRideService.md)

#### Returns

[`DeviceRideService`](classes/DeviceRideService.md)

___

### useUserSettings

▸ **useUserSettings**(): [`UserSettingsService`](classes/UserSettingsService.md)

#### Returns

[`UserSettingsService`](classes/UserSettingsService.md)
