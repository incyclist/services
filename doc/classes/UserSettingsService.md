[incyclist-services - v1.0.0](../README.md) / UserSettingsService

# Class: UserSettingsService

## Table of contents

### Constructors

- [constructor](UserSettingsService.md#constructor)

### Properties

- [binding](UserSettingsService.md#binding)
- [isDirty](UserSettingsService.md#isdirty)
- [isInitialized](UserSettingsService.md#isinitialized)
- [logger](UserSettingsService.md#logger)
- [savePromise](UserSettingsService.md#savepromise)
- [settings](UserSettingsService.md#settings)
- [\_instance](UserSettingsService.md#_instance)

### Methods

- [get](UserSettingsService.md#get)
- [getAll](UserSettingsService.md#getall)
- [init](UserSettingsService.md#init)
- [save](UserSettingsService.md#save)
- [set](UserSettingsService.md#set)
- [setBinding](UserSettingsService.md#setbinding)
- [update](UserSettingsService.md#update)
- [updateSettings](UserSettingsService.md#updatesettings)
- [getInstance](UserSettingsService.md#getinstance)

## Constructors

### constructor

• **new UserSettingsService**()

## Properties

### binding

• **binding**: [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md)

___

### isDirty

• **isDirty**: `boolean`

___

### isInitialized

• **isInitialized**: `boolean`

___

### logger

• **logger**: `default`

___

### savePromise

• **savePromise**: `Promise`<`boolean`\>

___

### settings

• **settings**: `any`

___

### \_instance

▪ `Static` **\_instance**: [`UserSettingsService`](UserSettingsService.md)

## Methods

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

### getAll

▸ **getAll**(): `any`

#### Returns

`any`

___

### init

▸ **init**(): `Promise`<`boolean`\>

#### Returns

`Promise`<`boolean`\>

___

### save

▸ **save**(): `Promise`<`void`\>

#### Returns

`Promise`<`void`\>

___

### set

▸ **set**(`key`, `value`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `value` | `any` |

#### Returns

`void`

___

### setBinding

▸ **setBinding**(`binding`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `binding` | [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md) |

#### Returns

`void`

___

### update

▸ **update**(`data`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `any` |

#### Returns

`Promise`<`boolean`\>

___

### updateSettings

▸ **updateSettings**(`data`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `any` |

#### Returns

`Promise`<`boolean`\>

___

### getInstance

▸ `Static` **getInstance**(): [`UserSettingsService`](UserSettingsService.md)

#### Returns

[`UserSettingsService`](UserSettingsService.md)
