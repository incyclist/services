---
applyTo: '**'
---
# Claude Issue Processing

When you are assigned a GitHub issue to implement, follow this process exactly.

---

## 0. Initialise session tracking

Before doing anything else, record your session ID so the workflow can resume
this session if a correction run is needed later:

```bash
SESSION_ID=$(cat ~/.claude/history.jsonl 2>/dev/null | jq -r '.sessionId' | tail -1)
mkdir -p /tmp/claude-state
echo "$SESSION_ID" > /tmp/claude-state/session-id
touch /tmp/claude-state/completed-files
```

Do not commit these files. The workflow picks them up automatically after you finish.

---

## 1. Understand the Issue

Read the issue title and body carefully. The body is the full specification.
If anything is ambiguous, make reasonable assumptions consistent with the
existing codebase style documented in `CLAUDE.md`.

---

## 2. Implement the Changes

Follow all conventions in `CLAUDE.md`:
- Service pattern (`@Singleton`, `@Injectable`, `IncyclistService`)
- Naming conventions, formatting, and quote style
- Add JSDoc to all new public exports
- Place types in `types.ts`, not inline in implementation files
- Register any new public exports in `src/index.ts`

---

## 3. Verify Quality

If you changed any source code (anything under `src/`), run each check and fix
all issues before moving on to the next:

```bash
npm run lint        # fix all ESLint errors and warnings
npx tsc --noEmit    # fix all TypeScript errors
npm test            # fix all failing unit tests
```

Skip this step if your changes are limited to non-source files
(docs, workflows, config, etc.).

Do not skip or suppress errors. If a check reveals a pre-existing unrelated
issue, leave it as-is and note it in the PR description.

---

## 4. Commit

Commit frequently as you go — **do not wait until all acceptance criteria
are met**.

The commit bar is: **TypeScript compiles, lint passes, and tests pass** on the
current state of the codebase. You do not need to have met all acceptance
criteria before committing.

For tasks that involve multiple independent files (e.g. one test file per
class), commit after each file as soon as the three checks pass. This ensures
partial progress is preserved if the session ends before the task is fully
complete. A PR with 3 out of 5 files committed is recoverable. A PR with
0 commits is not.

**Never commit if tsc, lint, or npm test fail.** Partial acceptance criteria
coverage is fine. A broken build is not.

After each commit, record the completed file:

```bash
echo "src/path/to/completed-file.ts" >> /tmp/claude-state/completed-files
```

Use a descriptive commit message in this format:

```
<type>: <summary> (#<issue-number>)
```

Where `<type>` is one of: `feat`, `fix`, `refactor`, `test`, `docs`. Example:

```
feat: add FTP auto-detection to WorkoutRideService (#42)
```

Do NOT push — the workflow handles pushing the branch and opening the PR
after you finish.

---

## 5. Correction runs

If the prompt indicates this is a **correction run**, your session history
already contains full context from the previous run. Do not re-read files
you already processed.

1. Run `git log --oneline -10` and `git status` to confirm what is already
   committed.
2. Apply only the correction instruction — do not redo work that is already
   committed.
3. Follow the normal verify → commit cycle for any new or changed files.
4. Record newly completed files in `/tmp/claude-state/completed-files` as
   usual.

If the prompt indicates this is a **retry run**, treat it as a completely
fresh start — ignore any previous session state and process the issue from
the beginning.
