incyclist-services

# incyclist-services - v1.1.98

## Table of contents

### Namespaces

- [geo](modules/geo.md)
- [math](modules/math.md)

### Classes

- [IncyclistBindings](classes/IncyclistBindings.md)
- [OverpassApi](classes/OverpassApi.md)
- [path](classes/path.md)
- [JsonRepository](classes/JsonRepository.md)
- [AbstractJsonRepositoryBinding](classes/AbstractJsonRepositoryBinding.md)
- [ApiClient](classes/ApiClient.md)
- [Coach](classes/Coach.md)
- [CoachesService](classes/CoachesService.md)
- [DeviceAccessService](classes/DeviceAccessService.md)
- [DeviceConfigurationService](classes/DeviceConfigurationService.md)
- [DevicePairingService](classes/DevicePairingService.md)
- [DeviceRideService](classes/DeviceRideService.md)
- [RouteListService](classes/RouteListService.md)
- [UserSettingsBinding](classes/UserSettingsBinding.md)
- [UserSettingsService](classes/UserSettingsService.md)
- [Segment](classes/Segment.md)
- [Step](classes/Step.md)
- [Workout](classes/Workout.md)
- [Plan](classes/Plan.md)
- [WorkoutCard](classes/WorkoutCard.md)
- [WorkoutImportCard](classes/WorkoutImportCard.md)
- [WorkoutListService](classes/WorkoutListService.md)
- [WorkoutRide](classes/WorkoutRide.md)

### Interfaces

- [IPathBinding](interfaces/IPathBinding.md)
- [IJsonRepositoryBinding](interfaces/IJsonRepositoryBinding.md)
- [FileLoaderError](interfaces/FileLoaderError.md)
- [FileLoaderResult](interfaces/FileLoaderResult.md)
- [FileInfo](interfaces/FileInfo.md)
- [IFileLoader](interfaces/IFileLoader.md)
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
- [PairingState](interfaces/PairingState.md)
- [DeleteListEntry](interfaces/DeleteListEntry.md)
- [InternalPairingState](interfaces/InternalPairingState.md)
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
- [PowerLimit](interfaces/PowerLimit.md)
- [StepDefinition](interfaces/StepDefinition.md)
- [CurrentStep](interfaces/CurrentStep.md)
- [SegmentDefinition](interfaces/SegmentDefinition.md)
- [Category](interfaces/Category.md)
- [WorkoutDefinition](interfaces/WorkoutDefinition.md)
- [ScheduledWorkout](interfaces/ScheduledWorkout.md)
- [PlanDefinition](interfaces/PlanDefinition.md)
- [WorkoutImportProps](interfaces/WorkoutImportProps.md)
- [ActiveImportProps](interfaces/ActiveImportProps.md)
- [WorkoutSettings](interfaces/WorkoutSettings.md)
- [WorkoutSettingsDisplayProps](interfaces/WorkoutSettingsDisplayProps.md)
- [WorkoutCardDisplayProperties](interfaces/WorkoutCardDisplayProperties.md)
- [WorkoutRequest](interfaces/WorkoutRequest.md)
- [ActiveWorkoutLimit](interfaces/ActiveWorkoutLimit.md)
- [WorkoutDisplayProperties](interfaces/WorkoutDisplayProperties.md)

### Type Aliases

- [JSONObject](README.md#jsonobject)
- [JsonAccess](README.md#jsonaccess)
- [AppChannel](README.md#appchannel)
- [ApiClientInitProps](README.md#apiclientinitprops)
- [CoachType](README.md#coachtype)
- [CoachSettings](README.md#coachsettings)
- [CoachEditProps](README.md#coacheditprops)
- [CoachStatus](README.md#coachstatus)
- [InterfaceState](README.md#interfacestate)
- [ScanState](README.md#scanstate)
- [ExtendedIncyclistCapability](README.md#extendedincyclistcapability)
- [IncyclistDeviceSettings](README.md#incyclistdevicesettings)
- [CapabilitySetting](README.md#capabilitysetting)
- [DevicePairingStatus](README.md#devicepairingstatus)
- [HealthStatus](README.md#healthstatus)
- [Limit](README.md#limit)
- [PowerLimitType](README.md#powerlimittype)
- [DataType](README.md#datatype)
- [WorkoutCardType](README.md#workoutcardtype)

### Variables

- [OVERPASS\_URL\_DEFAULT](README.md#overpass_url_default)
- [STEP\_TYPE](README.md#step_type)
- [POWER\_TYPE](README.md#power_type)
- [DEFAULT\_TITLE](README.md#default_title)
- [DEFAULT\_FILTERS](README.md#default_filters)

### Functions

- [getBindings](README.md#getbindings)
- [useOverpassApi](README.md#useoverpassapi)
- [getCoachesService](README.md#getcoachesservice)
- [useDeviceAccess](README.md#usedeviceaccess)
- [useDeviceConfiguration](README.md#usedeviceconfiguration)
- [useDevicePairing](README.md#usedevicepairing)
- [useDeviceRide](README.md#usedeviceride)
- [useRouteList](README.md#useroutelist)
- [getRouteList](README.md#getroutelist)
- [useUserSettings](README.md#useusersettings)
- [initUserSettings](README.md#initusersettings)
- [getLegacyInterface](README.md#getlegacyinterface)
- [waitNextTick](README.md#waitnexttick)
- [useWorkoutList](README.md#useworkoutlist)
- [getWorkoutList](README.md#getworkoutlist)
- [useWorkoutRide](README.md#useworkoutride)
- [getWorkoutRide](README.md#getworkoutride)

## Type Aliases

### JSONObject

Ƭ **JSONObject**: `string` \| `number` \| `boolean` \| \{ `[x: string]`: [`JSONObject`](README.md#jsonobject);  } \| [`JSONObject`](README.md#jsonobject)[]

___

### JsonAccess

Ƭ **JsonAccess**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `read` | (`resourceName`: `string`) => `Promise`\<[`JSONObject`](README.md#jsonobject)\> |
| `write` | (`resourceName`: `string`, `data`: [`JSONObject`](README.md#jsonobject)) => `Promise`\<`boolean`\> |
| `delete` | (`resourceName`: `string`) => `Promise`\<`boolean`\> |

___

### AppChannel

Ƭ **AppChannel**: ``"desktop"`` \| ``"mobile"`` \| ``"web"`` \| ``"tv"`` \| ``"backend"``

___

### ApiClientInitProps

Ƭ **ApiClientInitProps**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `uuid` | `string` |
| `apiKey` | `string` |
| `version` | `string` |
| `appVersion` | `string` |
| `requestLog?` | `boolean` |
| `channel?` | [`AppChannel`](README.md#appchannel) |

___

### CoachType

Ƭ **CoachType**: ``"speed"`` \| ``"power"``

___

### CoachSettings

Ƭ **CoachSettings**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `type` | [`CoachType`](README.md#coachtype) |
| `target` | `number` |
| `lead?` | `number` |

___

### CoachEditProps

Ƭ **CoachEditProps**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `name` | `string` |
| `type` | `string` |
| `power?` | `number` |
| `speed?` | `number` |
| `lead?` | `number` |

___

### CoachStatus

Ƭ **CoachStatus**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `routePosition?` | `number` |
| `riderPosition?` | `number` |
| `speed?` | `number` |
| `power?` | `number` |
| `name` | `string` |
| `avatar` | `string` |
| `lat?` | `number` |
| `lng?` | `number` |

___

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

___

### HealthStatus

Ƭ **HealthStatus**: ``"green"`` \| ``"amber"`` \| ``"red"``

___

### Limit

Ƭ **Limit**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `min?` | `number` | minimum value |
| `max?` | `number` | maximum value |

___

### PowerLimitType

Ƭ **PowerLimitType**: ``"watt"`` \| ``"pct of FTP"``

___

### DataType

Ƭ **DataType**: ``"step"`` \| ``"segment"`` \| ``"workout"`` \| ``"plan"``

___

### WorkoutCardType

Ƭ **WorkoutCardType**: ``"WorkoutImport"`` \| ``"Workout"`` \| ``"ActiveWorkoutImport"``

## Variables

### OVERPASS\_URL\_DEFAULT

• `Const` **OVERPASS\_URL\_DEFAULT**: `string`

___

### STEP\_TYPE

• `Const` **STEP\_TYPE**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `STEP` | `string` |
| `SEGMENT` | `string` |

___

### POWER\_TYPE

• `Const` **POWER\_TYPE**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `WATT` | `string` |
| `PCT` | `string` |

___

### DEFAULT\_TITLE

• `Const` **DEFAULT\_TITLE**: ``"Import Workout"``

___

### DEFAULT\_FILTERS

• `Const` **DEFAULT\_FILTERS**: \{ `name`: `string` = 'Workouts'; `extensions`: `string`[]  }[]

## Functions

### getBindings

▸ **getBindings**(): [`IncyclistBindings`](classes/IncyclistBindings.md)

#### Returns

[`IncyclistBindings`](classes/IncyclistBindings.md)

___

### useOverpassApi

▸ **useOverpassApi**(): [`OverpassApi`](classes/OverpassApi.md)

#### Returns

[`OverpassApi`](classes/OverpassApi.md)

___

### getCoachesService

▸ **getCoachesService**(): [`CoachesService`](classes/CoachesService.md)

#### Returns

[`CoachesService`](classes/CoachesService.md)

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

### useRouteList

▸ **useRouteList**(): [`RouteListService`](classes/RouteListService.md)

#### Returns

[`RouteListService`](classes/RouteListService.md)

___

### getRouteList

▸ **getRouteList**(): [`RouteListService`](classes/RouteListService.md)

#### Returns

[`RouteListService`](classes/RouteListService.md)

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

___

### waitNextTick

▸ **waitNextTick**(): `Promise`\<`void`\>

pauses the execution until the event queue has been processed

#### Returns

`Promise`\<`void`\>

___

### useWorkoutList

▸ **useWorkoutList**(): [`WorkoutListService`](classes/WorkoutListService.md)

#### Returns

[`WorkoutListService`](classes/WorkoutListService.md)

___

### getWorkoutList

▸ **getWorkoutList**(): [`WorkoutListService`](classes/WorkoutListService.md)

#### Returns

[`WorkoutListService`](classes/WorkoutListService.md)

___

### useWorkoutRide

▸ **useWorkoutRide**(): [`WorkoutRide`](classes/WorkoutRide.md)

#### Returns

[`WorkoutRide`](classes/WorkoutRide.md)

___

### getWorkoutRide

▸ **getWorkoutRide**(): [`WorkoutRide`](classes/WorkoutRide.md)

#### Returns

[`WorkoutRide`](classes/WorkoutRide.md)
