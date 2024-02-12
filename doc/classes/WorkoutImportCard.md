[incyclist-services - v1.1.97](../README.md) / WorkoutImportCard

# Class: WorkoutImportCard

[WorkoutImportCard](WorkoutImportCard.md) objects are used to represent the option to trigger an import

The card does __not__ perform the import (this will be done by the [[WorkoutListService]])

## Hierarchy

- `BaseCard`

  ↳ **`WorkoutImportCard`**

## Implements

- `Card`\<[`Workout`](Workout.md)\>

## Table of contents

### Methods

- [setVisible](WorkoutImportCard.md#setvisible)
- [canDelete](WorkoutImportCard.md#candelete)
- [canStart](WorkoutImportCard.md#canstart)
- [delete](WorkoutImportCard.md#delete)
- [getData](WorkoutImportCard.md#getdata)
- [getCardType](WorkoutImportCard.md#getcardtype)
- [getId](WorkoutImportCard.md#getid)
- [getFilters](WorkoutImportCard.md#getfilters)
- [getTitle](WorkoutImportCard.md#gettitle)
- [getDisplayProperties](WorkoutImportCard.md#getdisplayproperties)

## Methods

### setVisible

▸ **setVisible**(): `void`

#### Returns

`void`

#### Implementation of

Card.setVisible

#### Overrides

BaseCard.setVisible

___

### canDelete

▸ **canDelete**(): `boolean`

#### Returns

`boolean`

___

### canStart

▸ **canStart**(`status`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `status` | `AppStatus` |

#### Returns

`boolean`

___

### delete

▸ **delete**(): `PromiseObserver`\<`boolean`\>

deletes the card from the Workout List - this should never be called

#### Returns

`PromiseObserver`\<`boolean`\>

always returnfs false, as card cannot be deleted

#### Implementation of

Card.delete

#### Overrides

BaseCard.delete

___

### getData

▸ **getData**(): `any`

returns the workout that is represented by this card

#### Returns

`any`

always will be _undefined_

#### Implementation of

Card.getData

#### Overrides

BaseCard.getData

___

### getCardType

▸ **getCardType**(): [`WorkoutCardType`](../README.md#workoutcardtype)

returns type of this card

#### Returns

[`WorkoutCardType`](../README.md#workoutcardtype)

always will be 'WorkoutImport'

#### Implementation of

Card.getCardType

#### Overrides

BaseCard.getCardType

___

### getId

▸ **getId**(): `string`

returns a unique ID of the card

#### Returns

`string`

ays will be 'Import'

#### Implementation of

Card.getId

#### Overrides

BaseCard.getId

___

### getFilters

▸ **getFilters**(): `ImportFilter`[]

returns the filters to be shown in the DropBox component

#### Returns

`ImportFilter`[]

Filters as currently supported by the service

___

### getTitle

▸ **getTitle**(): `string`

returns the title of the card

#### Returns

`string`

'Import Workout'

___

### getDisplayProperties

▸ **getDisplayProperties**(): [`WorkoutImportProps`](../interfaces/WorkoutImportProps.md)

returns the information required to render a card in the Workout list

#### Returns

[`WorkoutImportProps`](../interfaces/WorkoutImportProps.md)

Object containing title and the filters

#### Implementation of

Card.getDisplayProperties

#### Overrides

BaseCard.getDisplayProperties
