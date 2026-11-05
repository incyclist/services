# Services Codebase Guide

This document explains how `incyclist-services` is organized: the module layout, the service
pattern, page services, bindings, coding style, and testing conventions. It's aimed at
developers joining the project. The top-level [README.md](../README.MD) covers setup and the
npm scripts. This guide goes one level deeper: the conventions that only become visible by
reading a lot of the code.

If you're an AI agent working in this repo, this is your primary reference for how code is
organized. Follow these conventions rather than inventing new ones.

## Where this library sits

`incyclist-services` holds the business logic of the Incyclist app and is the authoritative
layer for all domain operations. It is consumed by two front-ends:

- [`web-ui`](https://github.com/incyclist/web-ui) (React), rendered inside the Electron desktop app
- the mobile app (React Native, Android + iOS)

It depends on [`incyclist-devices`](https://github.com/incyclist/devices) for trainer, HRM and
sensor access, and on `gd-eventlog` for logging.

The guiding rule: **services decide *what* is shown, the front-ends decide *how*.** Display
props, states, navigation targets and validation belong here. Layout, animation and
dialog rendering belong in the consuming app. A service never imports React or touches the DOM.

## Module layout (`src/`)

Each top-level directory under `src/` is a domain module (`activities`, `devices`, `ride`,
`workouts`, `routes`, `settings`, `coaches`, `apps`, ...). Each module follows this internal
structure:

```
src/<module>/
├── index.ts          # barrel export
├── types.ts          # interfaces and types for this module
├── service.ts        # main service class (or descriptively named)
├── *.unit.test.ts    # unit tests colocated with source
└── base/             # base classes scoped to this module
```

Cross-cutting folders:

```
src/api/          platform abstraction (bindings) plus REST/fetch/repository helpers
src/base/         IncyclistService base class, decorators (@Singleton, @Injectable, Inject),
                  IncyclistPageService base class, card lists
src/utils/        generic helpers
src/index.ts      the public API: everything consumers can import
__tests__/        shared test data and test utilities (not test files)
```

### Variant hierarchies (platform subclasses)

When a module needs more than one concrete implementation of the same contract, most commonly
a desktop vs. mobile split, **give each variant its own folder. Never put an abstract base
class and all its subclasses flat in one folder.** A folder holding more than one concrete
`service.ts` for the same contract is the signal to split.

Reference layout (`src/devices/page/`, a base class with a desktop and a mobile subclass):

```
src/<module>/
├── index.ts              # barrel; picks the right variant by platform/channel
├── types.ts              # pure re-export barrel: `export type * from './base/types'` etc.,
│                          # never new types of its own
├── base/
│   ├── service.ts         # the abstract class: shared logic and abstract/overridable hooks only
│   └── types.ts           # types shared by every variant
├── desktop/
│   ├── service.ts         # extends the base class; only this platform's differences
│   └── types.ts           # types that extend/specialise the base ones for this variant only;
│                           # omit this file if the variant adds no types of its own
└── mobile/
    ├── service.ts
    └── types.ts
```

Rules:
- One concrete class per variant folder, named after its role, not the folder. For example,
  `DesktopPairingPageService` lives in `desktop/service.ts`.
- A variant's own `types.ts` only ever *extends or narrows* the base types
  (`Omit<BaseProps,...> & {...}`). It never redefines a field the base already owns.
- The module's top-level `types.ts` stays a barrel. If you're adding an actual `type` or
  `interface` body there, the module has outgrown the barrel. Split it instead.

Keeping every exported type in the owning folder's `types.ts` (never inline in `service.ts`,
never in a sibling file) matters beyond readability: it would let the types be extracted into
a separate package later by moving files, not rewriting them.

## The service pattern

All services follow the same skeleton:

```typescript
@Singleton
export class MyService extends IncyclistService {
    constructor() {
        super('MyService')   // sets logger name
    }

    @Injectable
    protected getDep(): DepType {
        return useDep()      // resolved from DI container in tests
    }
}

export const useMyService = () => new MyService()
```

- `@Singleton` enforces a single instance: `new MyService()` always returns the same object.
- `@Injectable` marks getters that return another service, so tests can swap them with
  `Inject(...)`. Every `protected` getter that returns another service of this library or a
  dependency **must** be decorated. The injection key is the method name minus the leading
  `get` (`getApi` → `'Api'`, `getUserSettings` → `'UserSettings'`).
- `IncyclistService` extends `EventEmitter` and provides `this.logEvent(...)` and
  `this.logError(err, method, context)` via `gd-eventlog`.

### Naming

Domain services follow `<ObjectType><Action>Service`, e.g. `WorkoutService`,
`WorkoutListService`, `ActivityRideService`.

### Public API

Consumers import from the package root:

```ts
import { useDeviceConfiguration, initUserSettings } from 'incyclist-services'
```

- `useXXX()` returns the service singleton.
- `initXXX(...)` performs an explicit initialization where a service needs one.

Every module re-exports its public surface through `src/index.ts`. **When adding a new
export, register it there.** Anything not exported from `src/index.ts` is internal.

### Observer pattern for async operations

Long-running operations return an `Observer` that callers chain:

```typescript
const observer = service.init()
observer
  .on('data', (data) => { /* ... */ })
  .on('error', (err) => { /* ... */ })
  .once('completed', () => { /* ... */ })
```

Services emit state transitions (`'Starting'`, `'Active'`, `'Paused'`, `'Finished'`,
`'error'`) on the observer.

## Page services

A page service (`IncyclistPageService`, in `src/base/pages/`) aggregates domain services for
one screen and emits display props via `getPageDisplayProps()`. The front-end subscribes and
renders whatever it returns.

- Naming: `<ObjectType><Action>PageService`, e.g. `WorkoutListPageService`, `RouteRidePageService`.
- The mobile app uses page services throughout.
- `web-ui` mostly calls domain services directly and is migrating page by page. New
  `web-ui` screens go through a page service.
- When a screen has real platform-specific behaviour, the shared logic goes in a
  `<ObjectType><Action>PageService` base class. `Desktop...` / `Mobile...` subclasses hold
  only the differences, using the variant-folder layout above. `src/devices/page/` is the
  reference example.

## Bindings (platform abstraction)

This library runs on Electron, in the browser and on React Native. **It never calls platform
APIs directly.** File system, settings storage, secrets, MQTT, BLE/ANT+/serial transports,
downloads, crypto and so on are all reached through the `IncyclistBindings` singleton in
`src/api/bindings/`:

```ts
const fs = getBindings()?.fs
```

Each consuming app injects its own implementations at startup. To add a new platform
capability:

1. Define the interface in `src/api/<capability>/types.ts`.
2. Add the property to `IncyclistBindings` in `src/api/bindings/index.ts`.
3. Implement and register it in each consuming app. That's a separate PR in each app's repo.

Never import `node:fs`, `electron`, or React Native modules into a service to get around
this.

## Feature toggles

Unfinished features are hidden behind toggles: `useAppState().hasFeature('MY_FEATURE')`
(`src/appstate/`). Add the name to the `FeatureToggle` union in `src/appstate/types.ts`.
A toggle defaults to `false` unless the user's settings set it to `true`, so a toggled-off
feature can be merged and released safely.

## Secrets

Never hardcode secrets (API keys, client IDs, tokens). Read them through the secret binding,
e.g. `getBindings().secret`, as the existing third-party integrations in `src/apps/` do.

## Coding style

### Naming

| Construct | Convention | Example |
|---|---|---|
| Classes | PascalCase | `RideDisplayService` |
| Interfaces | PascalCase, `I`-prefix for structural contracts | `IObserver`, `ICurrentRideService` |
| Types / Enums | PascalCase | `RideType`, `CoachType` |
| Hook functions | camelCase `useXXX` / `initXXX` | `useActivityRide()` |
| Constants | UPPER_SNAKE_CASE | `SYNC_INTERVAL` |
| Private fields | `_` prefix or TypeScript access modifier | `_state`, `private observer` |

### Formatting

There's no auto-formatter (no Prettier). ESLint (`eslint.config.mjs`) enforces
`js.configs.recommended` plus `typescript-eslint` recommended rules.

- **Indentation**: 4 spaces, no tabs.
- **Quotes**: single quotes for strings and import paths.
- **Semicolons**: omitted. Don't add them in new code.
- **Blank lines**: one blank line between logical groups of class members; no trailing whitespace.
- **Imports**: external packages, then internal modules, then the file's own siblings.

### TypeScript

- Target is ES2024. Don't add workarounds for older targets.
- No lax `any`: use proper types or `unknown`.
- Types and interfaces live in `types.ts`, not inline in implementation files.

### SonarQube rules

SonarCloud analyzes every push. These are its recurring findings, so apply them while
writing code:

- Built-in Node modules use the `node:` prefix: `import fs from 'node:fs'`, not `'fs'`.
- Last array element: `arr.at(-1)`, not `arr[arr.length - 1]`.
- NaN checks: `Number.isNaN(x)`, not the global `isNaN(x)`. NaN values: `Number.NaN`, not `NaN`.
- Existence plus property chains: `step?.power === undefined`, not
  `step === undefined || step.power === undefined`.
- Cognitive complexity: functions above ~15 get flagged. Extract small named helpers per
  concern as you write. This also applies to a function you're *extending*: one more branch
  can push an already-dense function over the threshold.

### Documentation

Every publicly exported function, method and class needs a JSDoc comment: at least a
one-line description, plus `@param` / `@returns` when the signature isn't self-explanatory.
Internal, private and protected members don't need JSDoc.

## Testing

Tests use **Jest** with `ts-jest`.

### Unit vs. E2E tests

| Suffix | What it is | Run by |
|---|---|---|
| `*.unit.test.ts` | Unit tests, all dependencies mocked | `npm test`, CI |
| `*.e2e.test.ts` | Tests against **real backends** (Incyclist APIs, Strava, Komoot, ...) | `npm run test:e2e`, only on purpose |

E2E tests need credentials in a local `.env` file and can create or change real data on those
services. They're for maintainers. Contributors only need unit tests.

**Never run bare `npx jest` (or `npm run test:all`).** Without `-c jest.unit-config.cjs`, Jest
uses the default config, which matches *every* test, E2E included. To run one file or
folder, use `npm test -- <path>`.

### Conventions

- Test files sit next to the source they test: `<module>.unit.test.ts`.
- One `describe` block per method, with `test` blocks for individual cases, in the same order
  as the methods appear in the file under test.
- Test names describe the behaviour being tested. Don't start them with "should".
- Mock all external dependencies. Clear mocks in `afterEach` / `afterAll` so the next test file
  starts clean.
- Test protected methods indirectly, through the public methods that call them.
- Test data goes in `__tests__/` (repo root), organised by what it represents (user, routes,
  workouts, ...).
- Tests must be deterministic: no random data, no reliance on external state. `TZ` is forced
  to `UTC` for all test runs.
- If a service reacts to observer messages, simulate the message flow and check the outcome.
  For page services, check `getPageDisplayProps()` after a handler emits `page-update`.
- Don't use `toMatchSnapshot()` for results containing computed floating-point numbers
  (`heading`, `slope`, `distance`, ...). The last binary digits differ between CPU
  architectures (Apple Silicon vs. x86). Use `expectToMatchFixture(actual, fixturePath)` from
  `__tests__/utils/fixture.ts`, which compares against a JSON fixture with a relative
  tolerance. Run with `UPDATE_FIXTURES=1` to (re)create the fixture.

### Mocking singleton dependencies

Inject mocks for `@Injectable` getters with `Inject` from `base/decorators`. **Never**
monkey-patch the getter on the service instance.

```typescript
import { Inject } from '<path>/base/decorators'
import { UserSettingsService } from '<path>/settings'

const UserSettingsMock: Partial<UserSettingsService> = {
    get: jest.fn((_key: string, defValue: unknown) => defValue),
}

beforeEach(() => {
    service = new MyService()
    Inject('UserSettings', UserSettingsMock)   // name matches the singleton registration
})

afterEach(() => {
    Inject('UserSettings', null)               // restore so other tests are not affected
    jest.clearAllMocks()
})
```

- The first argument is the registered name (`'UserSettings'`, not `'UserSettingsService'`).
- Type the mock as `Partial<ServiceClass>` so you only provide what the test uses.
- Always restore with `Inject('ServiceName', null)` in `afterEach`.
