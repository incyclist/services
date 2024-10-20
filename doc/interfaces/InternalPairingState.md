[incyclist-services - v1.2.2](../README.md) / InternalPairingState

# Interface: InternalPairingState

## Hierarchy

- [`PairingState`](PairingState.md)

  ↳ **`InternalPairingState`**

## Table of contents

### Properties

- [capabilities](InternalPairingState.md#capabilities)
- [interfaces](InternalPairingState.md#interfaces)
- [canStartRide](InternalPairingState.md#canstartride)
- [adapters](InternalPairingState.md#adapters)
- [initialized](InternalPairingState.md#initialized)
- [stopRequested](InternalPairingState.md#stoprequested)
- [stopped](InternalPairingState.md#stopped)
- [waiting](InternalPairingState.md#waiting)
- [deleted](InternalPairingState.md#deleted)
- [scanTo](InternalPairingState.md#scanto)
- [tsPrevStart](InternalPairingState.md#tsprevstart)
- [check](InternalPairingState.md#check)
- [scan](InternalPairingState.md#scan)
- [props](InternalPairingState.md#props)
- [data](InternalPairingState.md#data)

## Properties

### capabilities

• `Optional` **capabilities**: [`CapabilityData`](CapabilityData.md)[]

#### Inherited from

[PairingState](PairingState.md).[capabilities](PairingState.md#capabilities)

___

### interfaces

• `Optional` **interfaces**: [`EnrichedInterfaceSetting`](EnrichedInterfaceSetting.md)[]

#### Inherited from

[PairingState](PairingState.md).[interfaces](PairingState.md#interfaces)

___

### canStartRide

• `Optional` **canStartRide**: `boolean`

#### Inherited from

[PairingState](PairingState.md).[canStartRide](PairingState.md#canstartride)

___

### adapters

• `Optional` **adapters**: [`AdapterInfo`](AdapterInfo.md)[]

#### Inherited from

[PairingState](PairingState.md).[adapters](PairingState.md#adapters)

___

### initialized

• **initialized**: `boolean`

___

### stopRequested

• `Optional` **stopRequested**: `boolean`

___

### stopped

• `Optional` **stopped**: `boolean`

___

### waiting

• `Optional` **waiting**: `boolean`

___

### deleted

• **deleted**: [`DeleteListEntry`](DeleteListEntry.md)[]

___

### scanTo

• `Optional` **scanTo**: `Timeout`

___

### tsPrevStart

• `Optional` **tsPrevStart**: `number`

___

### check

• `Optional` **check**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `preparing?` | `number` |
| `promise?` | `Promise`\<`boolean`\> |
| `to?` | `Timeout` |

___

### scan

• `Optional` **scan**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `preparing?` | `number` |
| `promise?` | `Promise`\<`DeviceSettings`[]\> |
| `adapters?` | \{ `udid`: `string` ; `adapter`: `IncyclistDeviceAdapter` ; `handler`: `any`  }[] |

___

### props

• `Optional` **props**: [`PairingProps`](PairingProps.md)

___

### data

• `Optional` **data**: \{ `udid`: `string` ; `data`: `IncyclistAdapterData` ; `ts`: `number`  }[]
