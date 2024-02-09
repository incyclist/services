[incyclist-services - v1.1.95](../README.md) / Workout

# Class: Workout

This represents a workout

## Hierarchy

- [`Segment`](Segment.md)

  ↳ **`Workout`**

## Implements

- [`WorkoutDefinition`](../interfaces/WorkoutDefinition.md)

## Table of contents

### Constructors

- [constructor](Workout.md#constructor)

### Properties

- [steps](Workout.md#steps)
- [repeat](Workout.md#repeat)
- [type](Workout.md#type)
- [start](Workout.md#start)
- [end](Workout.md#end)
- [duration](Workout.md#duration)
- [power](Workout.md#power)
- [cadence](Workout.md#cadence)
- [hrm](Workout.md#hrm)
- [text](Workout.md#text)
- [work](Workout.md#work)
- [steady](Workout.md#steady)
- [cooldown](Workout.md#cooldown)
- [id](Workout.md#id)
- [\_hash](Workout.md#_hash)
- [name](Workout.md#name)
- [description](Workout.md#description)
- [category](Workout.md#category)

### Accessors

- [hash](Workout.md#hash)

### Methods

- [validate](Workout.md#validate)
- [getDuration](Workout.md#getduration)
- [getStart](Workout.md#getstart)
- [getEnd](Workout.md#getend)
- [getLimits](Workout.md#getlimits)
- [getSegment](Workout.md#getsegment)
- [addStep](Workout.md#addstep)
- [addSegment](Workout.md#addsegment)

## Constructors

### constructor

• **new Workout**(`opts`): [`Workout`](Workout.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `opts` | [`WorkoutDefinition`](../interfaces/WorkoutDefinition.md) |

#### Returns

[`Workout`](Workout.md)

#### Overrides

[Segment](Segment.md).[constructor](Segment.md#constructor)

## Properties

### steps

• **steps**: [`Step`](Step.md)[]

the individual steps of this segment

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[steps](../interfaces/WorkoutDefinition.md#steps)

#### Inherited from

[Segment](Segment.md).[steps](Segment.md#steps)

___

### repeat

• **repeat**: `number`

number of repetitions

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[repeat](../interfaces/WorkoutDefinition.md#repeat)

#### Inherited from

[Segment](Segment.md).[repeat](Segment.md#repeat)

___

### type

• **type**: [`DataType`](../README.md#datatype)

identifies the type of the Object (any of 'step', 'segment', 'workout', 'plan'

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[type](../interfaces/WorkoutDefinition.md#type)

#### Inherited from

[Segment](Segment.md).[type](Segment.md#type)

___

### start

• `Optional` **start**: `number`

starting time (in sec since start of workout) of the current step/segment/workout

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[start](../interfaces/WorkoutDefinition.md#start)

#### Inherited from

[Segment](Segment.md).[start](Segment.md#start)

___

### end

• `Optional` **end**: `number`

end time (in sec since start of workout) of the current step/segment/workout

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[end](../interfaces/WorkoutDefinition.md#end)

#### Inherited from

[Segment](Segment.md).[end](Segment.md#end)

___

### duration

• **duration**: `number`

duration of the current step/segment/workout

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[duration](../interfaces/WorkoutDefinition.md#duration)

#### Inherited from

[Segment](Segment.md).[duration](Segment.md#duration)

___

### power

• `Optional` **power**: [`PowerLimit`](../interfaces/PowerLimit.md)

the limits (max,min) set for power

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[power](../interfaces/WorkoutDefinition.md#power)

#### Inherited from

[Segment](Segment.md).[power](Segment.md#power)

___

### cadence

• `Optional` **cadence**: [`Limit`](../README.md#limit)

the limits (max,min) set for cadence

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[cadence](../interfaces/WorkoutDefinition.md#cadence)

#### Inherited from

[Segment](Segment.md).[cadence](Segment.md#cadence)

___

### hrm

• `Optional` **hrm**: [`Limit`](../README.md#limit)

the limits (max,min) set for power

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[hrm](../interfaces/WorkoutDefinition.md#hrm)

#### Inherited from

[Segment](Segment.md).[hrm](Segment.md#hrm)

___

### text

• `Optional` **text**: `string`

An optional text to be displayed for this step/segment

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[text](../interfaces/WorkoutDefinition.md#text)

#### Inherited from

[Segment](Segment.md).[text](Segment.md#text)

___

### work

• **work**: `boolean`

identifies if the current step represents a work(true) or rest period (false)

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[work](../interfaces/WorkoutDefinition.md#work)

#### Inherited from

[Segment](Segment.md).[work](Segment.md#work)

___

### steady

• **steady**: `boolean`

boolean to identify if the current step represents a work or rest period

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[steady](../interfaces/WorkoutDefinition.md#steady)

#### Inherited from

[Segment](Segment.md).[steady](Segment.md#steady)

___

### cooldown

• **cooldown**: `boolean`

boolean to identify if the current step represents a cooldown phase

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[cooldown](../interfaces/WorkoutDefinition.md#cooldown)

#### Inherited from

[Segment](Segment.md).[cooldown](Segment.md#cooldown)

___

### id

• **id**: `string`

unique id of the workout

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[id](../interfaces/WorkoutDefinition.md#id)

___

### \_hash

• **\_hash**: `string`

___

### name

• **name**: `string`

the name of the workout (to be shown in lists (dashboards)

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[name](../interfaces/WorkoutDefinition.md#name)

___

### description

• **description**: `string`

A description of the workout (to be shown in info screens

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[description](../interfaces/WorkoutDefinition.md#description)

___

### category

• `Optional` **category**: [`Category`](../interfaces/Category.md)

A categorym the workout belongs to

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[category](../interfaces/WorkoutDefinition.md#category)

## Accessors

### hash

• `get` **hash**(): `string`

hash of the workout

#### Returns

`string`

#### Implementation of

[WorkoutDefinition](../interfaces/WorkoutDefinition.md).[hash](../interfaces/WorkoutDefinition.md#hash)

## Methods

### validate

▸ **validate**(): `void`

validates the values set for this seto/segment/workout

This will check that
- Start/End time and duration are correctly set
- Limits (if set) do contain at least a min or a max value and don't contradict  (e.g. min>max)

#### Returns

`void`

**`Throws`**

Error Error object containing the cause of the validation failure

#### Inherited from

[Segment](Segment.md).[validate](Segment.md#validate)

___

### getDuration

▸ **getDuration**(): `number`

#### Returns

`number`

number  duration (in sec) of the current step/segment/workout

#### Inherited from

[Segment](Segment.md).[getDuration](Segment.md#getduration)

___

### getStart

▸ **getStart**(): `number`

#### Returns

`number`

number  starting time (in sec since start of workout) of the current step/segment/workout

#### Inherited from

[Segment](Segment.md).[getStart](Segment.md#getstart)

___

### getEnd

▸ **getEnd**(): `number`

#### Returns

`number`

number  end time (in sec since start of workout) of the current step/segment/workout

#### Inherited from

[Segment](Segment.md).[getEnd](Segment.md#getend)

___

### getLimits

▸ **getLimits**(`ts`, `includeStepInfo?`): [`CurrentStep`](../interfaces/CurrentStep.md)

returns the limits for a given timestamp within the training

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `ts` | `any` | `undefined` |
| `includeStepInfo` | `boolean` | `false` |

#### Returns

[`CurrentStep`](../interfaces/CurrentStep.md)

**`Throws`**

Error Error object containing the cause of the validation failure

#### Inherited from

[Segment](Segment.md).[getLimits](Segment.md#getlimits)

___

### getSegment

▸ **getSegment**(`time`): [`Segment`](Segment.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `time` | `number` |

#### Returns

[`Segment`](Segment.md)

___

### addStep

▸ **addStep**(`step`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `step` | [`StepDefinition`](../interfaces/StepDefinition.md) |

#### Returns

`void`

___

### addSegment

▸ **addSegment**(`segment`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `segment` | [`SegmentDefinition`](../interfaces/SegmentDefinition.md) |

#### Returns

`void`
