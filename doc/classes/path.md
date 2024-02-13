[incyclist-services - v1.1.98](../README.md) / path

# Class: path

## Table of contents

### Constructors

- [constructor](path.md#constructor)

### Properties

- [\_binding](path.md#_binding)

### Methods

- [initBinding](path.md#initbinding)
- [join](path.md#join)
- [parse](path.md#parse)

## Constructors

### constructor

• **new path**(): [`path`](path.md)

#### Returns

[`path`](path.md)

## Properties

### \_binding

▪ `Static` **\_binding**: [`IPathBinding`](../interfaces/IPathBinding.md) = `undefined`

## Methods

### initBinding

▸ **initBinding**(`binding`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `binding` | [`IPathBinding`](../interfaces/IPathBinding.md) |

#### Returns

`void`

___

### join

▸ **join**(`...paths`): `string`

#### Parameters

| Name | Type |
| :------ | :------ |
| `...paths` | `string`[] |

#### Returns

`string`

___

### parse

▸ **parse**(`path`): `ParsedPath`

#### Parameters

| Name | Type |
| :------ | :------ |
| `path` | `string` |

#### Returns

`ParsedPath`
