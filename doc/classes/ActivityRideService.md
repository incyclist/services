[incyclist-services - v1.2.2](../README.md) / ActivityRideService

# Class: ActivityRideService

This service is used by the Front-End to manage the state of on ongoing ride (activity),
to implement the business logic to display the content for the dashboard
and to implement the business logic to save and update the current ride in the local activities repo

The ActivityRide Service implements an Observer pattern, were the Observer is created during start
It will then notify potantial consumers about relevant events:

- 'update' - There was an update, which requires the dashboard to be updated
 
- 'started' - The activity has been started
- 'paused' - The activity has been paused
- 'resumed' - The activity has been resumed
- 'completed' - The activity has been completed
- 'saved' - The activity has been saved

__Dashboard__

The dasboard component will typically only register for the updates and completed events to udpate its internal state

**`Example`**

```
const {useActivityRide} = require('incyclist-services');

const service = useActivityRide()

const observer = service.getObserver()
if (observer) {
   observer
     .on('update',(displayProps)=> {console.log(displayProps)})
     .on('completed',()=> {console.log('Activity completed')})
}
```

__Ride Workkflow__

The business logic of the actual ride, will typically initialize this service and then monitor for request updates

**`Example`**

```
const {useActivityRide} = require('incyclist-services');

const service = useActivityRide()

const observer = service.start()
if (observer) {
   observer
     .on('started',()=> {console.log('Activity started')})
     .on('completed',()=> {console.log('Activity completed')})
}
```

## Hierarchy

- `IncyclistService`

  ↳ **`ActivityRideService`**

## Table of contents

### Constructors

- [constructor](ActivityRideService.md#constructor)

### Methods

- [init](ActivityRideService.md#init)
- [start](ActivityRideService.md#start)
- [stop](ActivityRideService.md#stop)
- [pause](ActivityRideService.md#pause)
- [resume](ActivityRideService.md#resume)
- [getDashboardDisplayProperties](ActivityRideService.md#getdashboarddisplayproperties)
- [getActivitySummaryDisplayProperties](ActivityRideService.md#getactivitysummarydisplayproperties)
- [getActivity](ActivityRideService.md#getactivity)
- [save](ActivityRideService.md#save)
- [getObserver](ActivityRideService.md#getobserver)
- [addSceenshot](ActivityRideService.md#addsceenshot)
- [onRouteUpdate](ActivityRideService.md#onrouteupdate)
- [getRideProps](ActivityRideService.md#getrideprops)
- [getBikeInterface](ActivityRideService.md#getbikeinterface)
- [getBike](ActivityRideService.md#getbike)

## Constructors

### constructor

• **new ActivityRideService**(): [`ActivityRideService`](ActivityRideService.md)

#### Returns

[`ActivityRideService`](ActivityRideService.md)

#### Overrides

IncyclistService.constructor

## Methods

### init

▸ **init**(`id?`): `Observer`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id?` | `string` |

#### Returns

`Observer`

___

### start

▸ **start**(): `void`

Starts a new activity

#### Returns

`void`

___

### stop

▸ **stop**(): `void`

#### Returns

`void`

___

### pause

▸ **pause**(`autoResume?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `autoResume` | `boolean` | `false` |

#### Returns

`void`

___

### resume

▸ **resume**(`requester?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `requester` | ``"user"`` \| ``"system"`` | `'user'` |

#### Returns

`void`

___

### getDashboardDisplayProperties

▸ **getDashboardDisplayProperties**(): `any`[]

#### Returns

`any`[]

___

### getActivitySummaryDisplayProperties

▸ **getActivitySummaryDisplayProperties**(): `void`

#### Returns

`void`

___

### getActivity

▸ **getActivity**(): [`ActivityDetails`](../interfaces/ActivityDetails.md)

#### Returns

[`ActivityDetails`](../interfaces/ActivityDetails.md)

___

### save

▸ **save**(): `Promise`\<`void`\>

user requested save: will save the activity and convert into TCX and FIT

#### Returns

`Promise`\<`void`\>

___

### getObserver

▸ **getObserver**(): `Observer`

Provides the Observer

#### Returns

`Observer`

[[Observer]] the current observer or _undefined_ if init() hasn't been called

___

### addSceenshot

▸ **addSceenshot**(`screenshot`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `screenshot` | [`ScreenShotInfo`](../README.md#screenshotinfo) |

#### Returns

`void`

___

### onRouteUpdate

▸ **onRouteUpdate**(`points`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `points` | `RoutePoint`[] |

#### Returns

`void`

___

### getRideProps

▸ **getRideProps**(): `any`

#### Returns

`any`

___

### getBikeInterface

▸ **getBikeInterface**(): `string`

#### Returns

`string`

___

### getBike

▸ **getBike**(): `string`

#### Returns

`string`
