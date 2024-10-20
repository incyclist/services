[incyclist-services - v1.2.2](../README.md) / ActivitiesRepository

# Class: ActivitiesRepository

This class is used to load Activities from the local database

The local database is stored in  in %AppDir%/activities and contains a couple of files:
- a simple JSON file (db.json), which contains an overview of all Activities, represented in an array of [[ActivitySummary]] 
- For every activity in the db.json, one JSON file (identified by _fileName_), which contains the details of that activity [[ActivityDetails]] 
- For every activity  in the db.json, one FIT file (identified by _fitFileName_), which contains an export of the actvity in FIT file format
- For every activity  in the db.json, one TCX file (identified by _tcxFileName_), which contains an export of the actvity in TCX file format
 
in order to avoid concurrent usages, the class implements the Singleton pattern

## Table of contents

### Constructors

- [constructor](ActivitiesRepository.md#constructor)

### Methods

- [load](ActivitiesRepository.md#load)
- [stopLoad](ActivitiesRepository.md#stopload)
- [save](ActivitiesRepository.md#save)
- [getFilename](ActivitiesRepository.md#getfilename)
- [delete](ActivitiesRepository.md#delete)
- [get](ActivitiesRepository.md#get)
- [getAll](ActivitiesRepository.md#getall)
- [getWithDetails](ActivitiesRepository.md#getwithdetails)
- [search](ActivitiesRepository.md#search)

## Constructors

### constructor

• **new ActivitiesRepository**(): [`ActivitiesRepository`](ActivitiesRepository.md)

#### Returns

[`ActivitiesRepository`](ActivitiesRepository.md)

## Methods

### load

▸ **load**(): `Observer`

Loads the Activities from Repo

This will initially only load the summary data, as this will be in most cases sufficient

#### Returns

`Observer`

An observer that will signal any new/updated activity and when the loading is completed

___

### stopLoad

▸ **stopLoad**(): `void`

Stops the ongoing loading process

#### Returns

`void`

___

### save

▸ **save**(`activity`, `writeDetails?`): `Promise`\<`void`\>

Saves an activity in the local repo

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `activity` | [`ActivityInfo`](../README.md#activityinfo) | `undefined` | The activity that should be saved |
| `writeDetails?` | `boolean` | `true` | indicates if only the summary should be update or if also the details shoudl be saved |

#### Returns

`Promise`\<`void`\>

___

### getFilename

▸ **getFilename**(`activityName`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `activityName` | `string` |

#### Returns

`string`

___

### delete

▸ **delete**(`activity`): `Promise`\<`void`\>

Deletes an activity from the local repo

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `activity` | `string` \| [`ActivityInfo`](../README.md#activityinfo) | The activity that should be deleted. The activity can be either provided as object ([[ActivityInfo]]) or just by its ID |

#### Returns

`Promise`\<`void`\>

___

### get

▸ **get**(`id`): [`ActivityInfo`](../README.md#activityinfo)

gets the Activity from repo

It returns the [[ActivityInfo]] object of this activity.
In case the details haven't been loaded yet, details will not be provided

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `string` | the unique ID od the activity |

#### Returns

[`ActivityInfo`](../README.md#activityinfo)

the ActivityInfo, which contains the summary and if already available the details

___

### getAll

▸ **getAll**(): [`ActivityInfo`](../README.md#activityinfo)[]

gets all Activities from repo

#### Returns

[`ActivityInfo`](../README.md#activityinfo)[]

the ActivityInfo of all the activities

___

### getWithDetails

▸ **getWithDetails**(`id`): `Promise`\<[`ActivityInfo`](../README.md#activityinfo)\>

gets the Activity from repo

It returns the [[ActivityInfo]] object of this activity.
In case the details haven't been loaded yet, it will load the details from repo and add it to the result

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `id` | `string` | the unique ID od the activity |

#### Returns

`Promise`\<[`ActivityInfo`](../README.md#activityinfo)\>

the ActivityInfo, which contains the summary and details

___

### search

▸ **search**(`criteria`): [`ActivityInfo`](../README.md#activityinfo)[]

searches the repo for activities that are matching certain criteria

If multiple criterias are provided, the will be combined with __AND__, i.e. all criteria need to match

The following criteria can be provided
- routeId: returns all activities for a given route
- startPos: return all activities with a given start position (typically used together with routeId)
- realityFactor: return all activities with a given reality factor (typically used together with routeId)
- uploadStatus: can be used to identify routes that have not yet been synced with third party app(s)
- isSaved: can be used to identified routes that were not saved yet ( as FIT/TCX)

#### Parameters

| Name | Type |
| :------ | :------ |
| `criteria` | [`ActivitySearchCriteria`](../interfaces/ActivitySearchCriteria.md) |

#### Returns

[`ActivityInfo`](../README.md#activityinfo)[]

the ActivityInfo of the activities that match all given criteria
