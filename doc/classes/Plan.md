[incyclist-services - v1.1.98](../README.md) / Plan

# Class: Plan

## Implements

- [`PlanDefinition`](../interfaces/PlanDefinition.md)

## Table of contents

### Constructors

- [constructor](Plan.md#constructor)

### Properties

- [type](Plan.md#type)
- [id](Plan.md#id)
- [name](Plan.md#name)
- [description](Plan.md#description)
- [workouts](Plan.md#workouts)

### Accessors

- [hash](Plan.md#hash)

### Methods

- [addWorkoutSchedule](Plan.md#addworkoutschedule)
- [deleteWorkoutSchedule](Plan.md#deleteworkoutschedule)

## Constructors

### constructor

• **new Plan**(`plan`): [`Plan`](Plan.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `plan` | [`PlanDefinition`](../interfaces/PlanDefinition.md) |

#### Returns

[`Plan`](Plan.md)

## Properties

### type

• **type**: [`DataType`](../README.md#datatype)

___

### id

• `Optional` **id**: `string`

#### Implementation of

[PlanDefinition](../interfaces/PlanDefinition.md).[id](../interfaces/PlanDefinition.md#id)

___

### name

• `Optional` **name**: `string`

#### Implementation of

[PlanDefinition](../interfaces/PlanDefinition.md).[name](../interfaces/PlanDefinition.md#name)

___

### description

• `Optional` **description**: `string`

#### Implementation of

[PlanDefinition](../interfaces/PlanDefinition.md).[description](../interfaces/PlanDefinition.md#description)

___

### workouts

• **workouts**: [`ScheduledWorkout`](../interfaces/ScheduledWorkout.md)[]

#### Implementation of

[PlanDefinition](../interfaces/PlanDefinition.md).[workouts](../interfaces/PlanDefinition.md#workouts)

## Accessors

### hash

• `get` **hash**(): `string`

#### Returns

`string`

#### Implementation of

[PlanDefinition](../interfaces/PlanDefinition.md).[hash](../interfaces/PlanDefinition.md#hash)

## Methods

### addWorkoutSchedule

▸ **addWorkoutSchedule**(`week`, `day`, `workoutId`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `week` | `number` |
| `day` | `number` |
| `workoutId` | `string` |

#### Returns

`void`

___

### deleteWorkoutSchedule

▸ **deleteWorkoutSchedule**(`week`, `day`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `week` | `number` |
| `day` | `number` |

#### Returns

`void`
