[incyclist-services - v1.1.97](../README.md) / CurrentStep

# Interface: CurrentStep

Provides information on the current limits, step defintion (optional) and remainder of a workout step for a given time during the workout

## Hierarchy

- [`StepDefinition`](StepDefinition.md)

  ↳ **`CurrentStep`**

## Table of contents

### Properties

- [type](CurrentStep.md#type)
- [start](CurrentStep.md#start)
- [end](CurrentStep.md#end)
- [steady](CurrentStep.md#steady)
- [cooldown](CurrentStep.md#cooldown)
- [duration](CurrentStep.md#duration)
- [power](CurrentStep.md#power)
- [cadence](CurrentStep.md#cadence)
- [hrm](CurrentStep.md#hrm)
- [text](CurrentStep.md#text)
- [work](CurrentStep.md#work)
- [remaining](CurrentStep.md#remaining)
- [step](CurrentStep.md#step)

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

### duration

• **duration**: `number`

duration (in sec) of the current step

#### Overrides

[StepDefinition](StepDefinition.md).[duration](StepDefinition.md#duration)

___

### power

• `Optional` **power**: [`PowerLimit`](PowerLimit.md)

the limits (max,min) set for power

#### Overrides

[StepDefinition](StepDefinition.md).[power](StepDefinition.md#power)

___

### cadence

• `Optional` **cadence**: [`Limit`](../README.md#limit)

the limits (max,min) set for cadence

#### Overrides

[StepDefinition](StepDefinition.md).[cadence](StepDefinition.md#cadence)

___

### hrm

• `Optional` **hrm**: [`Limit`](../README.md#limit)

the limits (max,min) set for heartrate

#### Overrides

[StepDefinition](StepDefinition.md).[hrm](StepDefinition.md#hrm)

___

### text

• **text**: `string`

An optional text to be displayed for this step/segment

#### Overrides

[StepDefinition](StepDefinition.md).[text](StepDefinition.md#text)

___

### work

• **work**: `boolean`

identifies if the current step represents a work(true) or rest period (false)

#### Overrides

[StepDefinition](StepDefinition.md).[work](StepDefinition.md#work)

___

### remaining

• **remaining**: `number`

remaining time (in sec) within the current step

___

### step

• `Optional` **step**: [`StepDefinition`](StepDefinition.md)

the original definition of the step
