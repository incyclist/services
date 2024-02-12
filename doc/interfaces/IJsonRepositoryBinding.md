[incyclist-services - v1.1.97](../README.md) / IJsonRepositoryBinding

# Interface: IJsonRepositoryBinding

## Implemented by

- [`AbstractJsonRepositoryBinding`](../classes/AbstractJsonRepositoryBinding.md)

## Table of contents

### Methods

- [create](IJsonRepositoryBinding.md#create)
- [get](IJsonRepositoryBinding.md#get)
- [release](IJsonRepositoryBinding.md#release)

## Methods

### create

▸ **create**(`name`): `Promise`\<[`JsonAccess`](../README.md#jsonaccess)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`Promise`\<[`JsonAccess`](../README.md#jsonaccess)\>

___

### get

▸ **get**(`name`): `Promise`\<[`JsonAccess`](../README.md#jsonaccess)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`Promise`\<[`JsonAccess`](../README.md#jsonaccess)\>

___

### release

▸ **release**(`name`): `Promise`\<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`Promise`\<`boolean`\>
