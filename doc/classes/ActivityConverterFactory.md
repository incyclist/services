[incyclist-services - v1.2.2](../README.md) / ActivityConverterFactory

# Class: ActivityConverterFactory

Factory class responsible for managing converters who are converting activity data into different formats.

## Table of contents

### Constructors

- [constructor](ActivityConverterFactory.md#constructor)

### Methods

- [add](ActivityConverterFactory.md#add)
- [convert](ActivityConverterFactory.md#convert)

## Constructors

### constructor

• **new ActivityConverterFactory**(): [`ActivityConverterFactory`](ActivityConverterFactory.md)

Constructs an instance of ActivityConverterFactory.

#### Returns

[`ActivityConverterFactory`](ActivityConverterFactory.md)

## Methods

### add

▸ **add**(`format`, `converter`): `void`

Adds a new activity converter to the factory.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `format` | `string` | The format of the converter. |
| `converter` | `IActivityConverter` | The converter to add. |

#### Returns

`void`

___

### convert

▸ **convert**(`activity`, `targetFormat`): `Promise`\<`any`\>

Converts an activity to the specified target format.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `activity` | [`ActivityDetails`](../interfaces/ActivityDetails.md) | The activity to convert. |
| `targetFormat` | `string` | The target format to convert the activity to. |

#### Returns

`Promise`\<`any`\>

A promise resolving to the converted activity data.

**`Throws`**

Thrown if activity or targetFormat is not specified, or if targetFormat is unknown.
