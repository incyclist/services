[incyclist-services - v1.2.2](../README.md) / IJsonRepositoryBinding

# Interface: IJsonRepositoryBinding

## Implemented by

- [`AbstractJsonRepositoryBinding`](../classes/AbstractJsonRepositoryBinding.md)

## Table of contents

### Methods

- [create](IJsonRepositoryBinding.md#create)
- [get](IJsonRepositoryBinding.md#get)
- [release](IJsonRepositoryBinding.md#release)
- [getPath](IJsonRepositoryBinding.md#getpath)

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

___

### getPath

▸ **getPath**(`name`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`string`
