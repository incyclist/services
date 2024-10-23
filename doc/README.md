incyclist-services

# incyclist-services - v1.2.2

## Table of contents

### Namespaces

- [geo](modules/geo.md)
- [math](modules/math.md)

### Classes

- [IncyclistFitConvertApi](classes/IncyclistFitConvertApi.md)
- [ActivityConverter](classes/ActivityConverter.md)
- [ActivityConverterFactory](classes/ActivityConverterFactory.md)
- [RemoteFitConverter](classes/RemoteFitConverter.md)
- [TcxConverter](classes/TcxConverter.md)
- [ActivitiesRepository](classes/ActivitiesRepository.md)
- [ActivityListService](classes/ActivityListService.md)
- [ActivityRideService](classes/ActivityRideService.md)
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

- [ActivityDetails](interfaces/ActivityDetails.md)
- [ActivitySearchCriteria](interfaces/ActivitySearchCriteria.md)
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

- [ActivityUser](README.md#activityuser)
- [ActivityRoute](README.md#activityroute)
- [ActivityStatsRecord](README.md#activitystatsrecord)
- [ActivityStats](README.md#activitystats)
- [StravaAppLink](README.md#stravaapplink)
- [ActivityAppLinks](README.md#activityapplinks)
- [ScreenShotInfo](README.md#screenshotinfo)
- [ActivityType](README.md#activitytype)
- [UploadStatus](README.md#uploadstatus)
- [UploadInfo](README.md#uploadinfo)
- [ActivityDB](README.md#activitydb)
- [ActivitySummary](README.md#activitysummary)
- [LapSummary](README.md#lapsummary)
- [ActivityRouteType](README.md#activityroutetype)
- [FitLogEntry](README.md#fitlogentry)
- [FitLapEntry](README.md#fitlapentry)
- [FitUser](README.md#fituser)
- [FitScreenshots](README.md#fitscreenshots)
- [FitExportActivity](README.md#fitexportactivity)
- [ActivityLogRecord](README.md#activitylogrecord)
- [ActivityInfo](README.md#activityinfo)
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

- [DB\_VERSION](README.md#db_version)
- [OVERPASS\_URL\_DEFAULT](README.md#overpass_url_default)
- [STEP\_TYPE](README.md#step_type)
- [POWER\_TYPE](README.md#power_type)
- [DEFAULT\_TITLE](README.md#default_title)
- [DEFAULT\_FILTERS](README.md#default_filters)

### Functions

- [buildSummary](README.md#buildsummary)
- [useActivityList](README.md#useactivitylist)
- [getActivityList](README.md#getactivitylist)
- [useActivityRide](README.md#useactivityride)
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
- [formatDateTime](README.md#formatdatetime)
- [formatTime](README.md#formattime)
- [formatNumber](README.md#formatnumber)
- [pad](README.md#pad)
- [trimTrailingChars](README.md#trimtrailingchars)
- [getLegacyInterface](README.md#getlegacyinterface)
- [waitNextTick](README.md#waitnexttick)
- [useWorkoutList](README.md#useworkoutlist)
- [getWorkoutList](README.md#getworkoutlist)
- [useWorkoutRide](README.md#useworkoutride)
- [getWorkoutRide](README.md#getworkoutride)

## Type Aliases

### ActivityUser

Ƭ **ActivityUser**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `uuid?` | `string` |
| `weight` | `number` |
| `ftp?` | `number` |

___

### ActivityRoute

Ƭ **ActivityRoute**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id?` | `string` |
| `hash` | `string` |
| `name` | `string` |

___

### ActivityStatsRecord

Ƭ **ActivityStatsRecord**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `min` | `number` |
| `max` | `number` |
| `avg` | `number` |
| `cntVal` | `number` |
| `sum` | `number` |
| `minAllowed?` | `number` |
| `weighted?` | `number` |

___

### ActivityStats

Ƭ **ActivityStats**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `hrm?` | [`ActivityStatsRecord`](README.md#activitystatsrecord) |
| `cadence?` | [`ActivityStatsRecord`](README.md#activitystatsrecord) |
| `speed` | [`ActivityStatsRecord`](README.md#activitystatsrecord) |
| `slope?` | [`ActivityStatsRecord`](README.md#activitystatsrecord) |
| `power` | [`ActivityStatsRecord`](README.md#activitystatsrecord) |
| `powerCurve?` | `Record`\<`string`, `number`\> |

___

### StravaAppLink

Ƭ **StravaAppLink**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `upload_id` | `number` |
| `activity_id` | `number` |

___

### ActivityAppLinks

Ƭ **ActivityAppLinks**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `strava?` | [`StravaAppLink`](README.md#stravaapplink) |

___

### ScreenShotInfo

Ƭ **ScreenShotInfo**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `fileName` | `string` |
| `position` | `RoutePoint` |
| `isHighlight?` | `boolean` |

___

### ActivityType

Ƭ **ActivityType**: ``"IncyclistActivity"``

___

### UploadStatus

Ƭ **UploadStatus**: ``"success"`` \| ``"failure"``

___

### UploadInfo

Ƭ **UploadInfo**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `service` | `string` |
| `status` | [`UploadStatus`](README.md#uploadstatus) |

___

### ActivityDB

Ƭ **ActivityDB**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `version` | `string` | a version string, so that code in the future can adapt to legacy database versions |
| `activities` | [`ActivitySummary`](README.md#activitysummary)[] | the list of activities |
| `isComplete` | `boolean` | identifies of a full directory scan has been completed when creating this DB |

___

### ActivitySummary

Ƭ **ActivitySummary**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `string` | unique ID |
| `title` | `string` | Title as displayed |
| `name` | `string` | filename (without full path) |
| `routeId` | `string` | unique id of route (or "free ride") |
| `previewImage?` | `string` | - |
| `startTime` | `number` | - |
| `rideTime` | `number` | - |
| `distance` | `number` | - |
| `startPos` | `number` | - |
| `realityFactor` | `number` | - |
| `uploadStatus` | [`UploadInfo`](README.md#uploadinfo)[] | - |
| `isCompleted?` | `boolean` | - |
| `isSaved?` | `boolean` | - |
| `saveRideTime?` | `number` | - |
| `laps?` | [`LapSummary`](README.md#lapsummary)[] | - |

___

### LapSummary

Ƭ **LapSummary**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `num` | `number` |
| `startPos` | `number` |
| `distance` | `number` |
| `startTime` | `number` |
| `rideTime` | `number` |

___

### ActivityRouteType

Ƭ **ActivityRouteType**: ``"Free-Ride"`` \| ``"GPX"`` \| ``"Video"``

___

### FitLogEntry

Ƭ **FitLogEntry**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `time?` | `number` |
| `lat?` | `number` |
| `lon?` | `number` |
| `speed?` | `number` |
| `slope?` | `number` |
| `cadence?` | `number` |
| `heartrate?` | `number` |
| `distance?` | `number` |
| `power?` | `number` |
| `elevation?` | `number` |

___

### FitLapEntry

Ƭ **FitLapEntry**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `lapNo` | `number` |
| `startTime` | `string` |
| `stopTime` | `string` |
| `totalDistance` | `number` |
| `lapDistance` | `number` |
| `totalTime` | `number` |
| `lapTime` | `number` |

___

### FitUser

Ƭ **FitUser**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `weight` | `number` |

___

### FitScreenshots

Ƭ **FitScreenshots**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `fileName` | `string` |
| `position` | [`FitLogEntry`](README.md#fitlogentry) |

___

### FitExportActivity

Ƭ **FitExportActivity**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `id` | `string` |
| `title` | `string` |
| `status` | `string` |
| `logs` | [`FitLogEntry`](README.md#fitlogentry)[] |
| `laps` | [`FitLapEntry`](README.md#fitlapentry)[] |
| `startTime` | `string` |
| `stopTime?` | `string` |
| `time` | `number` |
| `timeTotal` | `number` |
| `distance` | `number` |
| `timePause` | `number` |
| `href?` | `string` |
| `user` | [`FitUser`](README.md#fituser) |
| `screenshots` | [`FitScreenshots`](README.md#fitscreenshots)[] |

___

### ActivityLogRecord

Ƭ **ActivityLogRecord**: `Object`

#### Type declaration

| Name | Type | Description |
| :------ | :------ | :------ |
| `time` | `number` | time (in s) since start |
| `timeDelta` | `number` | time (in s) since prev. log |
| `speed` | `number` | current speed (in km/h) |
| `slope?` | `number` | current slope (in %) |
| `cadence` | `number` | current cadence (in rpm) |
| `heartrate?` | `number` | current heartrate (in bpm) |
| `distance?` | `number` | current distance (in m) since start |
| `power` | `number` | current power (in W) |
| `lat?` | `number` | current latitude |
| `lng?` | `number` | current longitude |
| `elevation?` | `number` | current elevation (in m) |
| `lon?` | `number` | - |

___

### ActivityInfo

Ƭ **ActivityInfo**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `summary` | [`ActivitySummary`](README.md#activitysummary) |
| `details?` | [`ActivityDetails`](interfaces/ActivityDetails.md) |

___

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
| `list` | () => `Promise`\<`string`[]\> |

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

### DB\_VERSION

• `Const` **DB\_VERSION**: ``"1"``

___

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

### buildSummary

▸ **buildSummary**(`activity`, `proposedName?`): [`ActivitySummary`](README.md#activitysummary)

#### Parameters

| Name | Type |
| :------ | :------ |
| `activity` | [`ActivityDetails`](interfaces/ActivityDetails.md) |
| `proposedName?` | `string` |

#### Returns

[`ActivitySummary`](README.md#activitysummary)

___

### useActivityList

▸ **useActivityList**(): [`ActivityListService`](classes/ActivityListService.md)

#### Returns

[`ActivityListService`](classes/ActivityListService.md)

___

### getActivityList

▸ **getActivityList**(): [`ActivityListService`](classes/ActivityListService.md)

#### Returns

[`ActivityListService`](classes/ActivityListService.md)

___

### useActivityRide

▸ **useActivityRide**(): [`ActivityRideService`](classes/ActivityRideService.md)

#### Returns

[`ActivityRideService`](classes/ActivityRideService.md)

___

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

### formatDateTime

▸ **formatDateTime**(`date`, `fstr?`, `utc?`): `string`

Formats a Date object into a string using the specified format string.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `date` | `Date` | `undefined` | The Date object to format. |
| `fstr?` | `string` | `'%Y%m%d%H%M%S'` | The format string. Defaults to '%Y%m%d%H%M%S'. %Y represents year, %m represents month, %d represents day of month, %H is hour, %M is minute, %S is seconds |
| `utc?` | `boolean` | `false` | Indicates whether to use UTC methods for date extraction. Defaults to false. |

#### Returns

`string`

The formatted date string or undefined if the input date is invalid.

___

### formatTime

▸ **formatTime**(`seconds`, `cutMissing`): `string`

Formats a time duration given in seconds into a string in the format "HH:MM:SS" or "MM:SS".

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `seconds` | `number` | The time duration in seconds. |
| `cutMissing` | `boolean` | Indicates whether to cut missing leading hours. |

#### Returns

`string`

The formatted time string or undefined if seconds is undefined or null.

___

### formatNumber

▸ **formatNumber**(`value`, `maxDigits`, `maxLength?`): `string`

Formats a number into a string with a specified maximum number of digits and maximum length.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `value` | `number` | `undefined` | The number to format. |
| `maxDigits` | `number` | `undefined` | The maximum number of digits to include after the decimal point. |
| `maxLength?` | `number` | `-1` | The maximum length of the resulting string. Defaults to -1 (no maximum length). |

#### Returns

`string`

The formatted number string.

___

### pad

▸ **pad**(`value`, `size?`): `string`

Pads a number with leading zeros to ensure it has a minimum specified size.

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `value` | `number` | `undefined` | The number to pad. |
| `size?` | `number` | `2` | The minimum size of the padded number. Defaults to 2. |

#### Returns

`string`

The padded number as a string.

___

### trimTrailingChars

▸ **trimTrailingChars**(`s`, `charToTrim?`): `string`

Removes characters from the end of a string that are trailing an expected final character.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `s` | `string` | The input string. |
| `charToTrim?` | `string` | The expected final character. If not provided, the last character of the input string will be used. |

#### Returns

`string`

The input string with trailing characters removed.

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
