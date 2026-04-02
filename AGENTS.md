## Working Rules
- Keep this file short. Route to deeper repo docs instead of inlining everything.
- Treat this file as the repo-local layer. Shared Codex workflow defaults should live in the user's global `AGENTS.md`, not be duplicated here.
- Add only repo-specific overrides, local conventions, or exceptional workflow rules here when they materially differ from the shared global harness.
- If this repo is Node-based, keep the repo-local dependency hardening baseline in place and rerun `$node-supply-chain-hardening` before dependency, lockfile, or package-manager changes.

## Repo Continuity
- Treat repo artifacts as durable memory.
- Keep durable project documentation in `docs/`.
- Use `resources/` for local reference material such as dependency source, copied API docs, or external specs; keep it gitignored.
- Keep active plans in `plans/active/`, completed plans in `plans/completed/`, and ongoing workflow debt in `plans/harness-debt.md`.
- Register durable non-code context in `.socraticodecontextartifacts.json`, especially `plans`, `docs`, and `resources` when they matter.
