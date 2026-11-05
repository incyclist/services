# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`incyclist-services` is the business logic library of the [Incyclist](https://incyclist.com)
indoor cycling app, consumed by `web-ui` and the mobile app. It publishes dual ESM + CJS builds.

**Read [docs/CODEBASE_GUIDE.md](docs/CODEBASE_GUIDE.md) before touching any file in this repo.**
It covers the module layout, variant hierarchies, the service pattern, page services, bindings,
coding style, SonarQube rules, and testing conventions, including how to mock singletons with
`Inject`. Follow it, don't improvise a different structure. [CONTRIBUTING.md](CONTRIBUTING.md)
covers branches, commits and PRs.

## Commands

```bash
npm run build          # Build both ESM and CJS
npm run dev            # Watch mode (ESM)
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit (includes test files)
npm test               # Unit tests (jest.unit-config.cjs)
npm test -- <path>     # Unit tests for one file or folder
npm run coverage       # Unit tests with coverage
npm run test:e2e       # E2E tests: real backends, only when explicitly asked
```

## Rules for agents

- **Never run bare `npx jest` (or `jest`, or `npm run test:all`) without a file argument and a
  `-c` flag.** It falls back to the default config, whose `testRegex` matches everything,
  including `*.e2e.test.ts`, which hit real backends and can create or change real test data.
  Use `npm test` / `npm test -- <path>`.
- **Self-review against the SonarQube list before calling a change done.** SonarCloud only reports
  after a push, so it can't be the first line of defense. Re-read your own diff once specifically
  against the "SonarQube rules" section of the codebase guide, not just for functional
  correctness. This has been missed repeatedly. Re-check cognitive complexity on functions you
  extended, not only on new ones.
- Before committing, run `npm run lint`, `npm run typecheck` and `npm test`.
