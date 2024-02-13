[incyclist-services - v1.1.98](../README.md) / geo

# Namespace: geo

## Table of contents

### Type Aliases

- [LatLng](geo.md#latlng)

### Functions

- [calculateDistance](geo.md#calculatedistance)
- [distanceBetween](geo.md#distancebetween)
- [getPointBetween](geo.md#getpointbetween)
- [getPointAfter](geo.md#getpointafter)
- [getLatLng](geo.md#getlatlng)
- [calculateHeaderFromPoints](geo.md#calculateheaderfrompoints)

## Type Aliases

### LatLng

Ƭ **LatLng**: `Object`

#### Type declaration

| Name | Type |
| :------ | :------ |
| `lat` | `number` |
| `lng` | `number` |

## Functions

### calculateDistance

▸ **calculateDistance**(`lat1`, `lon1`, `lat2`, `lon2`, `radius?`): `number`

Calculates the distance between the two points using the haversine method.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `lat1` | `number` | The latitude of the first point. |
| `lon1` | `number` | The longtitude of the first point. |
| `lat2` | `number` | The latitude of the first point. |
| `lon2` | `number` | The longtitude of the first point. |
| `radius` | `number` | - |

#### Returns

`number`

The distance in meters between the two points.

___

### distanceBetween

▸ **distanceBetween**(`p1`, `p2`, `props?`): `number`

calculate the distance between two points or route points

#### Parameters

| Name | Type | Default value | Description |
| :------ | :------ | :------ | :------ |
| `p1` | `RoutePoint` \| [`LatLng`](geo.md#latlng) | `undefined` | The first point |
| `p2` | `RoutePoint` \| [`LatLng`](geo.md#latlng) | `undefined` | The second point |
| `props` | `Object` | `undefined` | - |
| `props.abs` | `boolean` | `true` | defines if the absolute value of the disctance should nbe returned |
| `props.latLng` | `boolean` | `true` | if true the distance will be calculated based on the coordinates, otherwise it will calculate based on the distance on the route |

#### Returns

`number`

The resulting distance (in meters)

___

### getPointBetween

▸ **getPointBetween**(`p1`, `p2`, `offset`): [`LatLng`](geo.md#latlng)

returns a point that lies between two points specified

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `p1` | [`LatLng`](geo.md#latlng) | The first point |
| `p2` | [`LatLng`](geo.md#latlng) | The second point |
| `offset` | `number` | distance in meter to the first point |

#### Returns

[`LatLng`](geo.md#latlng)

The resulting point

___

### getPointAfter

▸ **getPointAfter**(`p1`, `p2`, `offset`): [`LatLng`](geo.md#latlng)

returns a point that lies on the continuation on the line between two points

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `p1` | [`LatLng`](geo.md#latlng) | The first point |
| `p2` | [`LatLng`](geo.md#latlng) | The second point |
| `offset` | `number` | The distance in meters after point 2 |

#### Returns

[`LatLng`](geo.md#latlng)

The resulting point

___

### getLatLng

▸ **getLatLng**(`position`): [`LatLng`](geo.md#latlng)

#### Parameters

| Name | Type |
| :------ | :------ |
| `position` | `number`[] \| [`LatLng`](geo.md#latlng) |

#### Returns

[`LatLng`](geo.md#latlng)

___

### calculateHeaderFromPoints

▸ **calculateHeaderFromPoints**(`p1`, `p2`): `number`

Returns the (initial) bearing between two points identified by lat1,lon1 and lat2,lon2

#### Parameters

| Name | Type |
| :------ | :------ |
| `p1` | [`LatLng`](geo.md#latlng) |
| `p2` | [`LatLng`](geo.md#latlng) |

#### Returns

`number`

Initial bearing in degrees from north.

**`Example`**

```ts
var b1 = calculateHeaderFromPoints(52.205, 0.119,48.857, 2.351 ); // 156.2°
```
