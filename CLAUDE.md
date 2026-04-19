# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

This is `incyclist-services`, the business logic library for the [Incyclist](https://incyclist.com) Indoor Cycling App. It provides React-consumable services (via `useXXX` / `initXXX` hooks) for devices, workouts, routes, activities, rides, and more. The library publishes dual ESM + CJS builds.

## Commands

```bash
npm run build          # Build both ESM and CJS
npm run build:esm      # ESM only (tsc -p tsconfig.esm.json)
npm run build:cjs      # CJS only (tsc -p tsconfig.cjs.json)
npm run dev            # Watch mode (ESM)
npm run lint           # ESLint
npm test               # Unit tests with coverage
npm run test:unit      # Unit tests with coverage (jest.unit-config.cjs)
npm run test:e2e       # E2E tests
npm run test:all       # All tests
```

To run a single test file:
```bash
npx jest src/path/to/file.unit.test.ts
```

## Architecture

### Module Layout

Each top-level directory under `src/` is a domain module (`activities`, `devices`, `ride`, `workouts`, `routes`, `settings`, `coaches`, etc.). Each module follows this internal structure:

```
src/<module>/
├── index.ts          # barrel export
├── types.ts          # interfaces and types for this module
├── service.ts        # main service class (or descriptively named)
├── *.unit.test.ts    # unit tests colocated with source
└── base/             # base classes scoped to this module
```

### Service Pattern

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

- `@Singleton` — enforces a single instance; `new MyService()` always returns the same object.
- `@Injectable` — marks getter methods so tests can swap them with `Inject('MyService')`.
- `IncyclistService` extends `EventEmitter` and exposes `this.logEvent(...)` / `this.logError(err, method, context)` via `gd-eventlog`.

### Observer Pattern for Async Operations

Long-running operations return an `Observer` that callers chain:

```typescript
const observer = service.init()
observer
  .on('data', (data) => { /* ... */ })
  .on('error', (err) => { /* ... */ })
  .once('completed', () => { /* ... */ })
```

Services internally emit state transitions (`'Starting'`, `'Active'`, `'Paused'`, `'Finished'`, `'error'`) on the observer.

### Public API Shape

The library is consumed by the React front-end as:

```ts
import { useDeviceConfiguration, initUserSettings } from 'incyclist-services'
```

Every domain module re-exports its public surface through `src/index.ts`. When adding a new export, register it there.

## Coding Style

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

There is no auto-formatter (no Prettier). ESLint (`eslint.config.mjs`) enforces `js.configs.recommended` + `typescript-eslint` recommended rules. Run `npm run lint` before committing.

- **Indentation**: 4 spaces (no tabs).
- **Quotes**: Single quotes for all strings and import paths.
- **Semicolons**: Omitted on most statements and imports. Do not add them when writing new code.
- **Trailing whitespace / blank lines**: One blank line between class members of different logical groups; no trailing whitespace.
- **Imports**: Group as — external packages, then internal modules, then the file's own siblings — with no blank lines between groups inside a file unless it aids clarity.

### TypeScript

- Target is ES2024; avoid hacks for older targets.
- No lax `any` — use proper types or `unknown`.
- Types and interfaces live in `types.ts`; keep implementation files clean of type sprawl.

### Documentation

All publicly exported functions, methods, and classes must have a JSDoc comment. At minimum include a one-line description; add `@param` / `@returns` tags when the signature is not self-explanatory. Internal/private/protected members do not require JSDoc.

## Testing

Guidelines from `.github/instructions/tests.instructions.md`:

- Test files: `<module>.unit.test.ts` or `<module>.e2e.test.ts`, colocated next to source.
- One `describe` block per method; `test` blocks for individual cases.
- Test case names describe the behavior being tested — do **not** start with "should".
- Mock all external dependencies; clear all mocks in `afterEach` / `afterAll`.
- Singletons are tagged `@Singleton`. Use `Inject('ClassName')` in tests to inject mock dependencies into `@Injectable` methods.
- Protected methods are tested indirectly through the public method flows that exercise them.
- Test data goes in a `__tests__/` subdirectory, organised by what it represents (user, routes, workouts, …).
- Imports order: external libraries → internal libraries → module under test.
- Tests must be deterministic; do not use random data or rely on external state.
