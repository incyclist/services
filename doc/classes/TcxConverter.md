[incyclist-services - v1.2.2](../README.md) / TcxConverter

# Class: TcxConverter

Class responsible for converting activity data into TCX (Training Center XML) format.

**`Implements`**

## Implements

- `IActivityConverter`

## Table of contents

### Constructors

- [constructor](TcxConverter.md#constructor)

### Methods

- [convert](TcxConverter.md#convert)

## Constructors

### constructor

• **new TcxConverter**(): [`TcxConverter`](TcxConverter.md)

#### Returns

[`TcxConverter`](TcxConverter.md)

## Methods

### convert

▸ **convert**(`activity`): `Promise`\<`string`\>

Converts the provided activity data into TCX format.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `activity` | [`ActivityDetails`](../interfaces/ActivityDetails.md) | The activity data to convert. |

#### Returns

`Promise`\<`string`\>

A promise resolving to the TCX formatted XML string.

**`Throws`**

Thrown if an error occurs during the conversion process.

#### Implementation of

IActivityConverter.convert
