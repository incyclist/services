[incyclist-services - v1.0.0-beta.1](../README.md) / DeviceAccessService

# Class: DeviceAccessService

This service is used by the Front-End to manage the access to devices and interfaces

It can be used to enable/disable/configure the interfaces to be used. 
At the moment, the following interfaces are support:
- `serial`: SerialPort interface (requires to set `protocol`) in the interface properties
- `tcpip`: TCP/IP interface (requires to set `port`and  `protocol`) in the interface properties
- `ant`:  ANT+ interface
- `ble`: BLE interface

**`Example`**

```
const {useDeviceAccess} = require('incyclist-services');
const {AntDevice} = require('incyclist-ant-plus/lib/bindings');
const {autoDetect} = require('@serialport/bindings-cpp')
const {TCPBinding} = require('incyclist-devices');

const service = useDeviceAccess()

service.setDefaultInterfaceProperties({connectTimeout:3000, scanTimeout:10000})
service.enableInterface('ant', AntDevice)
service.enableInterface('serial', autodetect(), {protocol:'Daum Classic'})
service.enableInterface('tcpip', TCPBinding, {port:51955, protocol:'Daum Premium'})
```

(see [enableInterface](DeviceAccessService.md#enableinterface), [disableInterface](DeviceAccessService.md#disableinterface), [setDefaultInterfaceProperties](DeviceAccessService.md#setdefaultinterfaceproperties), [setInterfaceProperties](DeviceAccessService.md#setinterfaceproperties) for more details)

__Scanning__
It also can be used to perform a device scan across all enabled interfaces.
During the scan, filters can be used to limit the interfaces or device types to be scanned upon

**`Example`**

```
service.on('device', (device:DeviceSetting)=>{ /* do something */})
const detected = await scan();
```

(see [scan](DeviceAccessService.md#scan), [stopScan](DeviceAccessService.md#stopscan) for more details)

__Connecting/Checking Interface State__
Some interfaces(`ble` and `ant`) are not supported on all computers, because they require a USB Stick/driver to be installed
Is is recommended that you check the connection, or instruct this service to perform an autoConnect (by setting `autoConnect:true` in the properties during [enableInterface](DeviceAccessService.md#enableinterface)). 
If the autoConnect is enabled, the service will continously try to establish a connection to the interface and emits a `interface-changed` event whenever the  connection status changes

**`Example`**

```
service.on('interface-changed', (iface:string,info:InterfaceInfo)=>{ /* do something */})
const connected = await connect();
```

(see [connect](DeviceAccessService.md#connect), [disconnect](DeviceAccessService.md#disconnect) for more details)

## Hierarchy

- `EventEmitter`

  ??? **`DeviceAccessService`**

## Table of contents

### Constructors

- [constructor](DeviceAccessService.md#constructor)

### Methods

- [connect](DeviceAccessService.md#connect)
- [disableInterface](DeviceAccessService.md#disableinterface)
- [disconnect](DeviceAccessService.md#disconnect)
- [enableInterface](DeviceAccessService.md#enableinterface)
- [isScanning](DeviceAccessService.md#isscanning)
- [scan](DeviceAccessService.md#scan)
- [setDefaultInterfaceProperties](DeviceAccessService.md#setdefaultinterfaceproperties)
- [setInterfaceProperties](DeviceAccessService.md#setinterfaceproperties)
- [stopScan](DeviceAccessService.md#stopscan)
- [getInstance](DeviceAccessService.md#getinstance)

## Constructors

### constructor

??? **new DeviceAccessService**()

#### Overrides

EventEmitter.constructor

## Methods

### connect

??? **connect**(`ifaceName`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName` | `string` |

#### Returns

`Promise`<`boolean`\>

___

### disableInterface

??? **disableInterface**(`ifaceName`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName` | `string` |

#### Returns

`void`

___

### disconnect

??? **disconnect**(`ifaceName?`): `Promise`<`boolean`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName?` | `string` |

#### Returns

`Promise`<`boolean`\>

___

### enableInterface

??? **enableInterface**(`ifaceName`, `binding?`, `props?`): `void`

Enables an interface to be used for device access

only enabled interfaces will be considered during device scans and connection attempts

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `ifaceName` | `string` | the name of the interface (one of `ant`, `ble`, `serial`, `tcpip`) |
| `binding?` | `any` | the Binding class to be used. Upon first call the binding must be specified. On subsequent calls ( to re-enable an interface that was disabled via [disableInterface](DeviceAccessService.md#disableinterface)) this parameter can be omitted |
| `props` | `InterfaceAccessProps` | Properties to be used. If no properites are provided, or some of the properties are not set, the default properties (see[setDefaultInterfaceProperties](DeviceAccessService.md#setdefaultinterfaceproperties) will be used |

#### Returns

`void`

___

### isScanning

??? **isScanning**(`ifaceName?`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName?` | `string` |

#### Returns

`boolean`

___

### scan

??? **scan**(`filter?`): `Promise`<`DeviceSettings`[]\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `filter` | `ScanFilter` |

#### Returns

`Promise`<`DeviceSettings`[]\>

___

### setDefaultInterfaceProperties

??? **setDefaultInterfaceProperties**(`props`): `void`

Sets the default properties

These will be used if there are no properties given in an [enableInterface](DeviceAccessService.md#enableinterface) call for an interface

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `props` | `InterfaceAccessProps` | Properties to be used as default ( e.g. scan timeout) |

#### Returns

`void`

___

### setInterfaceProperties

??? **setInterfaceProperties**(`ifaceName`, `props`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName` | `string` |
| `props` | `InterfaceAccessProps` |

#### Returns

`void`

___

### stopScan

??? **stopScan**(): `Promise`<`boolean`\>

#### Returns

`Promise`<`boolean`\>

___

### getInstance

??? `Static` **getInstance**(): [`DeviceAccessService`](DeviceAccessService.md)

#### Returns

[`DeviceAccessService`](DeviceAccessService.md)
