[incyclist-services - v1.2.2](../README.md) / WorkoutDefinition

# Interface: WorkoutDefinition

A Workout

## Hierarchy

- [`SegmentDefinition`](SegmentDefinition.md)

  ↳ **`WorkoutDefinition`**

## Implemented by

- [`Workout`](../classes/Workout.md)

## Table of contents

### Properties

- [start](WorkoutDefinition.md#start)
- [end](WorkoutDefinition.md#end)
- [duration](WorkoutDefinition.md#duration)
- [power](WorkoutDefinition.md#power)
- [cadence](WorkoutDefinition.md#cadence)
- [hrm](WorkoutDefinition.md#hrm)
- [text](WorkoutDefinition.md#text)
- [work](WorkoutDefinition.md#work)
- [steady](WorkoutDefinition.md#steady)
- [cooldown](WorkoutDefinition.md#cooldown)
- [steps](WorkoutDefinition.md#steps)
- [repeat](WorkoutDefinition.md#repeat)
- [type](WorkoutDefinition.md#type)
- [id](WorkoutDefinition.md#id)
- [hash](WorkoutDefinition.md#hash)
- [name](WorkoutDefinition.md#name)
- [description](WorkoutDefinition.md#description)
- [category](WorkoutDefinition.md#category)

## Properties

### start

• `Optional` **start**: `number`

starting time (in sec since start of workout) of the current step/segment/workout

#### Inherited from

[SegmentDefinition](SegmentDefinition.md).[start](SegmentDefinition.md#start)

___

### end

• `Optional` **end**: `number`

end time (in sec since start of workout) of the current step/segment/workout

#### Inherited from

[SegmentDefinition](SegmentDefinition.md).[end](SegmentDefinition.md#end)

___

### duration

• `Optional` **duration**: `number`

duration of the current step/segment/workout

#### Inherited from

[SegmentDefinition](SegmentDefinition.md).[duration](SegmentDefinition.md#duration)

___

### power

• `Optional` **power**: [`PowerLimit`](PowerLimit.md)

the limits (max,min) set for power

#### Inherited from

[SegmentDefinition](SegmentDefinition.md).[power](SegmentDefinition.md#power)

___

### cadence

• `Optional` **cadence**: [`Limit`](../README.md#limit)

the limits (max,min) set for cadence

#### Inherited from

[SegmentDefinition](SegmentDefinition.md).[cadence](SegmentDefinition.md#cadence)

___

### hrm

• `Optional` **hrm**: [`Limit`](../README.md#limit)

the limits (max,min) set for heartrate

#### Inherited from

[SegmentDefinition](SegmentDefinition.md).[hrm](SegmentDefinition.md#hrm)

___

### text

• `Optional` **text**: `string`

An optional text to be displayed for this step/segment

#### Inherited from

[SegmentDefinition](SegmentDefinition.md).[text](SegmentDefinition.md#text)

___

### work

• `Optional` **work**: `boolean`

identifies if the current step represents a work(true) or rest period (false)

#### Inherited from

[SegmentDefinition](SegmentDefinition.md).[work](SegmentDefinition.md#work)

___

### steady

• `Optional` **steady**: `boolean`

boolean to identify if the current step represents a work or rest period

#### Inherited from

[SegmentDefinition](SegmentDefinition.md).[steady](SegmentDefinition.md#steady)

___

### cooldown

• `Optional` **cooldown**: `boolean`

boolean to identify if the current step represents a cooldown phase

#### Inherited from

[SegmentDefinition](SegmentDefinition.md).[cooldown](SegmentDefinition.md#cooldown)

___

### steps

• `Optional` **steps**: [`StepDefinition`](StepDefinition.md)[]

the individual steps of this segment

#### Inherited from

[SegmentDefinition](SegmentDefinition.md).[steps](SegmentDefinition.md#steps)

___

### repeat

• `Optional` **repeat**: `number`

number of repetitions

#### Inherited from

[SegmentDefinition](SegmentDefinition.md).[repeat](SegmentDefinition.md#repeat)

___

### type

• **type**: [`DataType`](../README.md#datatype)

identifies the type of the Object (should always be 'step', 'segment', 'workout', 'plan'

#### Overrides

[SegmentDefinition](SegmentDefinition.md).[type](SegmentDefinition.md#type)

___

### id

• `Optional` **id**: `string`

unique id of the workout

___

### hash

• `Optional` **hash**: `string`

hash of the workout

___

### name

• `Optional` **name**: `string`

the name of the workout (to be shown in lists (dashboards)

___

### description

• `Optional` **description**: `string`

A description of the workout (to be shown in info screens

___

### category

• `Optional` **category**: [`Category`](Category.md)

A categorym the workout belongs to
