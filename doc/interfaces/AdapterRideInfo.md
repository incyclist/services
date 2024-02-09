[incyclist-services - v1.1.95](../README.md) / AdapterRideInfo

# Interface: AdapterRideInfo

## Hierarchy

- [`AdapterInfo`](AdapterInfo.md)

  ↳ **`AdapterRideInfo`**

## Table of contents

### Properties

- [udid](AdapterRideInfo.md#udid)
- [adapter](AdapterRideInfo.md#adapter)
- [capabilities](AdapterRideInfo.md#capabilities)
- [isStarted](AdapterRideInfo.md#isstarted)
- [tsLastData](AdapterRideInfo.md#tslastdata)
- [isHealthy](AdapterRideInfo.md#ishealthy)
- [isRestarting](AdapterRideInfo.md#isrestarting)
- [dataStatus](AdapterRideInfo.md#datastatus)
- [ivToCheck](AdapterRideInfo.md#ivtocheck)

## Properties

### udid

• **udid**: `string`

#### Inherited from

[AdapterInfo](AdapterInfo.md).[udid](AdapterInfo.md#udid)

___

### adapter

• **adapter**: `IncyclistDeviceAdapter`

#### Inherited from

[AdapterInfo](AdapterInfo.md).[adapter](AdapterInfo.md#adapter)

___

### capabilities

• **capabilities**: [`ExtendedIncyclistCapability`](../README.md#extendedincyclistcapability)[]

#### Inherited from

[AdapterInfo](AdapterInfo.md).[capabilities](AdapterInfo.md#capabilities)

___

### isStarted

• **isStarted**: `boolean`

___

### tsLastData

• `Optional` **tsLastData**: `number`

___

### isHealthy

• `Optional` **isHealthy**: `boolean`

___

### isRestarting

• `Optional` **isRestarting**: `boolean`

___

### dataStatus

• `Optional` **dataStatus**: [`HealthStatus`](../README.md#healthstatus)

___

### ivToCheck

• `Optional` **ivToCheck**: `Timeout`
