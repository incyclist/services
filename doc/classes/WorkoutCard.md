[incyclist-services - v1.1.98](../README.md) / WorkoutCard

# Class: WorkoutCard

[WorkoutCard](WorkoutCard.md) objects are used to represent a single workout in the workout list

## Hierarchy

- `BaseCard`

  ↳ **`WorkoutCard`**

## Implements

- `Card`\<[`Workout`](Workout.md)\>

## Table of contents

### Constructors

- [constructor](WorkoutCard.md#constructor)

### Methods

- [openSettings](WorkoutCard.md#opensettings)
- [select](WorkoutCard.md#select)
- [unselect](WorkoutCard.md#unselect)
- [move](WorkoutCard.md#move)
- [save](WorkoutCard.md#save)
- [delete](WorkoutCard.md#delete)
- [getId](WorkoutCard.md#getid)
- [getTitle](WorkoutCard.md#gettitle)
- [update](WorkoutCard.md#update)
- [getData](WorkoutCard.md#getdata)
- [getCardType](WorkoutCard.md#getcardtype)
- [getDisplayProperties](WorkoutCard.md#getdisplayproperties)
- [enableDelete](WorkoutCard.md#enabledelete)
- [canDelete](WorkoutCard.md#candelete)
- [setVisible](WorkoutCard.md#setvisible)

## Constructors

### constructor

• **new WorkoutCard**(`workout`, `props?`): [`WorkoutCard`](WorkoutCard.md)

Creates a new WorkoutCard object

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `workout` | [`Workout`](Workout.md) | The workout to be represented by this card |
| `props?` | `Object` | - |
| `props.list?` | `CardList`\<[`Workout`](Workout.md)\> | The list that cntains the card |

#### Returns

[`WorkoutCard`](WorkoutCard.md)

#### Overrides

BaseCard.constructor

## Methods

### openSettings

▸ **openSettings**(): [`WorkoutSettingsDisplayProps`](../interfaces/WorkoutSettingsDisplayProps.md)

should be called by the UI, when the Workout Settings (Details Dialog will be shown)

This class will manage the state and will return the information that is required
to render the Dialog

#### Returns

[`WorkoutSettingsDisplayProps`](../interfaces/WorkoutSettingsDisplayProps.md)

___

### select

▸ **select**(`settings?`): `void`

marks the workout as selected

This workout should then be used during the next ride

#### Parameters

| Name | Type |
| :------ | :------ |
| `settings?` | [`WorkoutSettings`](../interfaces/WorkoutSettings.md) |

#### Returns

`void`

**`Emits`**

update  Update is fired, so that card view can refresh ( to update select state)

#### Implementation of

Card.select

#### Overrides

BaseCard.select

___

### unselect

▸ **unselect**(): `void`

marks the workout as _not_ selected

#### Returns

`void`

**`Emits`**

update  Update is fired, so that card view can refresh ( to update select state)

#### Implementation of

Card.unselect

#### Overrides

BaseCard.unselect

___

### move

▸ **move**(`targetListName`): `void`

moves the workout into a different list

this change will also be represented in the _category_ member and the workout will be updated in the local database

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `targetListName` | `string` | name of the list the card should be added to |

#### Returns

`void`

___

### save

▸ **save**(): `Promise`\<`void`\>

saves the workout into the local database

#### Returns

`Promise`\<`void`\>

___

### delete

▸ **delete**(): `PromiseObserver`\<`boolean`\>

deletes the workout from display and database

In case the workout was currently selected, it will unselect it before deleting

#### Returns

`PromiseObserver`\<`boolean`\>

#### Implementation of

Card.delete

#### Overrides

BaseCard.delete

___

### getId

▸ **getId**(): `string`

returns a unique ID of the workout

#### Returns

`string`

unique ID

#### Implementation of

Card.getId

#### Overrides

BaseCard.getId

___

### getTitle

▸ **getTitle**(): `string`

returns the title of the card

#### Returns

`string`

the name of the workout

___

### update

▸ **update**(`workout`): `void`

updates the content of the card

The card content will be changed and the updated workout will be saved in the the local database

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `workout` | [`Workout`](Workout.md) | The update workout |

#### Returns

`void`

**`Emits`**

update event to trigger re-rendering of card view

___

### getData

▸ **getData**(): [`Workout`](Workout.md)

returns the workout that is represented by this card

#### Returns

[`Workout`](Workout.md)

The workout represented by this card

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

always will be 'Workout'

#### Implementation of

Card.getCardType

#### Overrides

BaseCard.getCardType

___

### getDisplayProperties

▸ **getDisplayProperties**(): [`WorkoutCardDisplayProperties`](../interfaces/WorkoutCardDisplayProperties.md)

returns the information required to render a card in the Workout list

#### Returns

[`WorkoutCardDisplayProperties`](../interfaces/WorkoutCardDisplayProperties.md)

#### Implementation of

Card.getDisplayProperties

#### Overrides

BaseCard.getDisplayProperties

___

### enableDelete

▸ **enableDelete**(`enabled?`): `void`

enables/disables deletion of the workout

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `enabled?` | `boolean` | `true` | true if deletion shoudl be enabled, false otherwise |

#### Returns

`void`

___

### canDelete

▸ **canDelete**(): `boolean`

returns if workout can be deleted

#### Returns

`boolean`

if workout can be deleted

___

### setVisible

▸ **setVisible**(`visible`): `void`

marks the card to be visible/hidden

__note__ In the carousel display, whenever the complete carousel needs to be re-rendered, 
all cards will be initially be hidden (so that the renderer can complete faster - especially on large lists)
Once the initial rendering is done, the cards will be made visible, 
which however will not require a full page/carousel render, but will only update the div containing the card

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `visible` | `boolean` | card should be visible(true) or hidden(false) |

#### Returns

`void`

**`Emits`**

update event to trigger re-render [[WorkoutCardDisplayProperties]] as argument

#### Implementation of

Card.setVisible

#### Overrides

BaseCard.setVisible
