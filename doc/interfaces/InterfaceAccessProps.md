[incyclist-services - v1.0.0](../README.md) / InterfaceAccessProps

# Interface: InterfaceAccessProps

## Table of contents

### Properties

- [autoConnect](InterfaceAccessProps.md#autoconnect)
- [connectTimeout](InterfaceAccessProps.md#connecttimeout)
- [port](InterfaceAccessProps.md#port)
- [protocol](InterfaceAccessProps.md#protocol)
- [scanTimeout](InterfaceAccessProps.md#scantimeout)

## Properties

### autoConnect

• `Optional` **autoConnect**: `boolean`

If set to `true` the service will continously try to connect to this interface, otherwise connect needs to be explicitely called

___

### connectTimeout

• `Optional` **connectTimeout**: `number`

Timeout for a connect attempt

___

### port

• `Optional` **port**: `number`

TCP Port (only relevant for 'tcpip' interface)

___

### protocol

• `Optional` **protocol**: `string`

Protocol to be used (only relevant for 'tcpip' and 'serial' interface)

___

### scanTimeout

• `Optional` **scanTimeout**: `number`

Timeout for a scan attempt
