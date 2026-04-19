# Contributing to incyclist-services

Thank you for your interest in contributing! This document covers everything you need to get started.

## Development Environment Setup

**Prerequisites:** Node.js (check `.nvmrc` or `package.json` for the required version) and npm.

```bash
git clone https://github.com/incyclist/services.git
cd services
npm install
```

To verify your setup, run the build:

```bash
npm run build
```

## Running Tests and Linting

```bash
npm run lint          # ESLint — fix all warnings and errors before committing
npm test              # Unit tests with coverage
npm run test:unit     # Unit tests only
npm run test:e2e      # End-to-end tests
npm run test:all      # All tests
```

To run a single test file:

```bash
npx jest src/path/to/file.unit.test.ts
```

All checks must pass before a pull request can be merged. Do not skip or suppress errors.

## Branch Naming Conventions

Use the format:

```
<type>/issue-<number>-<short-description>
```

Where `<type>` is one of: `feat`, `fix`, `refactor`, `test`, `docs`. Examples:

```
feat/issue-42-ftp-auto-detection
fix/issue-99-device-pairing-crash
docs/issue-413-add-contributing-md
```

## Commit Message Format

Use a short, descriptive message in this format:

```
<type>: <summary> (#<issue-number>)
```

Where `<type>` is one of: `feat`, `fix`, `refactor`, `test`, `docs`. Examples:

```
feat: add FTP auto-detection to WorkoutRideService (#42)
fix: resolve crash during device pairing on reconnect (#99)
docs: add CONTRIBUTING.md (#413)
```

Keep the summary concise (under 72 characters). Do not end with a period.

## Submitting a Pull Request

1. Fork the repository and create a branch from `main` following the branch naming convention above.
2. Implement your changes following the conventions in [`CLAUDE.md`](./CLAUDE.md):
   - Use the `@Singleton` / `@Injectable` / `IncyclistService` service pattern.
   - Place types and interfaces in `types.ts`, not inline in implementation files.
   - Register any new public exports in `src/index.ts`.
   - Add JSDoc to all publicly exported functions, classes, and methods.
   - Use 4-space indentation, single quotes, and omit semicolons.
3. Run all checks and fix any issues:
   ```bash
   npm run lint
   npx tsc --noEmit
   npm test
   ```
4. Commit your changes using the commit message format described above.
5. Push your branch and open a pull request against `main`.
6. In the pull request description, summarise what changed and why. Reference the issue number (e.g. `Closes #42`).

Pull requests are reviewed by maintainers. Please be responsive to feedback and update your branch as requested.
