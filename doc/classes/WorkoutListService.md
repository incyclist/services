[incyclist-services - v1.1.98](../README.md) / WorkoutListService

# Class: WorkoutListService

[WorkoutListService](WorkoutListService.md) is the service managing the business flows of the Workout List page and the Workout Area in the settings dialog

The service will take care of the following functionality
- provide the content for lists to be displayed on the page
- provide the content to be displyed in the Workout Setings dialog (i.e. dialog shown before staring a workout)
- manage selection/unselection and keep track of state
- provide capability to import workouts
- sync data with local databse

This service depends on
 - UserSettings Service  (to store and retrieve the default Workout settings in the user preferecce)
 - RouteList Service     (to check if a route has been selected)

## Hierarchy

- `IncyclistService`

  ↳ **`WorkoutListService`**

## Implements

- `IListService`\<[`Workout`](Workout.md) \| [`Plan`](Plan.md)\>

## Table of contents

### Constructors

- [constructor](WorkoutListService.md#constructor)

### Methods

- [setLanguage](WorkoutListService.md#setlanguage)
- [getLanguage](WorkoutListService.md#getlanguage)
- [getSelected](WorkoutListService.md#getselected)
- [setScreenProps](WorkoutListService.md#setscreenprops)
- [getScreenProps](WorkoutListService.md#getscreenprops)
- [open](WorkoutListService.md#open)
- [close](WorkoutListService.md#close)
- [openSettings](WorkoutListService.md#opensettings)
- [getStartSettings](WorkoutListService.md#getstartsettings)
- [setStartSettings](WorkoutListService.md#setstartsettings)
- [onResize](WorkoutListService.md#onresize)
- [onCarouselInitialized](WorkoutListService.md#oncarouselinitialized)
- [onCarouselUpdated](WorkoutListService.md#oncarouselupdated)
- [preload](WorkoutListService.md#preload)
- [import](WorkoutListService.md#import)
- [addList](WorkoutListService.md#addlist)
- [getLists](WorkoutListService.md#getlists)
- [emitLists](WorkoutListService.md#emitlists)
- [unselect](WorkoutListService.md#unselect)
- [select](WorkoutListService.md#select)
- [selectCard](WorkoutListService.md#selectcard)
- [unselectCard](WorkoutListService.md#unselectcard)
- [moveCard](WorkoutListService.md#movecard)
- [canDisplayStart](WorkoutListService.md#candisplaystart)

## Constructors

### constructor

• **new WorkoutListService**(): [`WorkoutListService`](WorkoutListService.md)

#### Returns

[`WorkoutListService`](WorkoutListService.md)

#### Overrides

IncyclistService.constructor

## Methods

### setLanguage

▸ **setLanguage**(`language`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `language` | `string` |

#### Returns

`void`

___

### getLanguage

▸ **getLanguage**(): `string`

#### Returns

`string`

___

### getSelected

▸ **getSelected**(): [`Workout`](Workout.md)

#### Returns

[`Workout`](Workout.md)

___

### setScreenProps

▸ **setScreenProps**(`props`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `props` | `any` |

#### Returns

`void`

___

### getScreenProps

▸ **getScreenProps**(): `any`

#### Returns

`any`

___

### open

▸ **open**(): `Object`

This method should be called by the Workout Page UI to receive the content to be displayed on the page

#### Returns

`Object`

observer: an Observer object that will be used to inform the UI about relevant changes, so that it can re-render

lists: the content of the lists to be displayed

| Name | Type |
| :------ | :------ |
| `observer` | `ListObserver`\<`WP`\> |
| `lists` | `CardList`\<`WP`\>[] |

**`Emits`**

started   observer just has been created

**`Emits`**

loading   list is being loaded

**`Emits`**

loaded    loading has been completed, provides lists as parameter

**`Emits`**

updated   lists have been updated, provides lists as first parameter, provides a hash as 2nd paramter (allows UI to only refresh if hash has changed)

``` typescript
// .... React Imports 
import {useWorkoutList} from 'incyclist-services';

const page = ()=> {
   const service = useWorkoutList()
   const [state,setState] = useState({})
   
   useRef( ()=>{
      if (state.initialized)
         return;

      const {observer,lists} = service.open()
      if (observer) {
         observer
             .on('started',()=>{ 
                 setState( current=> ({...current,lists,loading:false}))
              })
             .on('updated',(update)=>{
                 setState( current=> ({...current,lists:update,loading:false}))
              })
             .on('loading',()=>{
                 setState( current=> ({...current,loading:true}))
              })
             .on('loaded',(update)=>{
                 setState( current=> ({...current,lists:update,loading:false}))
              })
      }
      setState( {observer,lists,initialized:true})
   })
   
   if (!state?.lists?.length)
        retrurn <EmptyPage/>

   return ( 
      { !state?.lists.map( l=> 
             .... 
      }
   )
}

```

___

### close

▸ **close**(): `void`

This method should be called by the Workout Page UI when it closes the page

all necessary cleanup activities will be done

#### Returns

`void`

#### Implementation of

IListService.close

___

### openSettings

▸ **openSettings**(): `WorkoutSettingsDisplayProps`

This method provides content and implements business logic for the Workout section in the Settings dialog

#### Returns

`WorkoutSettingsDisplayProps`

observer: an Observer object that will be used to inform the UI about relevant changes, so that it can re-render

workouts: the workouts to be displayed

selected: the workout that was selected ( or currently is in use)

settings: the settings to be used/currently being used for the workout

**`Emits`**

started   observer just has been created

**`Emits`**

loading   list is being loaded

**`Emits`**

loaded    loading has been completed, provides lists as parameter

___

### getStartSettings

▸ **getStartSettings**(): [`WorkoutSettings`](../interfaces/WorkoutSettings.md)

returns the Settings ( FTP and forced ERGMode on/off) for the workout

#### Returns

[`WorkoutSettings`](../interfaces/WorkoutSettings.md)

the settings that will be applied once a workout will be started/resumed

___

### setStartSettings

▸ **setStartSettings**(`settings`): `void`

changes the Settings ( FTP and forced ERGMode on/off) for the workout

The FTP will overrule the FTP from the user settings, 
unless the FTP is changed in the user settings. In that case, the new value from the user settings will be taken

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `settings` | [`WorkoutSettings`](../interfaces/WorkoutSettings.md) | new settings to be applied |

#### Returns

`void`

___

### onResize

▸ **onResize**(): `void`

handles the UI resize event

should be called everytime the UI needs to resize
As a resize triggers a re-render of the carousels, this will make the cards invisible (to speed up rendering)

#### Returns

`void`

___

### onCarouselInitialized

▸ **onCarouselInitialized**(`list`, `item`, `itemsInSlide`): `void`

is called by the carousel, when initial rendering of a carousel has been done

this will change all cards "within the fold" to visible, which will trigger re-rendering of these cards (not the whole carousel)
also the next 2 cards will be made visible, so that immediate scrolling will not deliver empty divs

after 1s all other cards will be made visible

#### Parameters

| Name | Type |
| :------ | :------ |
| `list` | `CardList`\<`WP`\> |
| `item` | `any` |
| `itemsInSlide` | `any` |

#### Returns

`void`

___

### onCarouselUpdated

▸ **onCarouselUpdated**(`list`, `item`, `itemsInSlide`): `void`

is called by the carousel, when carousel has been updated

all cards will be made visible

#### Parameters

| Name | Type |
| :------ | :------ |
| `list` | `any` |
| `item` | `any` |
| `itemsInSlide` | `any` |

#### Returns

`void`

___

### preload

▸ **preload**(): `PromiseObserver`\<`void`\>

triggers the loading of the workouts from repo/api

this method will be called internally when [[open]] or [[openSettings]] will be called

However, it should also be called by the UI as soon as possible to reduce loading time for the user

#### Returns

`PromiseObserver`\<`void`\>

observer to signal events that mith require re-render

**`Emits`**

loading   list is being loaded

**`Emits`**

loaded    loading has been completed, provides lists as parameter

___

### import

▸ **import**(`info`, `props`): `void`

perform an import of one or multiple workout file(s) from disk or URL

This method will not only perform the actual import, but also has implemented business logic to give the user feedback 
- Adding an [[ActiveImportCard]] while import is in progress
- Adding a card for the imported workout(s) 
- Removing the [[ActiveImportCard]] in case the import was successfull
- Updating the [[ActiveImportCard]] with error information in case the import has failed

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `info` | [`FileInfo`](../interfaces/FileInfo.md) \| [`FileInfo`](../interfaces/FileInfo.md)[] | provides information on the source of the file(s) to be imported |
| `props` | `Object` | - |
| `props.card?` | `ActiveImportCard` | In case of a retry, contains the [[ActiveImportCard]] that shows the previous import |
| `props.showImportCards?` | `boolean` | flag that indicates if [[ActiveImportCard]] should be shown ( default=true) |

#### Returns

`void`

**`Emits`**

updated   list has been updated

___

### addList

▸ **addList**(`name`): `CardList`\<`WP`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`CardList`\<`WP`\>

___

### getLists

▸ **getLists**(`forUi?`): `CardList`\<`WP`\>[]

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `forUi` | `boolean` | `true` |

#### Returns

`CardList`\<`WP`\>[]

#### Implementation of

IListService.getLists

___

### emitLists

▸ **emitLists**(`event`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | ``"loaded"`` \| ``"updated"`` |

#### Returns

`void`

___

### unselect

▸ **unselect**(): `void`

#### Returns

`void`

___

### select

▸ **select**(`workout`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `workout` | `WP` |

#### Returns

`void`

___

### selectCard

▸ **selectCard**(`card`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `card` | `Card`\<`WP`\> |

#### Returns

`void`

___

### unselectCard

▸ **unselectCard**(`card`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `card` | `Card`\<`WP`\> |

#### Returns

`void`

___

### moveCard

▸ **moveCard**(`card`, `source`, `target`): `CardList`\<`WP`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `card` | `Card`\<`WP`\> |
| `source` | `CardList`\<`WP`\> |
| `target` | `string` \| `CardList`\<`WP`\> |

#### Returns

`CardList`\<`WP`\>

___

### canDisplayStart

▸ **canDisplayStart**(): `boolean`

#### Returns

`boolean`
