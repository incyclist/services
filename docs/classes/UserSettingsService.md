[incyclist-services](../README.md) / UserSettingsService

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

#### Defined in

[src/settings/user/service.ts:30](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L30)

## Properties

### binding

• **binding**: [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md)

#### Defined in

[src/settings/user/service.ts:16](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L16)

___

### isDirty

• **isDirty**: `boolean`

#### Defined in

[src/settings/user/service.ts:19](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L19)

___

### isInitialized

• **isInitialized**: `boolean`

#### Defined in

[src/settings/user/service.ts:18](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L18)

___

### logger

• **logger**: `default`

#### Defined in

[src/settings/user/service.ts:17](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L17)

___

### savePromise

• **savePromise**: `Promise`<`boolean`\>

#### Defined in

[src/settings/user/service.ts:20](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L20)

___

### settings

• **settings**: `any`

#### Defined in

[src/settings/user/service.ts:15](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L15)

___

### \_instance

▪ `Static` **\_instance**: [`UserSettingsService`](UserSettingsService.md)

#### Defined in

[src/settings/user/service.ts:13](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L13)

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

#### Defined in

[src/settings/user/service.ts:63](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L63)

___

### init

▸ **init**(): `Promise`<`boolean`\>

#### Returns

`Promise`<`boolean`\>

#### Defined in

[src/settings/user/service.ts:44](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L44)

___

### save

▸ **save**(): `Promise`<`void`\>

#### Returns

`Promise`<`void`\>

#### Defined in

[src/settings/user/service.ts:160](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L160)

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

#### Defined in

[src/settings/user/service.ts:93](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L93)

___

### setBinding

▸ **setBinding**(`binding`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `binding` | [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md) |

#### Returns

`void`

#### Defined in

[src/settings/user/service.ts:39](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L39)

___

### update

▸ **update**(`data`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `any` |

#### Returns

`Promise`<`boolean`\>

#### Defined in

[src/settings/user/service.ts:141](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L141)

___

### updateSettings

▸ **updateSettings**(`data`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `data` | `any` |

#### Returns

`Promise`<`boolean`\>

#### Defined in

[src/settings/user/service.ts:145](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L145)

___

### getInstance

▸ `Static` **getInstance**(): [`UserSettingsService`](UserSettingsService.md)

#### Returns

[`UserSettingsService`](UserSettingsService.md)

#### Defined in

[src/settings/user/service.ts:23](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/service.ts#L23)
