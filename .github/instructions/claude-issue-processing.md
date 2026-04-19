---
applyTo: '**'
---
# Claude Issue Processing

When you are assigned a GitHub issue to implement, follow this process exactly.

## 1. Understand the Issue

Read the issue title and body carefully. The body is the full specification. If anything is ambiguous, make reasonable assumptions consistent with the existing codebase style documented in `CLAUDE.md`.

## 2. Implement the Changes

Follow all conventions in `CLAUDE.md`:
- Service pattern (`@Singleton`, `@Injectable`, `IncyclistService`)
- Naming conventions, formatting, and quote style
- Add JSDoc to all new public exports
- Place types in `types.ts`, not inline in implementation files
- Register any new public exports in `src/index.ts`

## 3. Verify Quality

If you changed any source code (anything under `src/`), run each check and fix all issues before moving on to the next:

```bash
npm run lint        # fix all ESLint errors and warnings
npx tsc --noEmit    # fix all TypeScript errors
npm test            # fix all failing unit tests
```

Skip this step if your changes are limited to non-source files (docs, workflows, config, etc.).

Do not skip or suppress errors. If a check reveals a pre-existing unrelated issue, leave it as-is and note it in the PR description.

## 4. Commit

Once all checks pass, commit your changes using a short, descriptive commit message in this format:

```
<type>: <summary> (#<issue-number>)
```

Where `<type>` is one of: `feat`, `fix`, `refactor`, `test`, `docs`. Example:

```
feat: add FTP auto-detection to WorkoutRideService (#42)
```

Do NOT push — the workflow handles pushing the branch and opening the PR after you finish.
