[incyclist-services](../README.md) / IUserSettingsBinding

# Interface: IUserSettingsBinding

## Implemented by

- [`UserSettingsBinding`](../classes/UserSettingsBinding.md)

## Table of contents

### Methods

- [getAll](IUserSettingsBinding.md#getall)
- [save](IUserSettingsBinding.md#save)
- [set](IUserSettingsBinding.md#set)

## Methods

### getAll

▸ **getAll**(): `Promise`<`any`\>

#### Returns

`Promise`<`any`\>

#### Defined in

[src/settings/user/bindings/types.ts:4](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/bindings/types.ts#L4)

___

### save

▸ **save**(`settings`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `settings` | `any` |

#### Returns

`Promise`<`boolean`\>

#### Defined in

[src/settings/user/bindings/types.ts:6](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/bindings/types.ts#L6)

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

#### Defined in

[src/settings/user/bindings/types.ts:5](https://github.com/incyclist/services/blob/9ad4caf/src/settings/user/bindings/types.ts#L5)
