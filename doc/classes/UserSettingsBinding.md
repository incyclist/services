[incyclist-services - v1.1.95](../README.md) / UserSettingsBinding

# Class: UserSettingsBinding

## Implements

- [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md)

## Table of contents

### Constructors

- [constructor](UserSettingsBinding.md#constructor)

### Methods

- [getAll](UserSettingsBinding.md#getall)
- [set](UserSettingsBinding.md#set)
- [save](UserSettingsBinding.md#save)
- [canOverwrite](UserSettingsBinding.md#canoverwrite)
- [getInstance](UserSettingsBinding.md#getinstance)

## Constructors

### constructor

• **new UserSettingsBinding**(): [`UserSettingsBinding`](UserSettingsBinding.md)

#### Returns

[`UserSettingsBinding`](UserSettingsBinding.md)

## Methods

### getAll

▸ **getAll**(): `Promise`\<`any`\>

#### Returns

`Promise`\<`any`\>

#### Implementation of

[IUserSettingsBinding](../interfaces/IUserSettingsBinding.md).[getAll](../interfaces/IUserSettingsBinding.md#getall)

___

### set

▸ **set**(`key`, `value`): `Promise`\<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `value` | `any` |

#### Returns

`Promise`\<`boolean`\>

#### Implementation of

[IUserSettingsBinding](../interfaces/IUserSettingsBinding.md).[set](../interfaces/IUserSettingsBinding.md#set)

___

### save

▸ **save**(`settings`, `final?`): `Promise`\<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `settings` | `any` |
| `final?` | `boolean` |

#### Returns

`Promise`\<`boolean`\>

#### Implementation of

[IUserSettingsBinding](../interfaces/IUserSettingsBinding.md).[save](../interfaces/IUserSettingsBinding.md#save)

___

### canOverwrite

▸ **canOverwrite**(): `boolean`

#### Returns

`boolean`

#### Implementation of

[IUserSettingsBinding](../interfaces/IUserSettingsBinding.md).[canOverwrite](../interfaces/IUserSettingsBinding.md#canoverwrite)

___

### getInstance

▸ **getInstance**(): [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md)

#### Returns

[`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md)
