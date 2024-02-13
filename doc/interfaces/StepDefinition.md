[incyclist-services - v1.1.98](../README.md) / StepDefinition

# Interface: StepDefinition

## Hierarchy

- **`StepDefinition`**

  ↳ [`CurrentStep`](CurrentStep.md)

  ↳ [`SegmentDefinition`](SegmentDefinition.md)

## Implemented by

- [`Step`](../classes/Step.md)

## Table of contents

### Properties

- [type](StepDefinition.md#type)
- [start](StepDefinition.md#start)
- [end](StepDefinition.md#end)
- [duration](StepDefinition.md#duration)
- [power](StepDefinition.md#power)
- [cadence](StepDefinition.md#cadence)
- [hrm](StepDefinition.md#hrm)
- [text](StepDefinition.md#text)
- [work](StepDefinition.md#work)
- [steady](StepDefinition.md#steady)
- [cooldown](StepDefinition.md#cooldown)

## Properties

### type

• `Optional` **type**: [`DataType`](../README.md#datatype)

identifies the type of the Object (should always be 'step', 'segment', 'workout', 'plan'

___

### start

• `Optional` **start**: `number`

starting time (in sec since start of workout) of the current step/segment/workout

___

### end

• `Optional` **end**: `number`

end time (in sec since start of workout) of the current step/segment/workout

___

### duration

• `Optional` **duration**: `number`

duration of the current step/segment/workout

___

### power

• `Optional` **power**: [`PowerLimit`](PowerLimit.md)

the limits (max,min) set for power

___

### cadence

• `Optional` **cadence**: [`Limit`](../README.md#limit)

the limits (max,min) set for cadence

___

### hrm

• `Optional` **hrm**: [`Limit`](../README.md#limit)

the limits (max,min) set for heartrate

___

### text

• `Optional` **text**: `string`

An optional text to be displayed for this step/segment

___

### work

• `Optional` **work**: `boolean`

identifies if the current step represents a work(true) or rest period (false)

___

### steady

• `Optional` **steady**: `boolean`

boolean to identify if the current step represents a work or rest period

___

### cooldown

• `Optional` **cooldown**: `boolean`

boolean to identify if the current step represents a cooldown phase
