[incyclist-services - v1.1.98](../README.md) / SegmentDefinition

# Interface: SegmentDefinition

A Segment allows to combine multiple steps and repeat them multiple times

## Hierarchy

- [`StepDefinition`](StepDefinition.md)

  ↳ **`SegmentDefinition`**

  ↳↳ [`WorkoutDefinition`](WorkoutDefinition.md)

## Implemented by

- [`Segment`](../classes/Segment.md)

## Table of contents

### Properties

- [type](SegmentDefinition.md#type)
- [start](SegmentDefinition.md#start)
- [end](SegmentDefinition.md#end)
- [duration](SegmentDefinition.md#duration)
- [power](SegmentDefinition.md#power)
- [cadence](SegmentDefinition.md#cadence)
- [hrm](SegmentDefinition.md#hrm)
- [text](SegmentDefinition.md#text)
- [work](SegmentDefinition.md#work)
- [steady](SegmentDefinition.md#steady)
- [cooldown](SegmentDefinition.md#cooldown)
- [steps](SegmentDefinition.md#steps)
- [repeat](SegmentDefinition.md#repeat)

## Properties

### type

• `Optional` **type**: [`DataType`](../README.md#datatype)

identifies the type of the Object (should always be 'step', 'segment', 'workout', 'plan'

#### Inherited from

[StepDefinition](StepDefinition.md).[type](StepDefinition.md#type)

___

### start

• `Optional` **start**: `number`

starting time (in sec since start of workout) of the current step/segment/workout

#### Inherited from

[StepDefinition](StepDefinition.md).[start](StepDefinition.md#start)

___

### end

• `Optional` **end**: `number`

end time (in sec since start of workout) of the current step/segment/workout

#### Inherited from

[StepDefinition](StepDefinition.md).[end](StepDefinition.md#end)

___

### duration

• `Optional` **duration**: `number`

duration of the current step/segment/workout

#### Inherited from

[StepDefinition](StepDefinition.md).[duration](StepDefinition.md#duration)

___

### power

• `Optional` **power**: [`PowerLimit`](PowerLimit.md)

the limits (max,min) set for power

#### Inherited from

[StepDefinition](StepDefinition.md).[power](StepDefinition.md#power)

___

### cadence

• `Optional` **cadence**: [`Limit`](../README.md#limit)

the limits (max,min) set for cadence

#### Inherited from

[StepDefinition](StepDefinition.md).[cadence](StepDefinition.md#cadence)

___

### hrm

• `Optional` **hrm**: [`Limit`](../README.md#limit)

the limits (max,min) set for heartrate

#### Inherited from

[StepDefinition](StepDefinition.md).[hrm](StepDefinition.md#hrm)

___

### text

• `Optional` **text**: `string`

An optional text to be displayed for this step/segment

#### Inherited from

[StepDefinition](StepDefinition.md).[text](StepDefinition.md#text)

___

### work

• `Optional` **work**: `boolean`

identifies if the current step represents a work(true) or rest period (false)

#### Inherited from

[StepDefinition](StepDefinition.md).[work](StepDefinition.md#work)

___

### steady

• `Optional` **steady**: `boolean`

boolean to identify if the current step represents a work or rest period

#### Inherited from

[StepDefinition](StepDefinition.md).[steady](StepDefinition.md#steady)

___

### cooldown

• `Optional` **cooldown**: `boolean`

boolean to identify if the current step represents a cooldown phase

#### Inherited from

[StepDefinition](StepDefinition.md).[cooldown](StepDefinition.md#cooldown)

___

### steps

• `Optional` **steps**: [`StepDefinition`](StepDefinition.md)[]

the individual steps of this segment

___

### repeat

• `Optional` **repeat**: `number`

number of repetitions
