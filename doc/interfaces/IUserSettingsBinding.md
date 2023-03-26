[incyclist-services - v1.0.4](../README.md) / IUserSettingsBinding

# Interface: IUserSettingsBinding

## Implemented by

- [`UserSettingsBinding`](../classes/UserSettingsBinding.md)

## Table of contents

### Methods

- [canOverwrite](IUserSettingsBinding.md#canoverwrite)
- [getAll](IUserSettingsBinding.md#getall)
- [save](IUserSettingsBinding.md#save)
- [set](IUserSettingsBinding.md#set)

## Methods

### canOverwrite

▸ **canOverwrite**(): `boolean`

#### Returns

`boolean`

___

### getAll

▸ **getAll**(): `Promise`<`any`\>

#### Returns

`Promise`<`any`\>

___

### save

▸ **save**(`settings`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `settings` | `any` |

#### Returns

`Promise`<`boolean`\>

___

### set

▸ **set**(`key`, `value`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `key` | `string` |
| `value` | `any` |

#### Returns

`Promise`<`boolean`\>
