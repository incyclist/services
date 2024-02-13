[incyclist-services - v1.1.98](../README.md) / InterfaceAccessProps

# Interface: InterfaceAccessProps

## Table of contents

### Properties

- [connectTimeout](InterfaceAccessProps.md#connecttimeout)
- [scanTimeout](InterfaceAccessProps.md#scantimeout)
- [port](InterfaceAccessProps.md#port)
- [protocol](InterfaceAccessProps.md#protocol)
- [autoConnect](InterfaceAccessProps.md#autoconnect)

## Properties

### connectTimeout

• `Optional` **connectTimeout**: `number`

Timeout for a connect attempt

___

### scanTimeout

• `Optional` **scanTimeout**: `number`

Timeout for a scan attempt

___

### port

• `Optional` **port**: `number`

TCP Port (only relevant for 'tcpip' interface)

___

### protocol

• `Optional` **protocol**: `string`

Protocol to be used (only relevant for 'tcpip' and 'serial' interface)

___

### autoConnect

• `Optional` **autoConnect**: `boolean`

If set to `true` the service will continously try to connect to this interface, otherwise [[connect]] needs to be explicitely called
