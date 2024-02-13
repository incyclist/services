[incyclist-services - v1.1.98](../README.md) / JsonRepository

# Class: JsonRepository

## Table of contents

### Constructors

- [constructor](JsonRepository.md#constructor)

### Methods

- [getName](JsonRepository.md#getname)
- [write](JsonRepository.md#write)
- [read](JsonRepository.md#read)
- [delete](JsonRepository.md#delete)
- [create](JsonRepository.md#create)

## Constructors

### constructor

• **new JsonRepository**(`repoName`): [`JsonRepository`](JsonRepository.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `repoName` | `string` |

#### Returns

[`JsonRepository`](JsonRepository.md)

## Methods

### getName

▸ **getName**(): `string`

#### Returns

`string`

___

### write

▸ **write**(`objectName`, `data`): `Promise`\<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `objectName` | `string` |
| `data` | [`JSONObject`](../README.md#jsonobject) |

#### Returns

`Promise`\<`boolean`\>

___

### read

▸ **read**(`objectName`): `Promise`\<[`JSONObject`](../README.md#jsonobject)\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `objectName` | `string` |

#### Returns

`Promise`\<[`JSONObject`](../README.md#jsonobject)\>

___

### delete

▸ **delete**(`objectName`): `Promise`\<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `objectName` | `string` |

#### Returns

`Promise`\<`boolean`\>

___

### create

▸ **create**(`repoName`): [`JsonRepository`](JsonRepository.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `repoName` | `string` |

#### Returns

[`JsonRepository`](JsonRepository.md)
