[incyclist-services - v1.0.4](../README.md) / UserSettingsBinding

# Class: UserSettingsBinding

## Implements

- [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md)

## Table of contents

### Constructors

- [constructor](UserSettingsBinding.md#constructor)

### Methods

- [canOverwrite](UserSettingsBinding.md#canoverwrite)
- [getAll](UserSettingsBinding.md#getall)
- [save](UserSettingsBinding.md#save)
- [set](UserSettingsBinding.md#set)
- [getInstance](UserSettingsBinding.md#getinstance)

## Constructors

### constructor

• **new UserSettingsBinding**()

## Methods

### canOverwrite

▸ `Abstract` **canOverwrite**(): `boolean`

#### Returns

`boolean`

#### Implementation of

[IUserSettingsBinding](../interfaces/IUserSettingsBinding.md).[canOverwrite](../interfaces/IUserSettingsBinding.md#canoverwrite)

___

### getAll

▸ `Abstract` **getAll**(): `Promise`<`any`\>

#### Returns

`Promise`<`any`\>

#### Implementation of

[IUserSettingsBinding](../interfaces/IUserSettingsBinding.md).[getAll](../interfaces/IUserSettingsBinding.md#getall)

___

### save

▸ `Abstract` **save**(`settings`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `settings` | `any` |

#### Returns

`Promise`<`boolean`\>

#### Implementation of

[IUserSettingsBinding](../interfaces/IUserSettingsBinding.md).[save](../interfaces/IUserSettingsBinding.md#save)

___

### set

▸ `Abstract` **set**(`key`, `value`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `value` | `any` |

#### Returns

`Promise`<`boolean`\>

#### Implementation of

[IUserSettingsBinding](../interfaces/IUserSettingsBinding.md).[set](../interfaces/IUserSettingsBinding.md#set)

___

### getInstance

▸ `Static` **getInstance**(): [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md)

#### Returns

[`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md)
