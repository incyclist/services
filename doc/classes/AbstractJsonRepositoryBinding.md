[incyclist-services - v1.1.95](../README.md) / AbstractJsonRepositoryBinding

# Class: AbstractJsonRepositoryBinding

## Implements

- [`IJsonRepositoryBinding`](../interfaces/IJsonRepositoryBinding.md)

## Table of contents

### Constructors

- [constructor](AbstractJsonRepositoryBinding.md#constructor)

### Methods

- [create](AbstractJsonRepositoryBinding.md#create)
- [get](AbstractJsonRepositoryBinding.md#get)
- [release](AbstractJsonRepositoryBinding.md#release)

## Constructors

### constructor

• **new AbstractJsonRepositoryBinding**(): [`AbstractJsonRepositoryBinding`](AbstractJsonRepositoryBinding.md)

#### Returns

[`AbstractJsonRepositoryBinding`](AbstractJsonRepositoryBinding.md)

## Methods

### create

▸ **create**(`name`): `Promise`\<[`JsonAccess`](../README.md#jsonaccess)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`Promise`\<[`JsonAccess`](../README.md#jsonaccess)\>

#### Implementation of

[IJsonRepositoryBinding](../interfaces/IJsonRepositoryBinding.md).[create](../interfaces/IJsonRepositoryBinding.md#create)

___

### get

▸ **get**(`name`): `Promise`\<[`JsonAccess`](../README.md#jsonaccess)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`Promise`\<[`JsonAccess`](../README.md#jsonaccess)\>

#### Implementation of

[IJsonRepositoryBinding](../interfaces/IJsonRepositoryBinding.md).[get](../interfaces/IJsonRepositoryBinding.md#get)

___

### release

▸ **release**(`name`): `Promise`\<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `name` | `string` |

#### Returns

`Promise`\<`boolean`\>

#### Implementation of

[IJsonRepositoryBinding](../interfaces/IJsonRepositoryBinding.md).[release](../interfaces/IJsonRepositoryBinding.md#release)
