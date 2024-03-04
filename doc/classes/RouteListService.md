[incyclist-services - v1.1.98](../README.md) / RouteListService

# Class: RouteListService

## Hierarchy

- `IncyclistService`

  ↳ **`RouteListService`**

## Table of contents

### Constructors

- [constructor](RouteListService.md#constructor)

### Properties

- [errorMonitor](RouteListService.md#errormonitor)
- [captureRejectionSymbol](RouteListService.md#capturerejectionsymbol)
- [captureRejections](RouteListService.md#capturerejections)
- [defaultMaxListeners](RouteListService.md#defaultmaxlisteners)

### Methods

- [[captureRejectionSymbol]](RouteListService.md#[capturerejectionsymbol])
- [addListener](RouteListService.md#addlistener)
- [on](RouteListService.md#on)
- [once](RouteListService.md#once)
- [removeListener](RouteListService.md#removelistener)
- [off](RouteListService.md#off)
- [removeAllListeners](RouteListService.md#removealllisteners)
- [setMaxListeners](RouteListService.md#setmaxlisteners)
- [getMaxListeners](RouteListService.md#getmaxlisteners)
- [listeners](RouteListService.md#listeners)
- [rawListeners](RouteListService.md#rawlisteners)
- [emit](RouteListService.md#emit)
- [listenerCount](RouteListService.md#listenercount)
- [prependListener](RouteListService.md#prependlistener)
- [prependOnceListener](RouteListService.md#prependoncelistener)
- [eventNames](RouteListService.md#eventnames)
- [logEvent](RouteListService.md#logevent)
- [setDebug](RouteListService.md#setdebug)
- [logError](RouteListService.md#logerror)
- [setLanguage](RouteListService.md#setlanguage)
- [getLanguage](RouteListService.md#getlanguage)
- [getStartSettings](RouteListService.md#getstartsettings)
- [setStartSettings](RouteListService.md#setstartsettings)
- [getSelected](RouteListService.md#getselected)
- [setScreenProps](RouteListService.md#setscreenprops)
- [getScreenProps](RouteListService.md#getscreenprops)
- [open](RouteListService.md#open)
- [close](RouteListService.md#close)
- [search](RouteListService.md#search)
- [stopSearch](RouteListService.md#stopsearch)
- [getFilterOptions](RouteListService.md#getfilteroptions)
- [onResize](RouteListService.md#onresize)
- [onCarouselInitialized](RouteListService.md#oncarouselinitialized)
- [onCarouselUpdated](RouteListService.md#oncarouselupdated)
- [preload](RouteListService.md#preload)
- [getLists](RouteListService.md#getlists)
- [getRouteDetails](RouteListService.md#getroutedetails)
- [getSelectedRouteDetails](RouteListService.md#getselectedroutedetails)
- [unselect](RouteListService.md#unselect)
- [select](RouteListService.md#select)
- [selectCard](RouteListService.md#selectcard)
- [unselectCard](RouteListService.md#unselectcard)
- [import](RouteListService.md#import)
- [emitLists](RouteListService.md#emitlists)
- [getCard](RouteListService.md#getcard)
- [addCardAgain](RouteListService.md#addcardagain)
- [createPreview](RouteListService.md#createpreview)
- [once](RouteListService.md#once-1)
- [on](RouteListService.md#on-1)
- [listenerCount](RouteListService.md#listenercount-1)
- [getEventListeners](RouteListService.md#geteventlisteners)
- [getMaxListeners](RouteListService.md#getmaxlisteners-1)
- [setMaxListeners](RouteListService.md#setmaxlisteners-1)
- [addAbortListener](RouteListService.md#addabortlistener)

## Constructors

### constructor

• **new RouteListService**(): [`RouteListService`](RouteListService.md)

#### Returns

[`RouteListService`](RouteListService.md)

#### Overrides

IncyclistService.constructor

## Properties

### errorMonitor

▪ `Static` `Readonly` **errorMonitor**: typeof `errorMonitor`

This symbol shall be used to install a listener for only monitoring `'error'`events. Listeners installed using this symbol are called before the regular`'error'` listeners are called.

Installing a listener using this symbol does not change the behavior once an`'error'` event is emitted. Therefore, the process will still crash if no
regular `'error'` listener is installed.

**`Since`**

v13.6.0, v12.17.0

#### Inherited from

IncyclistService.errorMonitor

___

### captureRejectionSymbol

▪ `Static` `Readonly` **captureRejectionSymbol**: typeof `captureRejectionSymbol`

Value: `Symbol.for('nodejs.rejection')`

See how to write a custom `rejection handler`.

**`Since`**

v13.4.0, v12.16.0

#### Inherited from

IncyclistService.captureRejectionSymbol

___

### captureRejections

▪ `Static` **captureRejections**: `boolean`

Value: [boolean](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Data_structures#Boolean_type)

Change the default `captureRejections` option on all new `EventEmitter` objects.

**`Since`**

v13.4.0, v12.16.0

#### Inherited from

IncyclistService.captureRejections

___

### defaultMaxListeners

▪ `Static` **defaultMaxListeners**: `number`

By default, a maximum of `10` listeners can be registered for any single
event. This limit can be changed for individual `EventEmitter` instances
using the `emitter.setMaxListeners(n)` method. To change the default
for _all_`EventEmitter` instances, the `events.defaultMaxListeners`property can be used. If this value is not a positive number, a `RangeError`is thrown.

Take caution when setting the `events.defaultMaxListeners` because the
change affects _all_`EventEmitter` instances, including those created before
the change is made. However, calling `emitter.setMaxListeners(n)` still has
precedence over `events.defaultMaxListeners`.

This is not a hard limit. The `EventEmitter` instance will allow
more listeners to be added but will output a trace warning to stderr indicating
that a "possible EventEmitter memory leak" has been detected. For any single`EventEmitter`, the `emitter.getMaxListeners()` and `emitter.setMaxListeners()`methods can be used to
temporarily avoid this warning:

```js
import { EventEmitter } from 'node:events';
const emitter = new EventEmitter();
emitter.setMaxListeners(emitter.getMaxListeners() + 1);
emitter.once('event', () => {
  // do stuff
  emitter.setMaxListeners(Math.max(emitter.getMaxListeners() - 1, 0));
});
```

The `--trace-warnings` command-line flag can be used to display the
stack trace for such warnings.

The emitted warning can be inspected with `process.on('warning')` and will
have the additional `emitter`, `type`, and `count` properties, referring to
the event emitter instance, the event's name and the number of attached
listeners, respectively.
Its `name` property is set to `'MaxListenersExceededWarning'`.

**`Since`**

v0.11.2

#### Inherited from

IncyclistService.defaultMaxListeners

## Methods

### [captureRejectionSymbol]

▸ **[captureRejectionSymbol]**(`error`, `event`, `...args`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `error` | `Error` |
| `event` | `string` |
| `...args` | `any`[] |

#### Returns

`void`

#### Inherited from

IncyclistService.[captureRejectionSymbol]

___

### addListener

▸ **addListener**(`eventName`, `listener`): [`RouteListService`](RouteListService.md)

Alias for `emitter.on(eventName, listener)`.

#### Parameters

| Name | Type |
| :------ | :------ |
| `eventName` | `string` \| `symbol` |
| `listener` | (...`args`: `any`[]) => `void` |

#### Returns

[`RouteListService`](RouteListService.md)

**`Since`**

v0.1.26

#### Inherited from

IncyclistService.addListener

___

### on

▸ **on**(`eventName`, `listener`): [`RouteListService`](RouteListService.md)

Adds the `listener` function to the end of the listeners array for the
event named `eventName`. No checks are made to see if the `listener` has
already been added. Multiple calls passing the same combination of `eventName`and `listener` will result in the `listener` being added, and called, multiple
times.

```js
server.on('connection', (stream) => {
  console.log('someone connected!');
});
```

Returns a reference to the `EventEmitter`, so that calls can be chained.

By default, event listeners are invoked in the order they are added. The`emitter.prependListener()` method can be used as an alternative to add the
event listener to the beginning of the listeners array.

```js
import { EventEmitter } from 'node:events';
const myEE = new EventEmitter();
myEE.on('foo', () => console.log('a'));
myEE.prependListener('foo', () => console.log('b'));
myEE.emit('foo');
// Prints:
//   b
//   a
```

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `eventName` | `string` \| `symbol` | The name of the event. |
| `listener` | (...`args`: `any`[]) => `void` | The callback function |

#### Returns

[`RouteListService`](RouteListService.md)

**`Since`**

v0.1.101

#### Inherited from

IncyclistService.on

___

### once

▸ **once**(`eventName`, `listener`): [`RouteListService`](RouteListService.md)

Adds a **one-time**`listener` function for the event named `eventName`. The
next time `eventName` is triggered, this listener is removed and then invoked.

```js
server.once('connection', (stream) => {
  console.log('Ah, we have our first user!');
});
```

Returns a reference to the `EventEmitter`, so that calls can be chained.

By default, event listeners are invoked in the order they are added. The`emitter.prependOnceListener()` method can be used as an alternative to add the
event listener to the beginning of the listeners array.

```js
import { EventEmitter } from 'node:events';
const myEE = new EventEmitter();
myEE.once('foo', () => console.log('a'));
myEE.prependOnceListener('foo', () => console.log('b'));
myEE.emit('foo');
// Prints:
//   b
//   a
```

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `eventName` | `string` \| `symbol` | The name of the event. |
| `listener` | (...`args`: `any`[]) => `void` | The callback function |

#### Returns

[`RouteListService`](RouteListService.md)

**`Since`**

v0.3.0

#### Inherited from

IncyclistService.once

___

### removeListener

▸ **removeListener**(`eventName`, `listener`): [`RouteListService`](RouteListService.md)

Removes the specified `listener` from the listener array for the event named`eventName`.

```js
const callback = (stream) => {
  console.log('someone connected!');
};
server.on('connection', callback);
// ...
server.removeListener('connection', callback);
```

`removeListener()` will remove, at most, one instance of a listener from the
listener array. If any single listener has been added multiple times to the
listener array for the specified `eventName`, then `removeListener()` must be
called multiple times to remove each instance.

Once an event is emitted, all listeners attached to it at the
time of emitting are called in order. This implies that any`removeListener()` or `removeAllListeners()` calls _after_ emitting and _before_ the last listener finishes execution
will not remove them from`emit()` in progress. Subsequent events behave as expected.

```js
import { EventEmitter } from 'node:events';
class MyEmitter extends EventEmitter {}
const myEmitter = new MyEmitter();

const callbackA = () => {
  console.log('A');
  myEmitter.removeListener('event', callbackB);
};

const callbackB = () => {
  console.log('B');
};

myEmitter.on('event', callbackA);

myEmitter.on('event', callbackB);

// callbackA removes listener callbackB but it will still be called.
// Internal listener array at time of emit [callbackA, callbackB]
myEmitter.emit('event');
// Prints:
//   A
//   B

// callbackB is now removed.
// Internal listener array [callbackA]
myEmitter.emit('event');
// Prints:
//   A
```

Because listeners are managed using an internal array, calling this will
change the position indices of any listener registered _after_ the listener
being removed. This will not impact the order in which listeners are called,
but it means that any copies of the listener array as returned by
the `emitter.listeners()` method will need to be recreated.

When a single function has been added as a handler multiple times for a single
event (as in the example below), `removeListener()` will remove the most
recently added instance. In the example the `once('ping')`listener is removed:

```js
import { EventEmitter } from 'node:events';
const ee = new EventEmitter();

function pong() {
  console.log('pong');
}

ee.on('ping', pong);
ee.once('ping', pong);
ee.removeListener('ping', pong);

ee.emit('ping');
ee.emit('ping');
```

Returns a reference to the `EventEmitter`, so that calls can be chained.

#### Parameters

| Name | Type |
| :------ | :------ |
| `eventName` | `string` \| `symbol` |
| `listener` | (...`args`: `any`[]) => `void` |

#### Returns

[`RouteListService`](RouteListService.md)

**`Since`**

v0.1.26

#### Inherited from

IncyclistService.removeListener

___

### off

▸ **off**(`eventName`, `listener`): [`RouteListService`](RouteListService.md)

Alias for `emitter.removeListener()`.

#### Parameters

| Name | Type |
| :------ | :------ |
| `eventName` | `string` \| `symbol` |
| `listener` | (...`args`: `any`[]) => `void` |

#### Returns

[`RouteListService`](RouteListService.md)

**`Since`**

v10.0.0

#### Inherited from

IncyclistService.off

___

### removeAllListeners

▸ **removeAllListeners**(`event?`): [`RouteListService`](RouteListService.md)

Removes all listeners, or those of the specified `eventName`.

It is bad practice to remove listeners added elsewhere in the code,
particularly when the `EventEmitter` instance was created by some other
component or module (e.g. sockets or file streams).

Returns a reference to the `EventEmitter`, so that calls can be chained.

#### Parameters

| Name | Type |
| :------ | :------ |
| `event?` | `string` \| `symbol` |

#### Returns

[`RouteListService`](RouteListService.md)

**`Since`**

v0.1.26

#### Inherited from

IncyclistService.removeAllListeners

___

### setMaxListeners

▸ **setMaxListeners**(`n`): [`RouteListService`](RouteListService.md)

By default `EventEmitter`s will print a warning if more than `10` listeners are
added for a particular event. This is a useful default that helps finding
memory leaks. The `emitter.setMaxListeners()` method allows the limit to be
modified for this specific `EventEmitter` instance. The value can be set to`Infinity` (or `0`) to indicate an unlimited number of listeners.

Returns a reference to the `EventEmitter`, so that calls can be chained.

#### Parameters

| Name | Type |
| :------ | :------ |
| `n` | `number` |

#### Returns

[`RouteListService`](RouteListService.md)

**`Since`**

v0.3.5

#### Inherited from

IncyclistService.setMaxListeners

___

### getMaxListeners

▸ **getMaxListeners**(): `number`

Returns the current max listener value for the `EventEmitter` which is either
set by `emitter.setMaxListeners(n)` or defaults to [defaultMaxListeners](RouteListService.md#defaultmaxlisteners).

#### Returns

`number`

**`Since`**

v1.0.0

#### Inherited from

IncyclistService.getMaxListeners

___

### listeners

▸ **listeners**(`eventName`): `Function`[]

Returns a copy of the array of listeners for the event named `eventName`.

```js
server.on('connection', (stream) => {
  console.log('someone connected!');
});
console.log(util.inspect(server.listeners('connection')));
// Prints: [ [Function] ]
```

#### Parameters

| Name | Type |
| :------ | :------ |
| `eventName` | `string` \| `symbol` |

#### Returns

`Function`[]

**`Since`**

v0.1.26

#### Inherited from

IncyclistService.listeners

___

### rawListeners

▸ **rawListeners**(`eventName`): `Function`[]

Returns a copy of the array of listeners for the event named `eventName`,
including any wrappers (such as those created by `.once()`).

```js
import { EventEmitter } from 'node:events';
const emitter = new EventEmitter();
emitter.once('log', () => console.log('log once'));

// Returns a new Array with a function `onceWrapper` which has a property
// `listener` which contains the original listener bound above
const listeners = emitter.rawListeners('log');
const logFnWrapper = listeners[0];

// Logs "log once" to the console and does not unbind the `once` event
logFnWrapper.listener();

// Logs "log once" to the console and removes the listener
logFnWrapper();

emitter.on('log', () => console.log('log persistently'));
// Will return a new Array with a single function bound by `.on()` above
const newListeners = emitter.rawListeners('log');

// Logs "log persistently" twice
newListeners[0]();
emitter.emit('log');
```

#### Parameters

| Name | Type |
| :------ | :------ |
| `eventName` | `string` \| `symbol` |

#### Returns

`Function`[]

**`Since`**

v9.4.0

#### Inherited from

IncyclistService.rawListeners

___

### emit

▸ **emit**(`eventName`, `...args`): `boolean`

Synchronously calls each of the listeners registered for the event named`eventName`, in the order they were registered, passing the supplied arguments
to each.

Returns `true` if the event had listeners, `false` otherwise.

```js
import { EventEmitter } from 'node:events';
const myEmitter = new EventEmitter();

// First listener
myEmitter.on('event', function firstListener() {
  console.log('Helloooo! first listener');
});
// Second listener
myEmitter.on('event', function secondListener(arg1, arg2) {
  console.log(`event with parameters ${arg1}, ${arg2} in second listener`);
});
// Third listener
myEmitter.on('event', function thirdListener(...args) {
  const parameters = args.join(', ');
  console.log(`event with parameters ${parameters} in third listener`);
});

console.log(myEmitter.listeners('event'));

myEmitter.emit('event', 1, 2, 3, 4, 5);

// Prints:
// [
//   [Function: firstListener],
//   [Function: secondListener],
//   [Function: thirdListener]
// ]
// Helloooo! first listener
// event with parameters 1, 2 in second listener
// event with parameters 1, 2, 3, 4, 5 in third listener
```

#### Parameters

| Name | Type |
| :------ | :------ |
| `eventName` | `string` \| `symbol` |
| `...args` | `any`[] |

#### Returns

`boolean`

**`Since`**

v0.1.26

#### Inherited from

IncyclistService.emit

___

### listenerCount

▸ **listenerCount**(`eventName`, `listener?`): `number`

Returns the number of listeners listening for the event named `eventName`.
If `listener` is provided, it will return how many times the listener is found
in the list of the listeners of the event.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `eventName` | `string` \| `symbol` | The name of the event being listened for |
| `listener?` | `Function` | The event handler function |

#### Returns

`number`

**`Since`**

v3.2.0

#### Inherited from

IncyclistService.listenerCount

___

### prependListener

▸ **prependListener**(`eventName`, `listener`): [`RouteListService`](RouteListService.md)

Adds the `listener` function to the _beginning_ of the listeners array for the
event named `eventName`. No checks are made to see if the `listener` has
already been added. Multiple calls passing the same combination of `eventName`and `listener` will result in the `listener` being added, and called, multiple
times.

```js
server.prependListener('connection', (stream) => {
  console.log('someone connected!');
});
```

Returns a reference to the `EventEmitter`, so that calls can be chained.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `eventName` | `string` \| `symbol` | The name of the event. |
| `listener` | (...`args`: `any`[]) => `void` | The callback function |

#### Returns

[`RouteListService`](RouteListService.md)

**`Since`**

v6.0.0

#### Inherited from

IncyclistService.prependListener

___

### prependOnceListener

▸ **prependOnceListener**(`eventName`, `listener`): [`RouteListService`](RouteListService.md)

Adds a **one-time**`listener` function for the event named `eventName` to the _beginning_ of the listeners array. The next time `eventName` is triggered, this
listener is removed, and then invoked.

```js
server.prependOnceListener('connection', (stream) => {
  console.log('Ah, we have our first user!');
});
```

Returns a reference to the `EventEmitter`, so that calls can be chained.

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `eventName` | `string` \| `symbol` | The name of the event. |
| `listener` | (...`args`: `any`[]) => `void` | The callback function |

#### Returns

[`RouteListService`](RouteListService.md)

**`Since`**

v6.0.0

#### Inherited from

IncyclistService.prependOnceListener

___

### eventNames

▸ **eventNames**(): (`string` \| `symbol`)[]

Returns an array listing the events for which the emitter has registered
listeners. The values in the array are strings or `Symbol`s.

```js
import { EventEmitter } from 'node:events';

const myEE = new EventEmitter();
myEE.on('foo', () => {});
myEE.on('bar', () => {});

const sym = Symbol('symbol');
myEE.on(sym, () => {});

console.log(myEE.eventNames());
// Prints: [ 'foo', 'bar', Symbol(symbol) ]
```

#### Returns

(`string` \| `symbol`)[]

**`Since`**

v6.0.0

#### Inherited from

IncyclistService.eventNames

___

### logEvent

▸ **logEvent**(`event`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | `any` |

#### Returns

`void`

#### Inherited from

IncyclistService.logEvent

___

### setDebug

▸ **setDebug**(`enabled`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `enabled` | `boolean` |

#### Returns

`void`

#### Inherited from

IncyclistService.setDebug

___

### logError

▸ **logError**(`err`, `fn`, `args?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `err` | `Error` |
| `fn` | `string` |
| `args?` | `any` |

#### Returns

`void`

#### Inherited from

IncyclistService.logError

___

### setLanguage

▸ **setLanguage**(`language`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `language` | `string` |

#### Returns

`void`

___

### getLanguage

▸ **getLanguage**(): `string`

#### Returns

`string`

___

### getStartSettings

▸ **getStartSettings**(): `RouteStartSettings`

#### Returns

`RouteStartSettings`

___

### setStartSettings

▸ **setStartSettings**(`settings`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `settings` | `RouteStartSettings` |

#### Returns

`void`

___

### getSelected

▸ **getSelected**(): `Route`

#### Returns

`Route`

___

### setScreenProps

▸ **setScreenProps**(`props`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `props` | `any` |

#### Returns

`void`

___

### getScreenProps

▸ **getScreenProps**(): `any`

#### Returns

`any`

___

### open

▸ **open**(): `Object`

#### Returns

`Object`

| Name | Type |
| :------ | :------ |
| `observer` | `RouteListObserver` |
| `lists` | `CardList`\<`Route`\>[] |

___

### close

▸ **close**(): `void`

#### Returns

`void`

___

### search

▸ **search**(`requestedFilters?`): \{ `routes`: `SummaryCardDisplayProps`[] ; `filters`: `SearchFilter` ; `observer`: `RouteListObserver`  } \| \{ `observer?`: `undefined` ; `routes`: `any`[] = []; `filters`: {} = \{} }

#### Parameters

| Name | Type |
| :------ | :------ |
| `requestedFilters?` | `SearchFilter` |

#### Returns

\{ `routes`: `SummaryCardDisplayProps`[] ; `filters`: `SearchFilter` ; `observer`: `RouteListObserver`  } \| \{ `observer?`: `undefined` ; `routes`: `any`[] = []; `filters`: {} = \{} }

___

### stopSearch

▸ **stopSearch**(): `void`

#### Returns

`void`

___

### getFilterOptions

▸ **getFilterOptions**(): `SearchFilterOptions`

#### Returns

`SearchFilterOptions`

___

### onResize

▸ **onResize**(): `void`

#### Returns

`void`

___

### onCarouselInitialized

▸ **onCarouselInitialized**(`list`, `item`, `itemsInSlide`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `list` | `CardList`\<`Route`\> |
| `item` | `any` |
| `itemsInSlide` | `any` |

#### Returns

`void`

___

### onCarouselUpdated

▸ **onCarouselUpdated**(`list`, `item`, `itemsInSlide`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `list` | `any` |
| `item` | `any` |
| `itemsInSlide` | `any` |

#### Returns

`void`

___

### preload

▸ **preload**(): `PromiseObserver`\<`void`\>

#### Returns

`PromiseObserver`\<`void`\>

___

### getLists

▸ **getLists**(`forUi?`): `CardList`\<`Route`\>[]

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `forUi` | `boolean` | `true` |

#### Returns

`CardList`\<`Route`\>[]

___

### getRouteDetails

▸ **getRouteDetails**(`id`, `expectLocal?`): `Promise`\<`RouteApiDetail`\>

#### Parameters

| Name | Type | Default value |
| :------ | :------ | :------ |
| `id` | `string` | `undefined` |
| `expectLocal` | `boolean` | `false` |

#### Returns

`Promise`\<`RouteApiDetail`\>

___

### getSelectedRouteDetails

▸ **getSelectedRouteDetails**(): `Promise`\<`RouteApiDetail`\>

#### Returns

`Promise`\<`RouteApiDetail`\>

___

### unselect

▸ **unselect**(): `void`

#### Returns

`void`

___

### select

▸ **select**(`route`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `route` | `Route` |

#### Returns

`void`

___

### selectCard

▸ **selectCard**(`card`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `card` | `Card`\<`Route`\> |

#### Returns

`void`

___

### unselectCard

▸ **unselectCard**(`card`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `card` | `Card`\<`Route`\> |

#### Returns

`void`

___

### import

▸ **import**(`info`, `retry?`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `info` | [`FileInfo`](../interfaces/FileInfo.md) \| [`FileInfo`](../interfaces/FileInfo.md)[] |
| `retry?` | `ActiveImportCard` |

#### Returns

`void`

___

### emitLists

▸ **emitLists**(`event`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `event` | ``"loaded"`` \| ``"updated"`` |

#### Returns

`void`

___

### getCard

▸ **getCard**(`id`): `RouteCard`

#### Parameters

| Name | Type |
| :------ | :------ |
| `id` | `string` |

#### Returns

`RouteCard`

___

### addCardAgain

▸ **addCardAgain**(`card`): `void`

#### Parameters

| Name | Type |
| :------ | :------ |
| `card` | `RouteCard` |

#### Returns

`void`

___

### createPreview

▸ **createPreview**(`descr`): `Promise`\<`unknown`\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `descr` | `RouteInfo` |

#### Returns

`Promise`\<`unknown`\>

___

### once

▸ **once**(`emitter`, `eventName`, `options?`): `Promise`\<`any`[]\>

Creates a `Promise` that is fulfilled when the `EventEmitter` emits the given
event or that is rejected if the `EventEmitter` emits `'error'` while waiting.
The `Promise` will resolve with an array of all the arguments emitted to the
given event.

This method is intentionally generic and works with the web platform [EventTarget](https://dom.spec.whatwg.org/#interface-eventtarget) interface, which has no special`'error'` event
semantics and does not listen to the `'error'` event.

```js
import { once, EventEmitter } from 'node:events';
import process from 'node:process';

const ee = new EventEmitter();

process.nextTick(() => {
  ee.emit('myevent', 42);
});

const [value] = await once(ee, 'myevent');
console.log(value);

const err = new Error('kaboom');
process.nextTick(() => {
  ee.emit('error', err);
});

try {
  await once(ee, 'myevent');
} catch (err) {
  console.error('error happened', err);
}
```

The special handling of the `'error'` event is only used when `events.once()`is used to wait for another event. If `events.once()` is used to wait for the
'`error'` event itself, then it is treated as any other kind of event without
special handling:

```js
import { EventEmitter, once } from 'node:events';

const ee = new EventEmitter();

once(ee, 'error')
  .then(([err]) => console.log('ok', err.message))
  .catch((err) => console.error('error', err.message));

ee.emit('error', new Error('boom'));

// Prints: ok boom
```

An `AbortSignal` can be used to cancel waiting for the event:

```js
import { EventEmitter, once } from 'node:events';

const ee = new EventEmitter();
const ac = new AbortController();

async function foo(emitter, event, signal) {
  try {
    await once(emitter, event, { signal });
    console.log('event emitted!');
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error('Waiting for the event was canceled!');
    } else {
      console.error('There was an error', error.message);
    }
  }
}

foo(ee, 'foo', ac.signal);
ac.abort(); // Abort waiting for the event
ee.emit('foo'); // Prints: Waiting for the event was canceled!
```

#### Parameters

| Name | Type |
| :------ | :------ |
| `emitter` | `_NodeEventTarget` |
| `eventName` | `string` \| `symbol` |
| `options?` | `StaticEventEmitterOptions` |

#### Returns

`Promise`\<`any`[]\>

**`Since`**

v11.13.0, v10.16.0

#### Inherited from

IncyclistService.once

▸ **once**(`emitter`, `eventName`, `options?`): `Promise`\<`any`[]\>

#### Parameters

| Name | Type |
| :------ | :------ |
| `emitter` | `_DOMEventTarget` |
| `eventName` | `string` |
| `options?` | `StaticEventEmitterOptions` |

#### Returns

`Promise`\<`any`[]\>

#### Inherited from

IncyclistService.once

___

### on

▸ **on**(`emitter`, `eventName`, `options?`): `AsyncIterableIterator`\<`any`\>

```js
import { on, EventEmitter } from 'node:events';
import process from 'node:process';

const ee = new EventEmitter();

// Emit later on
process.nextTick(() => {
  ee.emit('foo', 'bar');
  ee.emit('foo', 42);
});

for await (const event of on(ee, 'foo')) {
  // The execution of this inner block is synchronous and it
  // processes one event at a time (even with await). Do not use
  // if concurrent execution is required.
  console.log(event); // prints ['bar'] [42]
}
// Unreachable here
```

Returns an `AsyncIterator` that iterates `eventName` events. It will throw
if the `EventEmitter` emits `'error'`. It removes all listeners when
exiting the loop. The `value` returned by each iteration is an array
composed of the emitted event arguments.

An `AbortSignal` can be used to cancel waiting on events:

```js
import { on, EventEmitter } from 'node:events';
import process from 'node:process';

const ac = new AbortController();

(async () => {
  const ee = new EventEmitter();

  // Emit later on
  process.nextTick(() => {
    ee.emit('foo', 'bar');
    ee.emit('foo', 42);
  });

  for await (const event of on(ee, 'foo', { signal: ac.signal })) {
    // The execution of this inner block is synchronous and it
    // processes one event at a time (even with await). Do not use
    // if concurrent execution is required.
    console.log(event); // prints ['bar'] [42]
  }
  // Unreachable here
})();

process.nextTick(() => ac.abort());
```

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `emitter` | `EventEmitter` | - |
| `eventName` | `string` | The name of the event being listened for |
| `options?` | `StaticEventEmitterOptions` | - |

#### Returns

`AsyncIterableIterator`\<`any`\>

that iterates `eventName` events emitted by the `emitter`

**`Since`**

v13.6.0, v12.16.0

#### Inherited from

IncyclistService.on

___

### listenerCount

▸ **listenerCount**(`emitter`, `eventName`): `number`

A class method that returns the number of listeners for the given `eventName`registered on the given `emitter`.

```js
import { EventEmitter, listenerCount } from 'node:events';

const myEmitter = new EventEmitter();
myEmitter.on('event', () => {});
myEmitter.on('event', () => {});
console.log(listenerCount(myEmitter, 'event'));
// Prints: 2
```

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `emitter` | `EventEmitter` | The emitter to query |
| `eventName` | `string` \| `symbol` | The event name |

#### Returns

`number`

**`Since`**

v0.9.12

**`Deprecated`**

Since v3.2.0 - Use `listenerCount` instead.

#### Inherited from

IncyclistService.listenerCount

___

### getEventListeners

▸ **getEventListeners**(`emitter`, `name`): `Function`[]

Returns a copy of the array of listeners for the event named `eventName`.

For `EventEmitter`s this behaves exactly the same as calling `.listeners` on
the emitter.

For `EventTarget`s this is the only way to get the event listeners for the
event target. This is useful for debugging and diagnostic purposes.

```js
import { getEventListeners, EventEmitter } from 'node:events';

{
  const ee = new EventEmitter();
  const listener = () => console.log('Events are fun');
  ee.on('foo', listener);
  console.log(getEventListeners(ee, 'foo')); // [ [Function: listener] ]
}
{
  const et = new EventTarget();
  const listener = () => console.log('Events are fun');
  et.addEventListener('foo', listener);
  console.log(getEventListeners(et, 'foo')); // [ [Function: listener] ]
}
```

#### Parameters

| Name | Type |
| :------ | :------ |
| `emitter` | `EventEmitter` \| `_DOMEventTarget` |
| `name` | `string` \| `symbol` |

#### Returns

`Function`[]

**`Since`**

v15.2.0, v14.17.0

#### Inherited from

IncyclistService.getEventListeners

___

### getMaxListeners

▸ **getMaxListeners**(`emitter`): `number`

Returns the currently set max amount of listeners.

For `EventEmitter`s this behaves exactly the same as calling `.getMaxListeners` on
the emitter.

For `EventTarget`s this is the only way to get the max event listeners for the
event target. If the number of event handlers on a single EventTarget exceeds
the max set, the EventTarget will print a warning.

```js
import { getMaxListeners, setMaxListeners, EventEmitter } from 'node:events';

{
  const ee = new EventEmitter();
  console.log(getMaxListeners(ee)); // 10
  setMaxListeners(11, ee);
  console.log(getMaxListeners(ee)); // 11
}
{
  const et = new EventTarget();
  console.log(getMaxListeners(et)); // 10
  setMaxListeners(11, et);
  console.log(getMaxListeners(et)); // 11
}
```

#### Parameters

| Name | Type |
| :------ | :------ |
| `emitter` | `EventEmitter` \| `_DOMEventTarget` |

#### Returns

`number`

**`Since`**

v19.9.0

#### Inherited from

IncyclistService.getMaxListeners

___

### setMaxListeners

▸ **setMaxListeners**(`n?`, `...eventTargets`): `void`

```js
import { setMaxListeners, EventEmitter } from 'node:events';

const target = new EventTarget();
const emitter = new EventEmitter();

setMaxListeners(5, target, emitter);
```

#### Parameters

| Name | Type | Description |
| :------ | :------ | :------ |
| `n?` | `number` | A non-negative number. The maximum number of listeners per `EventTarget` event. |
| `...eventTargets` | (`EventEmitter` \| `_DOMEventTarget`)[] | - |

#### Returns

`void`

**`Since`**

v15.4.0

#### Inherited from

IncyclistService.setMaxListeners

___

### addAbortListener

▸ **addAbortListener**(`signal`, `resource`): `Disposable`

Listens once to the `abort` event on the provided `signal`.

Listening to the `abort` event on abort signals is unsafe and may
lead to resource leaks since another third party with the signal can
call `e.stopImmediatePropagation()`. Unfortunately Node.js cannot change
this since it would violate the web standard. Additionally, the original
API makes it easy to forget to remove listeners.

This API allows safely using `AbortSignal`s in Node.js APIs by solving these
two issues by listening to the event such that `stopImmediatePropagation` does
not prevent the listener from running.

Returns a disposable so that it may be unsubscribed from more easily.

```js
import { addAbortListener } from 'node:events';

function example(signal) {
  let disposable;
  try {
    signal.addEventListener('abort', (e) => e.stopImmediatePropagation());
    disposable = addAbortListener(signal, (e) => {
      // Do something when signal is aborted.
    });
  } finally {
    disposable?.[Symbol.dispose]();
  }
}
```

#### Parameters

| Name | Type |
| :------ | :------ |
| `signal` | `AbortSignal` |
| `resource` | (`event`: `Event`) => `void` |

#### Returns

`Disposable`

Disposable that removes the `abort` listener.

**`Since`**

v20.5.0

#### Inherited from

IncyclistService.addAbortListener