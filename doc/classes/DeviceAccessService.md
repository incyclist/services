[incyclist-services - v1.1.95](../README.md) / DeviceAccessService

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

(see [[enableInterface]], [[disableInterface]], [[setDefaultInterfaceProperties]], [[setInterfaceProperties]] for more details)

__Scanning__
It also can be used to perform a device scan across all enabled interfaces.
During the scan, filters can be used to limit the interfaces or device types to be scanned upon

**`Example`**

```
service.on('device', (device:DeviceSetting)=>{ /* do something */})
const detected = await scan();
```

(see [[scan]], [[stopScan]] for more details)

__Connecting/Checking Interface State__
Some interfaces(`ble` and `ant`) are not supported on all computers, because they require a USB Stick/driver to be installed
Is is recommended that you check the connection, or instruct this service to perform an autoConnect (by setting `autoConnect:true` in the properties during [[enableInterface]]). 
If the autoConnect is enabled, the service will continously try to establish a connection to the interface and emits a `interface-changed` event whenever the  connection status changes

**`Example`**

```
service.on('interface-changed', (iface:string,info:InterfaceInfo)=>{ /* do something */})
const connected = await connect();
```

(see [[connect]], [[disconnect]] for more details)

## Hierarchy

- `EventEmitter`

  ↳ **`DeviceAccessService`**

## Table of contents

### Constructors

- [constructor](DeviceAccessService.md#constructor)

### Methods

- [setDefaultInterfaceProperties](DeviceAccessService.md#setdefaultinterfaceproperties)
- [enableInterface](DeviceAccessService.md#enableinterface)
- [disableInterface](DeviceAccessService.md#disableinterface)
- [setInterfaceProperties](DeviceAccessService.md#setinterfaceproperties)
- [getInterfaceInfo](DeviceAccessService.md#getinterfaceinfo)
- [enrichWithAccessState](DeviceAccessService.md#enrichwithaccessstate)
- [initInterface](DeviceAccessService.md#initinterface)
- [connect](DeviceAccessService.md#connect)
- [disconnect](DeviceAccessService.md#disconnect)
- [scan](DeviceAccessService.md#scan)
- [scanForNew](DeviceAccessService.md#scanfornew)
- [getPaths](DeviceAccessService.md#getpaths)
- [getProtocols](DeviceAccessService.md#getprotocols)
- [stopScan](DeviceAccessService.md#stopscan)
- [isScanning](DeviceAccessService.md#isscanning)
- [getInstance](DeviceAccessService.md#getinstance)

## Constructors

### constructor

• **new DeviceAccessService**(): [`DeviceAccessService`](DeviceAccessService.md)

#### Returns

[`DeviceAccessService`](DeviceAccessService.md)

#### Overrides

EventEmitter.constructor

## Methods

### setDefaultInterfaceProperties

▸ **setDefaultInterfaceProperties**(`props`): `void`

Sets the default properties

These will be used if there are no properties given in an [[enableInterface]] call for an interface

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `props` | [`InterfaceAccessProps`](../interfaces/InterfaceAccessProps.md) | Properties to be used as default ( e.g. scan timeout) |

#### Returns

`void`

___

### enableInterface

▸ **enableInterface**(`ifaceName`, `binding?`, `props?`): `Promise`\<`void`\>

Enables an interface to be used for device access

only enabled interfaces will be considered during device scans and connection attempts

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `ifaceName` | `string` | the name of the interface (one of `ant`, `ble`, `serial`, `tcpip`) |
| `binding?` | `any` | the Binding class to be used. Upon first call the binding must be specified, otherwise the method will throw an `Error`. On subsequent calls ( to re-enable an interface that was disabled via [[disableInterface]]) the parameters binding and props are ignored |
| `props` | [`InterfaceAccessProps`](../interfaces/InterfaceAccessProps.md) | Properties to be used. If no properites are provided, or some of the properties are not set, the default properties (see [[setDefaultInterfaceProperties]] will be used |

#### Returns

`Promise`\<`void`\>

**`Example`**

```
// first call 
service.enableInterface('serial',autodetect(), {protocol:'Daum Premium})
// re-enablement
* service.enableInterface('serial')
```

___

### disableInterface

▸ **disableInterface**(`ifaceName`, `avalailable?`): `Promise`\<`void`\>

Disables an interface 

By disabling an interface it will be omitted during device scans and connection attempts

If this method is called during an ongoing device scan on that interface, the ongoing scan will first be stopped before changing the interface enablement state

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `ifaceName` | `string` | `undefined` | the name of the interface (one of `ant`, `ble`, `serial`, `tcpip`) |
| `avalailable` | `boolean` | `true` | - |

#### Returns

`Promise`\<`void`\>

___

### setInterfaceProperties

▸ **setInterfaceProperties**(`ifaceName`, `props`): `void`

Set the current interface properties

This method allows to overwrite the interface properties for a given interface

If this method is called during an ongoing scan, the scan will be interrupted before the new properties will be set

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `ifaceName` | `string` | the name of the interface (one of `ant`, `ble`, `serial`, `tcpip`) |
| `props` | [`InterfaceAccessProps`](../interfaces/InterfaceAccessProps.md) | Properties to be used. If no properites are provided, or some of the properties are not set, the default properties (see [[setDefaultInterfaceProperties]] will be used |

#### Returns

`void`

___

### getInterfaceInfo

▸ **getInterfaceInfo**(`ifaceName`): [`InterfaceInfo`](../interfaces/InterfaceInfo.md)

Get interface information

This method provides information (e.g. scanning state, connection state) about an interface

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName` | `string` |

#### Returns

[`InterfaceInfo`](../interfaces/InterfaceInfo.md)

[[InterfaceInfo]] the information about the interface

___

### enrichWithAccessState

▸ **enrichWithAccessState**(`interfaces`): [`EnrichedInterfaceSetting`](../interfaces/EnrichedInterfaceSetting.md)[]

enrich interface configuration retrieved from DeviceConfiguration service with 
current status information from Access Service

This method provides information (e.g. scanning state, connection state) about an interface

#### Parameters

| Name | Type |
| :------ | :------ |
| `interfaces` | [`InterfaceSetting`](../interfaces/InterfaceSetting.md)[] |

#### Returns

[`EnrichedInterfaceSetting`](../interfaces/EnrichedInterfaceSetting.md)[]

[[InterfaceInfo]] the information about the interface

___

### initInterface

▸ **initInterface**(`ifaceName`, `binding`, `props?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName` | `string` |
| `binding` | `any` |
| `props` | [`InterfaceAccessProps`](../interfaces/InterfaceAccessProps.md) |

#### Returns

`void`

___

### connect

▸ **connect**(`ifaceName?`): `Promise`\<`boolean`\>

Tries to open a connection to the interface. 

For serial and tcpip interface this will always return true -as long as a valid binding was used
For Ant+ and BLE, this will try to establish a connection to the USB port

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName?` | `string` |

#### Returns

`Promise`\<`boolean`\>

true if the interface could be connected, otherwise false

___

### disconnect

▸ **disconnect**(`ifaceName?`): `Promise`\<`boolean`\>

Closes the connection to the interface. 

This will _not_ automatically stop all connected Device Adapters. This needs to be done seperately

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName?` | `string` |

#### Returns

`Promise`\<`boolean`\>

true if the interface could be disconnected, otherwise false

___

### scan

▸ **scan**(`filter?`, `props?`): `Promise`\<`DeviceSettings`[]\>

Performs a device scan. 

This will _not_ automatically stop all connected Device Adapters. This needs to be done seperately

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `filter` | [`ScanFilter`](../interfaces/ScanFilter.md) | [[ScanFilter]] allows to limit the search on specififc interfaces or capabilties |
| `props` | `Object` | - |
| `props.timeout?` | `number` | - |
| `props.includeKnown?` | `boolean` | - |

#### Returns

`Promise`\<`DeviceSettings`[]\>

[[DeviceSettings]][] a list of Devices that were detected during the scan

___

### scanForNew

▸ **scanForNew**(`filter?`, `maxDevices?`, `timeout?`): `Promise`\<`DeviceSettings` \| `DeviceSettings`[]\>

Scans for devices that were not yet listed in the device configuration

This will _not_ automatically stop all connected Device Adapters. This needs to be done seperately

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `filter` | [`ScanForNewFilter`](../interfaces/ScanForNewFilter.md) | `{}` | [[ScanFilter]] allows to limit the search on specififc interfaces or capabilties |
| `maxDevices` | `number` | `1` | allows to limit the number of devices that should be detected (default:1) |
| `timeout` | `number` | `30000` | - |

#### Returns

`Promise`\<`DeviceSettings` \| `DeviceSettings`[]\>

[[DeviceSettings]][]|[[DeviceSettings]] if [[maxDevices]] is set to 1, it will return the detected devices, otherwise it will return a list of Devices that were detected during the scan

___

### getPaths

▸ **getPaths**(`ifaceName`): `Promise`\<`string`[]\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName` | `string` |

#### Returns

`Promise`\<`string`[]\>

___

### getProtocols

▸ **getProtocols**(`ifaceName`): `string`[]

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName` | `string` |

#### Returns

`string`[]

___

### stopScan

▸ **stopScan**(): `Promise`\<`boolean`\>

#### Returns

`Promise`\<`boolean`\>

___

### isScanning

▸ **isScanning**(`ifaceName?`): `boolean`

#### Parameters

| Name | Type |
| :------ | :------ |
| `ifaceName?` | `string` |

#### Returns

`boolean`

___

### getInstance

▸ **getInstance**(): [`DeviceAccessService`](DeviceAccessService.md)

#### Returns

[`DeviceAccessService`](DeviceAccessService.md)
