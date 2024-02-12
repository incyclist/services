[incyclist-services - v1.1.97](../README.md) / WorkoutRide

# Class: WorkoutRide

This service is used by the Front-End to manage the state of the previously selected workout
and to implement the business logic to display the content for a workout dashboard

The workout first needs to be initialized - which will reset the internal state (incl. counters and timers)
Once the workout has been initialized, it can be started/paused/resumed or stopped

The WorkoutRide Service implements an Observer pattern, were the Observer is created during initialization
It will then notify potantial consumers about relevant events:

- 'initialized' - The workout has been initialized and is ready to be used in a ride
- 'update' - There was an update, which requires the dashboard to be updated
- 'request-update' - There was an update, which requires to send updated requests to the SmartTrainer 
 
- 'started' - The workout has been started
- 'paused' - The workout has been paused
- 'resumed' - The workout has been resumed
- 'completed' - The workout has been completed or was stopped by the user

__Dashboard__

The dasboard component will typically only register for the updates and completed events to udpate its internal state

**`Example`**

```
const {useWorkoutRide} = require('incyclist-services');

const service = useWorkoutRide()

const observer = service.getObserver()
if (observer) {
   observer
     .on('update',(displayProps)=> {console.log(displayProps)})
     .on('completed',()=> {console.log('Workout completed')})
}
```

__Ride Workkflow__

The business logic of the actual ride, will typically initialize this service and then monitor for request updates

**`Example`**

```
const {useWorkoutRide} = require('incyclist-services');

const service = useWorkoutRide()

const observer = service.init()
if (observer) {
   observer
     .on('request-update',(requestProps)=> {console.log(requestProps)})
     .on('started',()=> {console.log('Workout started')})
     .on('completed',()=> {console.log('Workout completed')})
}
```

## Hierarchy

- `IncyclistService`

  ↳ **`WorkoutRide`**

## Table of contents

### Constructors

- [constructor](WorkoutRide.md#constructor)

### Methods

- [init](WorkoutRide.md#init)
- [start](WorkoutRide.md#start)
- [pause](WorkoutRide.md#pause)
- [resume](WorkoutRide.md#resume)
- [stop](WorkoutRide.md#stop)
- [forward](WorkoutRide.md#forward)
- [backward](WorkoutRide.md#backward)
- [powerUp](WorkoutRide.md#powerup)
- [powerDown](WorkoutRide.md#powerdown)
- [getDashboardDisplayProperties](WorkoutRide.md#getdashboarddisplayproperties)
- [getCurrentLimits](WorkoutRide.md#getcurrentlimits)
- [inUse](WorkoutRide.md#inuse)
- [isActive](WorkoutRide.md#isactive)
- [getWorkout](WorkoutRide.md#getworkout)
- [getObserver](WorkoutRide.md#getobserver)
- [emit](WorkoutRide.md#emit)

## Constructors

### constructor

• **new WorkoutRide**(): [`WorkoutRide`](WorkoutRide.md)

#### Returns

[`WorkoutRide`](WorkoutRide.md)

#### Overrides

IncyclistService.constructor

## Methods

### init

▸ **init**(): `Observer`

Prepares the workout for the upcoming ride

It will make use of the [[WorkoutList]] to get workout that was selected by the user and Start Settings ( ERGMode on/off and selected FTP)
If no workout was selected, the method will return without response

Once workout and settings were determined, it will reset the timers and manual offsets that the user has created 
during a previous ride

Finally, it will set the internal state to "initialized" and return an Observer, which can be used by 
the consumer to get notified about updates.

#### Returns

`Observer`

[[Observer]] Observer object which will notify consumers about updates/status changes of the workout during the ongoing ride

**`Emits`**

__initialized__

___

### start

▸ **start**(`paused?`): [`Workout`](Workout.md)

Starts a ride with the workout that was previously selected/initialized

This will start an interval which checks every 500ms if the limits or dashboard need to be adjusted
If needed, it will trigger notifications to update the dashboard and/or the limits to be sent to the device

If the [[init]] method has not been called before, it will simply return without any response

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `paused` | `boolean` | `false` | indicates whether the initial state after start should be _paused_. This should be set if the user is not yet cycling |

#### Returns

[`Workout`](Workout.md)

[[Workout]] The workout that has been started

**`Emits`**

__started__

**`Emits`**

__update__      indicates that the dashboard needs to be adjusted
     will add a [[WorkoutDisplayProperties]] object as argument which contains the new display properties

**`Emits`**

__request-update__      indicates that the limits needs to be adjusted
     will add an [[ActiveWorkoutLimit]] object, which contains the udpated limits

___

### pause

▸ **pause**(): `void`

Pauses the current workout

This method needs to be called upon pauses, to ensure that the dashboards and limits will not be updated anymore

If the [[init]] method has not been called before or the workout is not in _active_ state, it will simply return without any response

#### Returns

`void`

**`Emits`**

__paused__

___

### resume

▸ **resume**(): `void`

Resumes the current workout

This method needs to be called to leave the _paused_ state of the workout so that the the dashboards and limits will be updated again

If the workout is not in _completed_ state, it will restart the workout
If the [[init]] method has not been called before or the workout is not in _pause_ state, it will simply return without any response

#### Returns

`void`

**`Emits`**

__resumed__

___

### stop

▸ **stop**(): `void`

stops the current workout

This method needs to be called whenever a workout is either completed or a user wants to manually stop it.

#### Returns

`void`

**`Emits`**

__completed__

___

### forward

▸ **forward**(): `void`

Move to the next workout step

This method moves the limits to the next workout step. 
This allows the user to jump over steps that cannot be maintained

#### Returns

`void`

___

### backward

▸ **backward**(): `void`

Move back to the beginning of the current step or previous step

This method moves the limits to the beginning of the current step or previous step
This allows the user to repeat steps beyond the repetitions configured in the workout

If the user has completed more than 30s or 50% of a step, it will jump back to the beginning of the current step,
otherwise it will jump back to the beginning of the previous step

#### Returns

`void`

___

### powerUp

▸ **powerUp**(`delta`): `void`

Adjusts the base level of th workout

This allows the user to increase the instensity of a workout. 

Depending on how the the step limits are defined, this will have different impact
- Step defined in "percentage of FTP": The FTP will be increased by _delta_ %
- Step defined in "Watts": The power limit will be increased by _delta_ Watts

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `delta` | `number` | adjustment of the FTP(in%) or current Power (in Watt) |

#### Returns

`void`

___

### powerDown

▸ **powerDown**(`delta`): `void`

Adjusts the base level of th workout

This allows the user to decrease the instensity of a workout. 

Depending on how the the step limits are defined, this will have different impact
- Step defined in "percentage of FTP": The FTP will be decreased by _delta_ %
- Step defined in "Watts": The power limit will be decreased by _delta_ Watts

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `delta` | `number` | adjustment of the FTP(in%) or current Power (in Watt) |

#### Returns

`void`

___

### getDashboardDisplayProperties

▸ **getDashboardDisplayProperties**(): [`WorkoutDisplayProperties`](../interfaces/WorkoutDisplayProperties.md)

Provides the information that should be displayed in the dashboard

This contains:
- The complete workout ( to be shown in the graph)
- The workout title (to be shown in the info bar)
- The current FTP setting
- The current limits ( to be shown as values in the dashboard) incl. step time and remaining step time
- Optionally: start and stop for the workout graph

This method also implements the logic to automatically adjust the zoom factor for the workout graph
every 30s. If the total remaining workout time is less than 20min, the zoom will contain the last 20mins

#### Returns

[`WorkoutDisplayProperties`](../interfaces/WorkoutDisplayProperties.md)

[[WorkoutDisplayProperties]] Information to be shown in the dashboard

___

### getCurrentLimits

▸ **getCurrentLimits**(): [`ActiveWorkoutLimit`](../interfaces/ActiveWorkoutLimit.md)

Provides the limits that are used in the current workout step

#### Returns

[`ActiveWorkoutLimit`](../interfaces/ActiveWorkoutLimit.md)

[[ActiveWorkoutLimit]] the current limit or _undefined_ if the workout hasn't bee initialized or already was completed

___

### inUse

▸ **inUse**(): `boolean`

Provides information if the dashboard should be shown

The dashboard should be shown as soon as a workout has been initialized until it has been completed

#### Returns

`boolean`

boolean true: dashboard should be shown, false: dashboard does not need to be shown

___

### isActive

▸ **isActive**(): `boolean`

Provides information if the workout is in _active_ state

#### Returns

`boolean`

boolean true: workout is active, false: otherwise

___

### getWorkout

▸ **getWorkout**(): [`Workout`](Workout.md)

Provides the current workout beeing ridden

#### Returns

[`Workout`](Workout.md)

[[Workout]] the current workout or _undefined_ if init() hasn't been called

___

### getObserver

▸ **getObserver**(): `Observer`

Provides the Observer

#### Returns

`Observer`

[[Observer]] the current observer or _undefined_ if init() hasn't been called

___

### emit

▸ **emit**(`eventName`, `...args`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `eventName` | `string` |
| `...args` | `any`[] |

#### Returns

`boolean`

#### Overrides

IncyclistService.emit
