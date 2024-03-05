[incyclist-services - v1.2.2](../README.md) / RemoteFitConverter

# Class: RemoteFitConverter

Class responsible for converting activity data into FIT (Flexible and Interoperable Data Transfer) 

As the FIT SDK for encoding is not available in JavaScript/TypeScript, we are using a microservice via REST API
which does the actual encoding into FIT format.

## Table of contents

### Constructors

- [constructor](RemoteFitConverter.md#constructor)

### Methods

- [convert](RemoteFitConverter.md#convert)

## Constructors

### constructor

• **new RemoteFitConverter**(): [`RemoteFitConverter`](RemoteFitConverter.md)

#### Returns

[`RemoteFitConverter`](RemoteFitConverter.md)

## Methods

### convert

▸ **convert**(`activity`): `Promise`\<`ArrayBuffer`\>

Converts the provided activity data into FIT format using a remote API.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `activity` | [`ActivityDetails`](../interfaces/ActivityDetails.md) | The activity data to convert. |

#### Returns

`Promise`\<`ArrayBuffer`\>

A promise resolving to the FIT formatted binary data.

**`Throws`**

Thrown if an error occurs during the conversion process.
