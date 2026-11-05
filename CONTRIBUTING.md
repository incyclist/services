# Contributing to incyclist-services

Thank you for your interest in contributing! This repo is MIT-licensed and open to everyone.
This document covers how to get set up and how changes get from your branch into `main`.

## Development environment setup

**Prerequisites:** Node.js 24 or newer (see `.github/workflows/PR.yml` for the versions CI
tests against) and npm.

```bash
git clone https://github.com/incyclist/services.git
cd services
npm install
npm run build
npm test
```

No devices, accounts or credentials are needed: the unit tests mock everything external. If
you want to see your change in the running app, see "Working on services together with a
front-end" in [README.MD](./README.MD).

## Before you start

For anything beyond a trivial fix (typo, small doc change, obvious one-line bug), please open
an issue first, or comment on an existing one, describing what you want to change and why.
This avoids effort on a PR that turns out not to be the right direction. Small, obvious
fixes can go straight to a PR.

Changes to this library often affect both front-ends (desktop/web and mobile). If your change
alters behaviour a user can see, mention that in the issue so we can agree on it for both.

## Code conventions

**Read [docs/CODEBASE_GUIDE.md](./docs/CODEBASE_GUIDE.md) before writing code, and follow
it.** It covers the module layout, the service pattern (`@Singleton`, `@Injectable`,
`IncyclistService`), page services, platform bindings, coding style, and testing
conventions. PRs that don't follow it will be asked to be reworked.

The points reviews most often come back to:

- Types and interfaces go in the module's `types.ts`, not inline in implementation files.
- New public exports are registered in `src/index.ts`.
- Publicly exported functions, classes and methods have JSDoc.
- No platform APIs in services: use the bindings.
- No secrets in code.
- 4-space indentation, single quotes, no semicolons.

## Testing

Every change needs unit tests (`*.unit.test.ts`, next to the file under test). Before you
push, run:

```bash
npm run lint
npm run typecheck
npm test
```

All three must pass. CI runs the same checks plus the build on every push, and SonarCloud
analyses the code. Don't skip or suppress errors.

To run a single test file or folder, use `npm test -- <path>`. **Don't run bare `npx jest`
or `npm run test:all`**: they include the E2E tests, which hit real backends and need
credentials you won't have.

## Branch naming and commits

Use a short, descriptive branch name prefixed with the type of change:

```
fix/device-pairing-reconnect-crash
feat/ftp-auto-detection
docs/update-contributing-guide
```

Commit messages follow a loose [Conventional Commits](https://www.conventionalcommits.org)
style, `<type>: <short summary>`, where `<type>` is one of `feat`, `fix`, `refactor`, `test`,
`chore`, `docs`:

```
fix: resolve crash during device pairing on reconnect
feat: add FTP auto-detection to WorkoutRideService
```

No issue number is required in the commit message. Reference the issue in the PR description
instead.

## Submitting a pull request

`main` is protected: nobody pushes to it directly, and every change goes through a reviewed
pull request.

1. Clone the repository and create a branch from `main` following the naming convention
   above. If you don't have push access yet, ask in your issue, or open the PR from a fork.
2. Implement your change, following [docs/CODEBASE_GUIDE.md](./docs/CODEBASE_GUIDE.md).
3. Run `npm run lint`, `npm run typecheck` and `npm test`, and fix any failures.
4. Push your branch and open a pull request against `main`.
5. In the description, summarise what changed and why, and link the related issue if there
   is one (e.g. `Closes #42`).

The maintainer reviews every pull request and merges it once it's ready. Please respond to
feedback and update your branch as requested.

## Releases

Releases to npm are made by the maintainer. Don't bump the version in `package.json` in your
PR.
