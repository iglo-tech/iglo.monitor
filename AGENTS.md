# AGENTS.md

## Repository Identity

The project is `iglo.monitor`; its canonical repository is https://github.com/iglo-tech/iglo.monitor and its default branch is `main`.

iglo.monitor is an independently maintained architectural rewrite derived from the Uptime Kuma v2.4.0 codebase. It is not an upstream-parity fork and is not intended to operate as a public open-source community project.

The repository is published "as is": no formal support process, no issue triage process, no release promise, and no community governance files.

## Current Stack

- Backend: Bun 1.4 runtime, native ESM modules (`import`/`export`), Express compatibility routes, and Bun-native HTTP/WebSocket paths.
- Frontend: Vue 3, Vite, Bootstrap-based UI.
- Database layer: SQLite only through the Bun-native compatibility store; MariaDB/MySQL are not supported as application databases.
- Package manager today: Bun with `bun.lock`.
- Distribution today: one compiled executable produced by `bun run build`.
- Development today: `bun run dev` for source runs; `bun src/server/server.ts` for backend-only work.

## Target Direction

- Fix architecture and correctness before pursuing runtime novelty or upstream feature parity.
- Replace god modules, hidden global state, barrel imports, service locators, and compatibility layers with explicit ownership and direct dependencies.
- Rewrite incrementally behind characterized data and wire contracts; do not attempt an untestable greenfield replacement.
- Keep runtime execution and package management on Bun, but use Bun APIs only where they make the design smaller, clearer, or measurably better.
- Keep SQLite as the only application database. Preserve the tested Uptime Kuma SQLite upgrade path and the `kuma.db` filename; do not add database backends for upstream parity.
- Keep the application recognizable while allowing internal and UI architecture to change substantially.
- Ship one compiled executable. Do not add Docker, compose, or parallel distribution paths unless explicitly requested.

## Repository Decisions

- Prefer `@/` path-alias imports across backend, frontend, scripts, and tests. Do not introduce relative imports (`./`, `../`) unless there is no practical alternative (for example auto-generated asset bundles, JSON `import ... with { type: "json" }` from a nearby file, or a tool that cannot resolve aliases).
- Import from the module that owns a symbol. Do not add barrel files, transitional re-export barrels, generic registries, or a new compatibility facade unless a real external contract requires one.
- Newly touched core modules should not add `@ts-nocheck`, broad `any` facades, or process-global state. Type existing runtime contracts incrementally instead of redesigning payloads for type convenience.
- Renames are intentionally breaking for configuration and external payloads; do not retain aliases. The only compatibility path is the automatic Uptime Kuma SQLite importer, while the `kuma.db` filename and tested upgrade path remain fixed.
- Do not add npm or Node fallback paths for default runtime, package-manager, or verification workflows.
- Do not restore upstream community files such as `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, issue templates, PR templates, stale workflows, release workflows, or sponsor/funding files.
- Dependency update automation uses Renovate via `renovate.json`; do not restore Dependabot.
- Release binaries are built and published by `.github/workflows/release.yml` on `v*` tag push.
- CI runs via `.github/workflows/ci.yml` on `main` and pull requests.

## Verification

Use the command set that matches the changed area.

Git hooks (once per clone):

```bash
bun run hooks:install
```

The pre-commit hook formats staged files with `oxfmt` before each commit. It formats whole files and re-stages them, so partial staging (`git add -p`) is not preserved. Requires Bun (auto-discovered), `perl`, and paths excluded in `.oxfmtrc.json` `ignorePatterns` to stay aligned with the hook’s pre-filter. If a Git GUI strips the environment, set `BUN_BIN` to the absolute path of your `bun` executable.

Current Bun checks:

```bash
bun install --frozen-lockfile
bun run lint
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
