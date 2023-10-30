incyclist-services

# incyclist-services - v1.0.36

## Table of contents

### Classes

- [DeviceAccessService](classes/DeviceAccessService.md)
- [DeviceConfigurationService](classes/DeviceConfigurationService.md)
- [DevicePairingService](classes/DevicePairingService.md)
- [DeviceRideService](classes/DeviceRideService.md)
- [UserSettingsBinding](classes/UserSettingsBinding.md)
- [UserSettingsService](classes/UserSettingsService.md)

### Interfaces

- [InterfaceInfo](interfaces/InterfaceInfo.md)
- [InterfaceAccessProps](interfaces/InterfaceAccessProps.md)
- [InterfaceList](interfaces/InterfaceList.md)
- [EnrichedInterfaceSetting](interfaces/EnrichedInterfaceSetting.md)
- [ScanFilter](interfaces/ScanFilter.md)
- [ScanForNewFilter](interfaces/ScanForNewFilter.md)
- [DeviceInformation](interfaces/DeviceInformation.md)
- [CapabilityInformation](interfaces/CapabilityInformation.md)
- [DeviceConfigurationInfo](interfaces/DeviceConfigurationInfo.md)
- [DeviceListEntry](interfaces/DeviceListEntry.md)
- [InterfaceSetting](interfaces/InterfaceSetting.md)
- [ModeListEntry](interfaces/ModeListEntry.md)
- [DeviceConfigurationSettings](interfaces/DeviceConfigurationSettings.md)
- [LegacyGearSetting](interfaces/LegacyGearSetting.md)
- [LegacyDeviceSelectionSettings](interfaces/LegacyDeviceSelectionSettings.md)
- [LegacySerialPortInfo](interfaces/LegacySerialPortInfo.md)
- [LegacySerialSettings](interfaces/LegacySerialSettings.md)
- [LegacyAntSettings](interfaces/LegacyAntSettings.md)
- [LegacyDeviceConnectionSettings](interfaces/LegacyDeviceConnectionSettings.md)
- [IncyclistModeSettings](interfaces/IncyclistModeSettings.md)
- [LegacyModeSettings](interfaces/LegacyModeSettings.md)
- [LegacyPreferences](interfaces/LegacyPreferences.md)
- [LegacySettings](interfaces/LegacySettings.md)
- [AdapterInfo](interfaces/AdapterInfo.md)
- [DeviceModeInfo](interfaces/DeviceModeInfo.md)
- [DevicePairingData](interfaces/DevicePairingData.md)
- [CapabilityData](interfaces/CapabilityData.md)
- [PairingData](interfaces/PairingData.md)
- [PairingProps](interfaces/PairingProps.md)
- [PairingInfo](interfaces/PairingInfo.md)
- [PairingState](interfaces/PairingState.md)
- [DeviceSelectState](interfaces/DeviceSelectState.md)
- [PairingSettings](interfaces/PairingSettings.md)
- [Services](interfaces/Services.md)
- [AdapterRideInfo](interfaces/AdapterRideInfo.md)
- [AdapterStateInfo](interfaces/AdapterStateInfo.md)
- [RideServiceDeviceProperties](interfaces/RideServiceDeviceProperties.md)
- [RideServiceCheckFilter](interfaces/RideServiceCheckFilter.md)
- [Point](interfaces/Point.md)
- [PreparedRoute](interfaces/PreparedRoute.md)
- [IUserSettingsBinding](interfaces/IUserSettingsBinding.md)

### Type Aliases

- [InterfaceState](README.md#interfacestate)
- [ScanState](README.md#scanstate)
- [ExtendedIncyclistCapability](README.md#extendedincyclistcapability)
- [IncyclistDeviceSettings](README.md#incyclistdevicesettings)
- [CapabilitySetting](README.md#capabilitysetting)
- [DevicePairingStatus](README.md#devicepairingstatus)

### Functions

- [useDeviceAccess](README.md#usedeviceaccess)
- [useDeviceConfiguration](README.md#usedeviceconfiguration)
- [mappedCapability](README.md#mappedcapability)
- [mappedCapabilities](README.md#mappedcapabilities)
- [useDevicePairing](README.md#usedevicepairing)
- [useDeviceRide](README.md#usedeviceride)
- [useUserSettings](README.md#useusersettings)
- [initUserSettings](README.md#initusersettings)
- [getLegacyInterface](README.md#getlegacyinterface)

## Type Aliases

### InterfaceState

Ƭ **InterfaceState**: ``"connected"`` \| ``"disconnected"`` \| ``"unknown"`` \| ``"connecting"`` \| ``"disconnecting"`` \| ``"unavailable"``

___

### ScanState

Ƭ **ScanState**: ``"start-requested"`` \| ``"started"`` \| ``"stop-requested"`` \| ``"stopped"`` \| ``"idle"``

___

### ExtendedIncyclistCapability

Ƭ **ExtendedIncyclistCapability**: `IncyclistCapability` \| ``"bike"``

___

### IncyclistDeviceSettings

Ƭ **IncyclistDeviceSettings**: `SerialDeviceSettings` \| `AntDeviceSettings` \| `BleDeviceSettings`

___

### CapabilitySetting

Ƭ **CapabilitySetting**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `selected` | `string` \| `undefined` |
| `capability` | [`ExtendedIncyclistCapability`](README.md#extendedincyclistcapability) |
| `disabled?` | `boolean` |
| `devices` | `string`[] |

___

### DevicePairingStatus

Ƭ **DevicePairingStatus**: ``"connecting"`` \| ``"connected"`` \| ``"failed"`` \| ``"waiting"`` \| ``"paused"``

## Functions

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

### mappedCapability

▸ **mappedCapability**(`c`): [`CapabilityData`](interfaces/CapabilityData.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `c` | [`CapabilityInformation`](interfaces/CapabilityInformation.md) |

#### Returns

[`CapabilityData`](interfaces/CapabilityData.md)

___

### mappedCapabilities

▸ **mappedCapabilities**(`capabilities`): [`CapabilityData`](interfaces/CapabilityData.md)[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `capabilities` | [`DeviceConfigurationInfo`](interfaces/DeviceConfigurationInfo.md) |

#### Returns

[`CapabilityData`](interfaces/CapabilityData.md)[]

___

### useDevicePairing

▸ **useDevicePairing**(): [`DevicePairingService`](classes/DevicePairingService.md)

#### Returns

[`DevicePairingService`](classes/DevicePairingService.md)

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

### getLegacyInterface

▸ **getLegacyInterface**(`d`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `d` | `IncyclistDeviceAdapter` |

#### Returns

`string`
