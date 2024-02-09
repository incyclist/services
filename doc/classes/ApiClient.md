[incyclist-services - v1.1.95](../README.md) / ApiClient

# Class: ApiClient

REST API CLient 

All Calls to the Incyclist REST API should be made using this class.

It enriches the axios libary with the following features
 - Default Headers will be added, to better associate the requests with specific channels,versions and uuids
 - Request Authorisation
 - optional request logging

**`Example`**

```ts
ApiClient.getInstance.init({channel:'desktop', version:'0.6', appVersion:'1.0', API_KEY='<some key>',uuid='123', requestLog:true })

 const client = ApiClient.getClient()
 const rides = await client.get('https://incyclist.com/active-rides')
```

## Table of contents

### Constructors

- [constructor](ApiClient.md#constructor)

### Properties

- [\_instance](ApiClient.md#_instance)

### Methods

- [init](ApiClient.md#init)
- [client](ApiClient.md#client)
- [getInstance](ApiClient.md#getinstance)
- [getClient](ApiClient.md#getclient)

## Constructors

### constructor

• **new ApiClient**(): [`ApiClient`](ApiClient.md)

#### Returns

[`ApiClient`](ApiClient.md)

## Properties

### \_instance

▪ `Static` **\_instance**: `any` = `null`

## Methods

### init

▸ **init**(`props`): `void`

Initialises the Api Client instance

This method needs to be called once in the app before any Api calls can be made against 
the Incyclist APIs

#### Parameters

| Name | Type |
| :------ | :------ |
| `props` | [`ApiClientInitProps`](../README.md#apiclientinitprops) |

#### Returns

`void`

___

### client

▸ **client**(): `AxiosInstance`

Provides access to the axios client object

The axios client object will be used to make the REST calls ( get(), post(), ...)
For methods exposed, please have a look at the Axios documentation

#### Returns

`AxiosInstance`

client object

___

### getInstance

▸ **getInstance**(): [`ApiClient`](ApiClient.md)

Provides access to the ApiClient Instance

#### Returns

[`ApiClient`](ApiClient.md)

ApiClient singleton instance

___

### getClient

▸ **getClient**(): `AxiosInstance`

Provides access to the axios client object

The axios client object will be used to make the REST calls ( get(), post(), ...)
For methods exposed, please have a look at the Axios documentation 

This static method is a soprter alternative call for ApiClient.getInstance().getClient()

#### Returns

`AxiosInstance`

client object
