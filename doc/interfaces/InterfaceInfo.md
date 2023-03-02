[incyclist-services - v1.0.0-beta.1](../README.md) / InterfaceInfo

# Interface: InterfaceInfo

## Table of contents

### Properties

- [enabled](InterfaceInfo.md#enabled)
- [isScanning](InterfaceInfo.md#isscanning)
- [name](InterfaceInfo.md#name)
- [properties](InterfaceInfo.md#properties)
- [state](InterfaceInfo.md#state)

## Properties

### enabled

• **enabled**: `boolean`

is the interface enabled by the user/system

___

### isScanning

• **isScanning**: `boolean`

provides information if the interface is currently performing a scan

___

### name

• **name**: `string`

name of the interface

___

### properties

• `Optional` **properties**: `InterfaceAccessProps`

additional properties provided to the Interface ( e.g. timeouts, protocol for SerialInterface, ...)

___

### state

• **state**: `InterfaceState`

connection state, only when state is 'connected', the interface is ready to be used
