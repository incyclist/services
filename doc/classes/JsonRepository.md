[incyclist-services - v1.2.2](../README.md) / JsonRepository

# Class: JsonRepository

## Table of contents

### Constructors

- [constructor](JsonRepository.md#constructor)

### Methods

- [getPath](JsonRepository.md#getpath)
- [getName](JsonRepository.md#getname)
- [write](JsonRepository.md#write)
- [read](JsonRepository.md#read)
- [delete](JsonRepository.md#delete)
- [list](JsonRepository.md#list)
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

### getPath

▸ **getPath**(): `string`

#### Returns

`string`

___

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

### list

▸ **list**(`exclude?`): `Promise`\<`string`[]\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `exclude?` | `string` \| `string`[] |

#### Returns

`Promise`\<`string`[]\>

___

### create

▸ **create**(`repoName`): [`JsonRepository`](JsonRepository.md)

#### Parameters

| Name | Type |
| :------ | :------ |
| `repoName` | `string` |

#### Returns

[`JsonRepository`](JsonRepository.md)
