# incyclist-services

This repository contains the business logic of the [Incyclist](https://incyclist.com)
indoor cycling app, published on npm as
[`incyclist-services`](https://www.npmjs.com/package/incyclist-services).

Incyclist separates its user interfaces from its business logic. The front-ends,
[`web-ui`](https://github.com/incyclist/web-ui) (React, used by the desktop app) and the
mobile app (React Native), decide *how* things are rendered. This library decides *what* is
rendered: device pairing, rides, workouts, routes, activities, settings, third-party app
connections, and so on. A front-end should not contain business logic. If you're changing
behaviour, this is usually the right repo.

```
incyclist-devices ──► incyclist-services ──► web-ui ──► desktop app (Electron)
(trainers, sensors)    (this repo)        └─► mobile app (React Native)
```

## Getting started

**Prerequisites:** Node.js 24 or newer (CI tests against 24.x and 25.x) and npm.

```bash
git clone https://github.com/incyclist/services.git
cd services
npm install
npm run build
npm test
```

If the build and the unit tests pass, you're set up. You don't need any devices, accounts or
credentials to work on this repo: unit tests mock everything external.

## Available scripts

| Script | Purpose |
|---|---|
| `npm run build` | Build ESM (`lib/esm`) and CJS (`lib/cjs`) output |
| `npm run dev` | Watch mode: rebuilds `lib/esm` on every change (see below) |
| `npm test` | Run the unit tests. Scope to a file or folder with `npm test -- <path>` |
| `npm run coverage` | Unit tests with a coverage report |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript type check (`tsc --noEmit`), including test files |
| `npm run test:e2e` | E2E tests against real backends. Maintainers only, see below |

Don't run bare `npx jest` or `npm run test:all`: both include the E2E tests.

### About E2E tests

Files named `*.e2e.test.ts` talk to real services (Incyclist backend, Strava, Komoot,
intervals.icu, VeloHero, ...). They need credentials in a local `.env` file and can create or
change real data. Contributors don't need them. CI runs the unit tests, lint and type check
only.

## Working on services together with a front-end

To see your changes in the running app, clone [`web-ui`](https://github.com/incyclist/web-ui)
and [`devices`](https://github.com/incyclist/devices) next to this repo:

```
<your-folder>
├── services   (this repo)
├── devices
└── web-ui
```

In dev mode, `web-ui` loads both `incyclist-services` and `incyclist-devices` from these
sibling folders (`../services/lib/esm`, `../devices/lib/esm`) instead of `node_modules`. So:

1. Run `npm install` and `npm run build` once in `devices` and in `services`.
   `lib/esm` must exist in both.
2. Run `npm run dev` here. It rebuilds on every change.
3. Run `npm run dev` in `web-ui`. Every change you save here now shows up in the UI.

See the [web-ui README](https://github.com/incyclist/web-ui#readme) for how to point the
desktop app at your local UI.

## Project structure

Each folder under `src/` is a domain module with its own `index.ts`, `types.ts`, service
classes and colocated `*.unit.test.ts` files.

| Module | What it covers |
|---|---|
| `activities` | Recording, saving, listing and uploading completed rides |
| `api` | Platform bindings (file system, settings, BLE/ANT+/serial, MQTT, ...) and REST helpers |
| `apps` | Connected third-party apps: Strava, intervals.icu, Komoot, ... |
| `appstate` | App state and feature toggles |
| `autoupdate` | UI bundle update checks |
| `avatars` | Rider avatars |
| `base` | Base classes and decorators shared by all services |
| `coaches` | Virtual riders to ride against |
| `devices` | Device configuration, access, pairing and in-ride device handling |
| `fileaccess` | Loading local and external files |
| `i18n` | Localization, countries, units |
| `maps`, `services` | Map areas and OpenStreetMap (Overpass) queries |
| `monitoring` | Online/offline status |
| `ride` | The live ride: display, controls, route/workout/video ride modes |
| `routes` | Route list, parsing, download and import |
| `settings` | User settings |
| `ui` | UI-facing helpers |
| `video` | Video handling for video routes |
| `workouts` | Workout list, import, parsing and execution |

Everything consumers may use is exported from `src/index.ts`:

```ts
import { useDeviceConfiguration, initUserSettings } from 'incyclist-services'
```

`useXXX()` returns a service singleton, and `initXXX()` initializes one where needed.

## Route servers

Besides the built-in Incyclist route server, the app can load routes from additional route
servers. Each route remembers the server it came from, and that server's name is its *Source*
in the route list filter.

### Adding a route server as a user

In the app, open **Settings › Routes** (or the **Import Routes** dialog) and choose
**Add route server**. Pick a server from the known list, or enter an address and a name:

- The address must be `https://`. Plain `http://` is accepted only for servers on your home
  network (`localhost`, private IP addresses, `*.local` names and single-label names such as
  `nas`), and not on devices that don't allow it (currently Android).
- The name (up to 24 letters, numbers, spaces or dashes) is the label shown in the route list.
  It must not clash with an existing source such as `Local`, `Incyclist` or a connected app.

The server is checked before it is saved. Servers are stored in the user settings under
`routes.servers.<name>`, so a server can also be added by hand in `settings.json`. Entries
written there are not validated by the app and keep loading as they are.

### Adding a server to the known list (maintainers)

The known list is the data file [`src/routes/servers/known-servers.json`](./src/routes/servers/known-servers.json).
It ships empty. While it is empty, the add screen only offers manual entry. To list a server,
add an entry. No code change is needed:

```json
[
  {
    "id": "alpine-video-club",
    "name": "Alpine Videos",
    "url": "https://videos.example.org/api/v1/routes",
    "description": "Alps & Dolomites, 40+ climbs",
    "operator": "Alpine Video Club"
  }
]
```

| Field | Rules |
|---|---|
| `id` | Required, stable and unique. Used for logging. |
| `name` | Required. Same rules as a user-entered name (see above). Becomes the source name. |
| `url` | Required. `https://` only. The server's routes API base URL. |
| `description` | Required. One short line, about 40 characters. |
| `operator` | Optional. Shown as "by ...". |

Test the server against Incyclist before listing it. A unit test checks every entry against
the name and URL rules and for unique ids and URLs, so run `npm test -- src/routes/servers`
after editing the file. The list is part of the UI bundle, so a change reaches users with the
next bundle release.

### What a route server must provide

A route server is a plain HTTPS service. Incyclist checks a server by requesting
`<base-url>/?type=video`, which must answer with a JSON array of
[`RouteApiDescription`](./src/routes/base/api/types.ts#L11) objects. Route details are then
requested from `<base-url>/<route-id>`, which must answer with a
[`RouteApiDetail`](./src/routes/base/api/types.ts#L51). A reachable server that answers
something else, such as an HTML page or a 404, is rejected as "not a route server". Redirects
that would lead to a URL the app would not accept (for example from `https://` to `http://`)
are rejected too.

GPX routes are optional. The app also requests `<base-url>?private=false` for them. A server
that does not support this request is still loaded normally and keeps its video routes.

## Using this library in your own app

The library never calls platform APIs directly. File access, settings storage, secrets,
Bluetooth, ANT+ and so on all go through bindings (`src/api/bindings/`) that the host app
must provide at startup. A fork or a new front-end has to supply its own implementations.
The existing front-ends (`web-ui` for browser/Electron, the mobile app for React Native)
are the reference for how this is done.

## Contributing

Contributions are welcome. Please read:

- [CONTRIBUTING.md](./CONTRIBUTING.md): workflow, branches, pull requests
- [docs/CODEBASE_GUIDE.md](./docs/CODEBASE_GUIDE.md): architecture, coding style and testing
  conventions. Please read this before writing code.

## License

[MIT](./LICENSE)
