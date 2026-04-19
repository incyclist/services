---
applyTo: '**'
---
# Claude Issue Processing

When you are assigned a GitHub issue to implement, follow this process exactly.

## 1. Understand the Issue

Read the issue title and body carefully. The body is the full specification. If anything is ambiguous, make reasonable assumptions consistent with the existing codebase style documented in `CLAUDE.md`.

## 2. Create a Branch

Branch off `master` using this naming convention:

```
claude/issue-{number}-{slug}
```

Where `{slug}` is a short kebab-case summary derived from the issue title (max 5 words). Examples:
- Issue #42 "Add FTP auto-detection to workout service" → `claude/issue-42-ftp-auto-detection`
- Issue #7 "Fix crash when route list is empty" → `claude/issue-7-fix-empty-route-list-crash`

## 3. Implement the Changes

Follow all conventions in `CLAUDE.md`:
- Service pattern (`@Singleton`, `@Injectable`, `IncyclistService`)
- Naming conventions, formatting, and quote style
- Add JSDoc to all new public exports
- Place types in `types.ts`, not inline in implementation files
- Register any new public exports in `src/index.ts`

## 4. Verify Quality

Run each check and fix all issues before moving on to the next:

```bash
npm run lint        # fix all ESLint errors and warnings
npx tsc --noEmit    # fix all TypeScript errors
npm test            # fix all failing unit tests
```

Do not skip or suppress errors. If a check reveals a pre-existing unrelated issue, leave it as-is and note it in the PR description.

## 5. Commit

Use a short, descriptive commit message in this format:

```
<type>: <summary> (#<issue-number>)
```

Where `<type>` is one of: `feat`, `fix`, `refactor`, `test`, `docs`. Example:

```
feat: add FTP auto-detection to WorkoutRideService (#42)
```

## 6. Create a Pull Request

Push the branch and open a PR against `master` with this structure:

**Title:** concise summary of the change (under 70 characters)

**Body:**
```
## Summary
- <bullet points describing what changed and why>

## Test plan
- <checklist of what to verify manually or via tests>

Closes #<issue-number>
```
