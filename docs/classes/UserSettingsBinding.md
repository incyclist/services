[incyclist-services](../README.md) / UserSettingsBinding

# Class: UserSettingsBinding

## Implements

- [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md)

## Table of contents

### Constructors

- [constructor](UserSettingsBinding.md#constructor)

### Methods

- [getAll](UserSettingsBinding.md#getall)
- [save](UserSettingsBinding.md#save)
- [set](UserSettingsBinding.md#set)
- [getInstance](UserSettingsBinding.md#getinstance)

## Constructors

### constructor

• **new UserSettingsBinding**()

## Methods

### getAll

▸ `Abstract` **getAll**(): `Promise`<`any`\>

#### Returns

`Promise`<`any`\>

#### Implementation of

[IUserSettingsBinding](../interfaces/IUserSettingsBinding.md).[getAll](../interfaces/IUserSettingsBinding.md#getall)

#### Defined in

[src/settings/user/bindings/types.ts:13](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/bindings/types.ts#L13)

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

#### Defined in

[src/settings/user/bindings/types.ts:15](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/bindings/types.ts#L15)

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

#### Defined in

[src/settings/user/bindings/types.ts:14](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/bindings/types.ts#L14)

___

### getInstance

▸ `Static` **getInstance**(): [`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md)

#### Returns

[`IUserSettingsBinding`](../interfaces/IUserSettingsBinding.md)

#### Defined in

[src/settings/user/bindings/types.ts:10](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/bindings/types.ts#L10)
