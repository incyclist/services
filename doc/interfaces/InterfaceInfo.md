[incyclist-services - v1.1.95](../README.md) / InterfaceInfo

# Interface: InterfaceInfo

## Table of contents

### Properties

- [name](InterfaceInfo.md#name)
- [enabled](InterfaceInfo.md#enabled)
- [state](InterfaceInfo.md#state)
- [isScanning](InterfaceInfo.md#isscanning)
- [properties](InterfaceInfo.md#properties)

## Properties

### name

• **name**: `string`

name of the interface

___

### enabled

• **enabled**: `boolean`

is the interface enabled by the user/system

___

### state

• **state**: [`InterfaceState`](../README.md#interfacestate)

connection state, only when state is 'connected', the interface is ready to be used

___

### isScanning

• **isScanning**: `boolean`

provides information if the interface is currently performing a scan

___

### properties

• `Optional` **properties**: [`InterfaceAccessProps`](InterfaceAccessProps.md)

additional properties provided to the Interface ( e.g. timeouts, protocol for SerialInterface, ...)
