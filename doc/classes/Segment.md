[incyclist-services - v1.1.97](../README.md) / Segment

# Class: Segment

## Hierarchy

- [`Step`](Step.md)

  ↳ **`Segment`**

  ↳↳ [`Workout`](Workout.md)

## Implements

- [`SegmentDefinition`](../interfaces/SegmentDefinition.md)

## Table of contents

### Constructors

- [constructor](Segment.md#constructor)

### Properties

- [steps](Segment.md#steps)
- [repeat](Segment.md#repeat)
- [type](Segment.md#type)
- [start](Segment.md#start)
- [end](Segment.md#end)
- [duration](Segment.md#duration)
- [power](Segment.md#power)
- [cadence](Segment.md#cadence)
- [hrm](Segment.md#hrm)
- [text](Segment.md#text)
- [work](Segment.md#work)
- [steady](Segment.md#steady)
- [cooldown](Segment.md#cooldown)

### Methods

- [validate](Segment.md#validate)
- [getDuration](Segment.md#getduration)
- [getStart](Segment.md#getstart)
- [getEnd](Segment.md#getend)
- [getLimits](Segment.md#getlimits)

## Constructors

### constructor

• **new Segment**(`opts?`, `ignoreValidate?`): [`Segment`](Segment.md)

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `opts` | [`SegmentDefinition`](../interfaces/SegmentDefinition.md) | `null` |
| `ignoreValidate?` | `boolean` | `undefined` |

#### Returns

[`Segment`](Segment.md)

#### Overrides

[Step](Step.md).[constructor](Step.md#constructor)

## Properties

### steps

• **steps**: [`Step`](Step.md)[]

the individual steps of this segment

#### Implementation of

[SegmentDefinition](../interfaces/SegmentDefinition.md).[steps](../interfaces/SegmentDefinition.md#steps)

___

### repeat

• **repeat**: `number`

number of repetitions

#### Implementation of

[SegmentDefinition](../interfaces/SegmentDefinition.md).[repeat](../interfaces/SegmentDefinition.md#repeat)

___

### type

• **type**: [`DataType`](../README.md#datatype)

identifies the type of the Object (any of 'step', 'segment', 'workout', 'plan'

#### Implementation of

[SegmentDefinition](../interfaces/SegmentDefinition.md).[type](../interfaces/SegmentDefinition.md#type)

#### Inherited from

[Step](Step.md).[type](Step.md#type)

___

### start

• `Optional` **start**: `number`

starting time (in sec since start of workout) of the current step/segment/workout

#### Implementation of

[SegmentDefinition](../interfaces/SegmentDefinition.md).[start](../interfaces/SegmentDefinition.md#start)

#### Inherited from

[Step](Step.md).[start](Step.md#start)

___

### end

• `Optional` **end**: `number`

end time (in sec since start of workout) of the current step/segment/workout

#### Implementation of

[SegmentDefinition](../interfaces/SegmentDefinition.md).[end](../interfaces/SegmentDefinition.md#end)

#### Inherited from

[Step](Step.md).[end](Step.md#end)

___

### duration

• **duration**: `number`

duration of the current step/segment/workout

#### Implementation of

[SegmentDefinition](../interfaces/SegmentDefinition.md).[duration](../interfaces/SegmentDefinition.md#duration)

#### Inherited from

[Step](Step.md).[duration](Step.md#duration)

___

### power

• `Optional` **power**: [`PowerLimit`](../interfaces/PowerLimit.md)

the limits (max,min) set for power

#### Implementation of

[SegmentDefinition](../interfaces/SegmentDefinition.md).[power](../interfaces/SegmentDefinition.md#power)

#### Inherited from

[Step](Step.md).[power](Step.md#power)

___

### cadence

• `Optional` **cadence**: [`Limit`](../README.md#limit)

the limits (max,min) set for cadence

#### Implementation of

[SegmentDefinition](../interfaces/SegmentDefinition.md).[cadence](../interfaces/SegmentDefinition.md#cadence)

#### Inherited from

[Step](Step.md).[cadence](Step.md#cadence)

___

### hrm

• `Optional` **hrm**: [`Limit`](../README.md#limit)

the limits (max,min) set for power

#### Implementation of

[SegmentDefinition](../interfaces/SegmentDefinition.md).[hrm](../interfaces/SegmentDefinition.md#hrm)

#### Inherited from

[Step](Step.md).[hrm](Step.md#hrm)

___

### text

• `Optional` **text**: `string`

An optional text to be displayed for this step/segment

#### Implementation of

[SegmentDefinition](../interfaces/SegmentDefinition.md).[text](../interfaces/SegmentDefinition.md#text)

#### Inherited from

[Step](Step.md).[text](Step.md#text)

___

### work

• **work**: `boolean`

identifies if the current step represents a work(true) or rest period (false)

#### Implementation of

[SegmentDefinition](../interfaces/SegmentDefinition.md).[work](../interfaces/SegmentDefinition.md#work)

#### Inherited from

[Step](Step.md).[work](Step.md#work)

___

### steady

• **steady**: `boolean`

boolean to identify if the current step represents a work or rest period

#### Implementation of

[SegmentDefinition](../interfaces/SegmentDefinition.md).[steady](../interfaces/SegmentDefinition.md#steady)

#### Inherited from

[Step](Step.md).[steady](Step.md#steady)

___

### cooldown

• **cooldown**: `boolean`

boolean to identify if the current step represents a cooldown phase

#### Implementation of

[SegmentDefinition](../interfaces/SegmentDefinition.md).[cooldown](../interfaces/SegmentDefinition.md#cooldown)

#### Inherited from

[Step](Step.md).[cooldown](Step.md#cooldown)

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

#### Overrides

[Step](Step.md).[validate](Step.md#validate)

___

### getDuration

▸ **getDuration**(): `number`

#### Returns

`number`

number  duration (in sec) of the current step/segment/workout

#### Overrides

[Step](Step.md).[getDuration](Step.md#getduration)

___

### getStart

▸ **getStart**(): `number`

#### Returns

`number`

number  starting time (in sec since start of workout) of the current step/segment/workout

#### Overrides

[Step](Step.md).[getStart](Step.md#getstart)

___

### getEnd

▸ **getEnd**(): `number`

#### Returns

`number`

number  end time (in sec since start of workout) of the current step/segment/workout

#### Overrides

[Step](Step.md).[getEnd](Step.md#getend)

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

#### Overrides

[Step](Step.md).[getLimits](Step.md#getlimits)
