[incyclist-services - v1.1.95](../README.md) / IUserSettingsBinding

# Interface: IUserSettingsBinding

## Implemented by

- [`UserSettingsBinding`](../classes/UserSettingsBinding.md)

## Table of contents

### Methods

- [getAll](IUserSettingsBinding.md#getall)
- [set](IUserSettingsBinding.md#set)
- [save](IUserSettingsBinding.md#save)
- [canOverwrite](IUserSettingsBinding.md#canoverwrite)

## Methods

### getAll

▸ **getAll**(): `Promise`\<`any`\>

#### Returns

`Promise`\<`any`\>

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

___

### canOverwrite

▸ **canOverwrite**(): `boolean`

#### Returns

`boolean`
