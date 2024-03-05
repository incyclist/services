[incyclist-services - v1.2.2](../README.md) / Step

# Class: Step

## Hierarchy

- **`Step`**

  ↳ [`Segment`](Segment.md)

## Implements

- [`StepDefinition`](../interfaces/StepDefinition.md)

## Table of contents

### Constructors

- [constructor](Step.md#constructor)

### Properties

- [type](Step.md#type)
- [start](Step.md#start)
- [end](Step.md#end)
- [duration](Step.md#duration)
- [power](Step.md#power)
- [cadence](Step.md#cadence)
- [hrm](Step.md#hrm)
- [text](Step.md#text)
- [work](Step.md#work)
- [steady](Step.md#steady)
- [cooldown](Step.md#cooldown)

### Methods

- [validate](Step.md#validate)
- [getDuration](Step.md#getduration)
- [getStart](Step.md#getstart)
- [getEnd](Step.md#getend)
- [getLimits](Step.md#getlimits)

## Constructors

### constructor

• **new Step**(`opts?`, `ignoreValidate?`): [`Step`](Step.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `opts?` | `any` |
| `ignoreValidate?` | `boolean` |

#### Returns

[`Step`](Step.md)

## Properties

### type

• **type**: [`DataType`](../README.md#datatype)

identifies the type of the Object (any of 'step', 'segment', 'workout', 'plan'

#### Implementation of

[StepDefinition](../interfaces/StepDefinition.md).[type](../interfaces/StepDefinition.md#type)

___

### start

• `Optional` **start**: `number`

starting time (in sec since start of workout) of the current step/segment/workout

#### Implementation of

[StepDefinition](../interfaces/StepDefinition.md).[start](../interfaces/StepDefinition.md#start)

___

### end

• `Optional` **end**: `number`

end time (in sec since start of workout) of the current step/segment/workout

#### Implementation of

[StepDefinition](../interfaces/StepDefinition.md).[end](../interfaces/StepDefinition.md#end)

___

### duration

• **duration**: `number`

duration of the current step/segment/workout

#### Implementation of

[StepDefinition](../interfaces/StepDefinition.md).[duration](../interfaces/StepDefinition.md#duration)

___

### power

• `Optional` **power**: [`PowerLimit`](../interfaces/PowerLimit.md)

the limits (max,min) set for power

#### Implementation of

[StepDefinition](../interfaces/StepDefinition.md).[power](../interfaces/StepDefinition.md#power)

___

### cadence

• `Optional` **cadence**: [`Limit`](../README.md#limit)

the limits (max,min) set for cadence

#### Implementation of

[StepDefinition](../interfaces/StepDefinition.md).[cadence](../interfaces/StepDefinition.md#cadence)

___

### hrm

• `Optional` **hrm**: [`Limit`](../README.md#limit)

the limits (max,min) set for power

#### Implementation of

[StepDefinition](../interfaces/StepDefinition.md).[hrm](../interfaces/StepDefinition.md#hrm)

___

### text

• `Optional` **text**: `string`

An optional text to be displayed for this step/segment

#### Implementation of

[StepDefinition](../interfaces/StepDefinition.md).[text](../interfaces/StepDefinition.md#text)

___

### work

• **work**: `boolean`

identifies if the current step represents a work(true) or rest period (false)

#### Implementation of

[StepDefinition](../interfaces/StepDefinition.md).[work](../interfaces/StepDefinition.md#work)

___

### steady

• **steady**: `boolean`

boolean to identify if the current step represents a work or rest period

#### Implementation of

[StepDefinition](../interfaces/StepDefinition.md).[steady](../interfaces/StepDefinition.md#steady)

___

### cooldown

• **cooldown**: `boolean`

boolean to identify if the current step represents a cooldown phase

#### Implementation of

[StepDefinition](../interfaces/StepDefinition.md).[cooldown](../interfaces/StepDefinition.md#cooldown)

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

___

### getDuration

▸ **getDuration**(): `number`

#### Returns

`number`

number  duration (in sec) of the current step/segment/workout

___

### getStart

▸ **getStart**(): `number`

#### Returns

`number`

number  starting time (in sec since start of workout) of the current step/segment/workout

___

### getEnd

▸ **getEnd**(): `number`

#### Returns

`number`

number  end time (in sec since start of workout) of the current step/segment/workout

___

### getLimits

▸ **getLimits**(`ts`, `includeStepInfo?`): [`CurrentStep`](../interfaces/CurrentStep.md)

returns the limits for a given timestamp within the training

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `ts` | `number` | `undefined` |
| `includeStepInfo` | `boolean` | `false` |

#### Returns

[`CurrentStep`](../interfaces/CurrentStep.md)

**`Throws`**

Error Error object containing the cause of the validation failure
