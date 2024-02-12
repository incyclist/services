[incyclist-services - v1.1.97](../README.md) / WorkoutCardDisplayProperties

# Interface: WorkoutCardDisplayProperties

## Table of contents

### Properties

- [title](WorkoutCardDisplayProperties.md#title)
- [workout](WorkoutCardDisplayProperties.md#workout)
- [ftp](WorkoutCardDisplayProperties.md#ftp)
- [duration](WorkoutCardDisplayProperties.md#duration)
- [canDelete](WorkoutCardDisplayProperties.md#candelete)
- [visible](WorkoutCardDisplayProperties.md#visible)
- [selected](WorkoutCardDisplayProperties.md#selected)
- [observer](WorkoutCardDisplayProperties.md#observer)

## Properties

### title

• **title**: `string`

title to be shown on card

___

### workout

• **workout**: [`Workout`](../classes/Workout.md)

the whole workout objct (so that graph can be rendered)

___

### ftp

• **ftp**: `number`

FTP settings to be used during rendering

___

### duration

• **duration**: `string`

The duration of the workout

___

### canDelete

• **canDelete**: `boolean`

identifies if a delete button can be shown

___

### visible

• **visible**: `boolean`

identifies if the card is visible(true) or hidden(false)

___

### selected

• **selected**: `boolean`

identifies if the workout was selected for the next ride

___

### observer

• **observer**: `Observer`

observer Object that will be used to informa abotu relevant updates
