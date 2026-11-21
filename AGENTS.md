# AGENTS.md

## Repository Identity

The project is `iglo.monitor`; its canonical repository is https://github.com/iglo-tech/iglo.monitor and its default branch is `main`.

iglo.monitor is an independently maintained architectural rewrite derived from the Uptime Kuma v2.4.0 codebase. It is not an upstream-parity fork and is not intended to operate as a public open-source community project.

The repository is published "as is": no formal support process, no issue triage process, no release promise, and no community governance files.

## North Star

iglo.monitor is growing from an uptime monitor into one self-hosted place for **uptime, errors, and logs**, built for solo founders and very small teams, shipped as one binary with SQLite, and fully operable by AI agents through MCP. Read [docs/north-star.md](docs/north-star.md) for the principles, scale envelope, non-goals, and fixed architecture decisions. Work is tracked as GitHub issues, with one milestone per stage and dependencies set as GitHub "blocked by" links. [docs/roadmap.md](docs/roadmap.md) explains how to pick an issue and the default definition of done. If a task conflicts with the north star, raise it instead of choosing silently.

## Current Stack

- Backend: Bun 1.4 runtime, native ESM modules (`import`/`export`), Express compatibility routes, and Bun-native HTTP/WebSocket paths.
- Frontend: Vue 3, Vite, Bootstrap-based UI.
- Database layer: SQLite only through the Bun-native compatibility store; MariaDB/MySQL are not supported as application databases.
- Package manager today: Bun with `bun.lock`.
- Distribution today: one compiled executable produced by `bun run build`.
- Development today: `bun run dev` for source runs; `bun src/server/server.ts` for backend-only work.

## Target Direction

- Fix architecture and correctness before pursuing runtime novelty or upstream feature parity.
- Replace god modules, hidden global state, barrel imports, service locators, and compatibility layers with explicit ownership and direct dependencies. Effect services provided through layers (D16) are the sanctioned dependency mechanism; they count as explicit dependencies, not as a service locator.
- Foundation before features: no feature work until the Stage F exit gate issue (#120) is closed. Do not add code on top of untyped or `@ts-nocheck` code; rewrite what you depend on first.
- Rewrite module by module into Effect behind characterized data and wire contracts (the FND-006 suite, #109). Whole-module rewrites are expected; untested big-bang replacements are not. Rewrites change structure, not behaviour.
- The backend is written in Effect (decision D16). Follow `docs/effect.md` (created in FND-005, #108): services and layers for dependencies, tagged errors for expected failures, `Schema` at every boundary, scopes for resources. The SDK and the Vue frontend do not use Effect.
- Typecheck with TypeScript 7 native (`tsrs`) in `strict` mode and lint with `@cloudflare/oxlint-config` (decision D17). Early, next-generation tooling is deliberate; pin exact versions. Disable a lint rule only with a reason comment.
- Keep runtime execution and package management on Bun, but use Bun APIs only where they make the design smaller, clearer, or measurably better.
- Keep SQLite as the only application database. Preserve the tested Uptime Kuma SQLite upgrade path and the `kuma.db` filename; do not add database backends for upstream parity.
- Keep the application recognizable while allowing internal and UI architecture to change substantially.
- Ship one compiled executable. Do not add Docker, compose, or parallel distribution paths unless explicitly requested.

## Repository Decisions

- Prefer `@/` path-alias imports across backend, frontend, scripts, and tests. Do not introduce relative imports (`./`, `../`) unless there is no practical alternative (for example auto-generated asset bundles, JSON `import ... with { type: "json" }` from a nearby file, or a tool that cannot resolve aliases).
- Import from the module that owns a symbol. Do not add barrel files, transitional re-export barrels, generic registries, or a new compatibility facade unless a real external contract requires one.
- Do not add `@ts-nocheck`, broad `any` facades, or process-global state. A file you rewrite must end up without `@ts-nocheck` and compile under `strict`. Type existing runtime contracts as they are instead of redesigning payloads for type convenience.
- Renames are intentionally breaking for configuration and external payloads; do not retain aliases. The only compatibility path is the automatic Uptime Kuma SQLite importer, while the `kuma.db` filename and tested upgrade path remain fixed.
- Do not add npm or Node fallback paths for default runtime, package-manager, or verification workflows.
- Do not restore upstream community files such as `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue templates, PR templates, stale workflows, release workflows, or sponsor/funding files.
- Dependency update automation uses Renovate via `renovate.json`; do not restore Dependabot.
- Release binaries are built and published by `.github/workflows/release.yml` on `v*` tag push.
- Gates run locally, in git hooks. CI (`.github/workflows/ci.yml`) runs only after a merge to `main` (and by hand via `workflow_dispatch`); it is a safety net, not the gate. Do not add CI jobs or pull-request triggers to replace a local check.

## Verification

Use the command set that matches the changed area.

Git hooks are the gate. Install them once per clone (the setting is shared by all worktrees of the clone):

```bash
bun run hooks:install
```

- **pre-commit** (seconds): formats staged files with `oxfmt`, then lints them with `oxlint` and `stylelint`. Lint errors block the commit.
- **pre-push** (a minute or two): runs `scripts/verify.sh` for the paths the push changes: lint, typecheck (once it exists), frontend build, backend tests, end-to-end tests when UI paths changed, and compiled-binary tests when build or runtime-loading paths changed. Documentation-only pushes skip the app checks. The tree must be clean, because the checks run against it.
- `bun run verify` runs every check by hand.
- Never bypass the hooks (`--no-verify`). If a hook fails, fix the cause. If `main` CI fails after a merge, fixing it comes before any other work.

The pre-commit hook formats staged files with `oxfmt` before each commit. It formats whole files and re-stages them, so partial staging (`git add -p`) is not preserved. Requires Bun (auto-discovered), `perl`, and paths excluded in `.oxfmtrc.json` `ignorePatterns` to stay aligned with the hook’s pre-filter. If a Git GUI strips the environment, set `BUN_BIN` to the absolute path of your `bun` executable.

Current Bun checks:

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck   # once FND-001 lands
bun run build
bun run test:backend
bun run test-e2e
```

Current backend smoke start:

```bash
./iglo.monitor --port=3001 --data-dir=./data/smoke
```

Development smoke start:

```bash
bun src/server/server.ts --port=3001 --data-dir=./data/smoke
```

Runtime, memory, dependency, database, networking, and monitor-scheduling changes must include before/after measurements. Store benchmark outputs under `docs/perf/` when the task specifies a report.

Documentation-only changes do not require app tests; verify links, filenames, and `git status`.
