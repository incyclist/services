[incyclist-services - v1.1.98](../README.md) / UserSettingsService

# Class: UserSettingsService

## Table of contents

### Constructors

- [constructor](UserSettingsService.md#constructor)

### Properties

- [settings](UserSettingsService.md#settings)
- [binding](UserSettingsService.md#binding)
- [logger](UserSettingsService.md#logger)
- [isInitialized](UserSettingsService.md#isinitialized)
- [isDirty](UserSettingsService.md#isdirty)
- [savePromise](UserSettingsService.md#savepromise)
- [instanceId](UserSettingsService.md#instanceid)
- [initPromise](UserSettingsService.md#initpromise)
- [observers](UserSettingsService.md#observers)
- [\_instance](UserSettingsService.md#_instance)
- [\_defaultBinding](UserSettingsService.md#_defaultbinding)

### Methods

- [setBinding](UserSettingsService.md#setbinding)
- [init](UserSettingsService.md#init)
- [getAll](UserSettingsService.md#getall)
- [get](UserSettingsService.md#get)
- [set](UserSettingsService.md#set)
- [requestNotifyOnChange](UserSettingsService.md#requestnotifyonchange)
- [stopNotifyOnChange](UserSettingsService.md#stopnotifyonchange)
- [update](UserSettingsService.md#update)
- [updateSettings](UserSettingsService.md#updatesettings)
- [save](UserSettingsService.md#save)
- [onAppClose](UserSettingsService.md#onappclose)
- [getInstance](UserSettingsService.md#getinstance)
- [setDefaultBinding](UserSettingsService.md#setdefaultbinding)

## Constructors

### constructor

• **new UserSettingsService**(`binding?`): [`UserSettingsService`](UserSettingsService.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `binding?` | [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md) |

#### Returns

[`UserSettingsService`](UserSettingsService.md)

## Properties

### settings

• **settings**: `any`

___

### binding

• **binding**: [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md)

___

### logger

• **logger**: `default`

___

### isInitialized

• **isInitialized**: `boolean`

___

### isDirty

• **isDirty**: `boolean`

___

### savePromise

• **savePromise**: `Promise`\<`boolean`\>

___

### instanceId

• **instanceId**: `number`

___

### initPromise

• **initPromise**: `Promise`\<`boolean`\>

___

### observers

• **observers**: \{ `id`: `string` ; `key`: `string` ; `observer`: `Observer`  }[] = `[]`

___

### \_instance

▪ `Static` **\_instance**: [`UserSettingsService`](UserSettingsService.md)

___

### \_defaultBinding

▪ `Static` **\_defaultBinding**: [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md)

## Methods

### setBinding

▸ **setBinding**(`binding`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `binding` | [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md) |

#### Returns

`void`

___

### init

▸ **init**(): `Promise`\<`boolean`\>

#### Returns

`Promise`\<`boolean`\>

___

### getAll

▸ **getAll**(): `any`

#### Returns

`any`

___

### get

▸ **get**(`key`, `defValue`): `any`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `defValue` | `any` |

#### Returns

`any`

___

### set

▸ **set**(`key`, `value`, `save?`): `void`

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `key` | `string` | `undefined` |
| `value` | `any` | `undefined` |
| `save` | `boolean` | `true` |

#### Returns

`void`

___

### requestNotifyOnChange

▸ **requestNotifyOnChange**(`requesterId`, `key`): `Observer`

#### Parameters

| Name | Type |
| :------ | :------ |
| `requesterId` | `string` |
| `key` | `string` |

#### Returns

`Observer`

___

### stopNotifyOnChange

▸ **stopNotifyOnChange**(`requesterId`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `requesterId` | `string` |

#### Returns

`void`

___

### update

▸ **update**(`data`): `Promise`\<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `any` |

#### Returns

`Promise`\<`boolean`\>

___

### updateSettings

▸ **updateSettings**(`data`): `Promise`\<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `any` |

#### Returns

`Promise`\<`boolean`\>

___

### save

▸ **save**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

___

### onAppClose

▸ **onAppClose**(): `Promise`\<`void`\>

#### Returns

`Promise`\<`void`\>

___

### getInstance

▸ **getInstance**(): [`UserSettingsService`](UserSettingsService.md)

#### Returns

[`UserSettingsService`](UserSettingsService.md)

___

### setDefaultBinding

▸ **setDefaultBinding**(`binding`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `binding` | [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md) |

#### Returns

`void`
