# Roadmap

This is the single action plan for reaching the [north star](north-star.md): uptime, errors, and logs in one self-hosted binary.
Read the north star first. Its principles (P1–P8) and decisions (D1–D17) apply to every item below.

Last reconciled with GitHub on 2026-11-21: 25 open issues (#56–#59, #76–#96) and 7 open PRs (#65–#69, #71, #72).

## How to use this file

- There are two kinds of work items.
    - **`#NN` items are GitHub issues.** Their issue body is the authoritative spec. This file only says where they sit in the sequence and what depends on them.
    - **`FND-`, `OBS-`, `SDK-`, and `AGT-` items are specified here.** When one is filed on GitHub, add the issue number next to its ID and treat the issue as the spec from then on.
    - **Items marked _rewritten_** (#83, #84, #85, #88, #89, #96) had their GitHub issues rewritten on 2026-11-21 to fit this plan. The issue is their spec.
- **All open issues were reconciled with this plan on 2026-11-21.** Each issue body now has the Effect constraints and a "Plan placement" section giving its stage and dependencies, and conflicting non-goals in #56–#59 were removed. If an issue still conflicts with the north star or this file, stop and raise it.
- Each item is one reviewable PR, or a short stack. If it grows beyond that, split it here before writing code.
- Statuses are `todo`, `in progress`, `done`, and `dropped`. Update the status in the PR that changes it.
- `Depends on` lists hard prerequisites. Items whose dependencies are met can run in parallel, including across tracks.
- Every item carries the default definition of done. For `#NN` items it applies on top of the issue spec, even where the issue predates it:
    - The checks from `AGENTS.md` for the changed area pass (`bun run lint`, `bun run build`, `bun run test:backend`, and `bun run test-e2e` for UI work).
    - `bun run typecheck` passes (once FND-001 lands).
    - New backend tests are added to the `test:backend:unit` list in `package.json` until FND-003 replaces the list with discovery.
    - New code has no `@ts-nocheck`, no barrels, and no new process-global state, and uses `@/` imports. Backend code is written in Effect following `docs/effect.md` (D16). No lint rule is disabled without a reason comment (D17).
    - Ingest, storage, or scheduling changes include before/after numbers under `docs/perf/`.
    - New UI strings go through i18n. New screens use the #91 visual system and shell.
    - **Agent parity (P8, D14).** Any capability a user can use in the UI ships with its MCP tool(s) in the same PR or stack. UI and MCP call the same command or query service, and the tool has a test. The only exceptions are on the D15 exemption list. Once #85 lands, its parity test enforces this in CI.

## Sequence at a glance

| Stage | Goal                                        | Platform track (uptime core)          | UI track            | Agent track (MCP)              | Telemetry and SDK track               |
| ----- | ------------------------------------------- | ------------------------------------- | ------------------- | ------------------------------ | ------------------------------------- |
| 0     | Clear the open PR backlog                   | Land #72, #71, #69, #65→#68, #67, #66 | —                   | —                              | —                                     |
| F     | **Foundation**: types, guardrails, Effect   | FND-001 – 006, FND-010 – 018          | FND-019             | —                              | —                                     |
| 1     | Platform and agent foundations              | #76, #77, #78, #80, #79a              | #91                 | #83, #85 (rewritten)           | OBS-001 – 006                         |
| 2     | **Errors MVP** (first user-visible release) | #79b                                  | —                   | #84 (rewritten), AGT-101 – 104 | OBS-101 – 114, SDK-001 – 004          |
| 3     | Logs, incidents, self-health                | #82, #81                              | #90, #94 (optional) | AGT-105 – 108, AGT-201 – 202   | OBS-201 – 210, OBS-115, SDK-005 – 007 |
| 4     | **One view**, agent-run setup               | —                                     | #92, #93            | #96 (rewritten), AGT-203       | OBS-301 – 306, SDK-008                |
| 5     | Readable JS stacks and cron jobs            | #86                                   | —                   | —                              | OBS-401 – 404, OBS-501, SDK-009 – 010 |
| 6     | Uptime polish                               | #88, #89 (rewritten)                  | #87, #95            | —                              | —                                     |
| 7     | **Post-MVP**: session replay                | —                                     | —                   | —                              | OBS-701 – 704, SDK-011                |

Stage F gates all feature work: Stage 1 backend items start only when its exit criteria are met. #91 may run alongside it. Session replay starts only after stages 0–6 are done (decision D13).

### Critical path

```text
FND-001 typecheck + FND-002 lint + FND-003 tests ──► FND-005 Effect runtime + FND-006 characterization ──► FND-010 – 019 rewrites ──► Stage 1
#67 + FND-010 SQLite service ──► OBS-002 events.db ──► OBS-003 projects ──► OBS-102 ingest ──► OBS-105 grouping ──► OBS-109/110 issues UI
#80 scheduling lag + admission ──► OBS-103 bounded ingest queue (proves P1)
#79a outbox core ──► OBS-107 issue alerts ──► OBS-208 log alerts ──► OBS-304 correlated notifications
#77 shared sanitizer ──► OBS-104 event scrubbing
#91 visual system + shell ──► every new telemetry screen
#82 operational incidents + #93 details timeline ──► OBS-302 telemetry on the incident timeline
#92 dashboard ──► OBS-303 unified home
#68 + FND-014 handler layer ──► #83 scoped keys + query services ──► #85 MCP server ──► every later item ships its tools (P8)
#84 command layer + idempotency ──► all MCP write tools (AGT-101 – 108, #96)
#83 scoped keys ──► OBS-401 source-map upload key
#86 job run lifecycle ──► OBS-501 Sentry cron check-ins
```

---

## Stage 0 — Clear the open PR backlog

**Plan: land all seven, then start Stage F.** All seven pass CI but are 2–3 months old, and their measurements were taken on Bun 1.3.14. They are still worth landing before the Effect rewrite. #67 (explicit SQLite models), #68 (socket handlers out of `server.ts`), and #66 (HTTP monitor boundary) split up exactly the code that FND-010, FND-014, and FND-013 rewrite, so those rewrites start from smaller, clearer modules. Their tests join the FND-006 characterization net, and #71 adds a behaviour that later issues depend on. A trial merge against `main` on 2026-11-21 shows the conflicts are small and mostly mechanical (listed below), so rebasing costs much less than redoing the work.

Rules for this stage:

- An agent rebases each PR, resolves conflicts, re-runs the AGENTS.md checks, and re-runs its performance gate on Bun 1.4.5, updating the numbers in `docs/perf/`.
- Regenerate generated files (`src/server/generated/*`, `src/db/schema/current.sql`) instead of hand-merging them.
- No new scope while rebasing. Anything new becomes a ticket.
- **Fallback:** if a rebase turns out to need a behaviour change or a redesign, close the PR with a note and move its intent and tests into the matching Stage F ticket (#67 → FND-010/FND-015, #68 → FND-014, #66 → FND-013).

| Order | PR  | Issue | Size (+/−, files) | Conflicts with `main` on 2026-11-21                                                                          | Action                                                                                                                             |
| ----- | --- | ----- | ----------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1     | #72 | —     | +198/−759, 32     | 3 generated files (`current.sql`, two `src/server/generated/` bundles)                                       | Rebase and merge. It moves build output into ignored `out/`, so the other PRs rebase onto it.                                      |
| 2     | #71 | —     | +1050/−392, 33    | Stacked on #72. Against `main`: CI and release workflows, `package.json`, generated files, `upgrade.test.ts` | Retarget to `main` after #72, rebase, and merge. Its elapsed-minute resend behaviour is a contract that #79, #86, and #94 consume. |
| 3     | #69 | #59   | +96/−35, 1        | None                                                                                                         | Change "Closes #59" to "Refs #59" (FND-018 closes #59), then merge.                                                                |
| 4     | #65 | #57   | +145/−72, 3       | None                                                                                                         | Merge as the base of the #57 stack.                                                                                                |
| 5     | #68 | #57   | +1794/−1425, 7    | Stacked on #65. `src/server/server.ts`                                                                       | Retarget to `main` after #65, rebase, and merge. Closes #57. FND-014 builds on its handler families.                               |
| 6     | #67 | #56   | +1524/−1318, 78   | 8 test files, `test/backend-test/README.md`, and 3 perf reports. No source conflicts                         | Rebase and merge. Closes #56. FND-010 and FND-015 build on its explicit `SQLiteStore`/`SQLiteModel`.                               |
| 7     | #66 | #58   | +552/−281, 5      | `src/server/model/monitor.ts`                                                                                | Rebase and merge (refs #58). Prerequisite for #76, #90, and FND-013.                                                               |

#69 and #65 have no conflicts and can merge in any order, at any time.

**What happens to the refactor issues:**

- **#56 (explicit models)** and **#57 (socket families)** close when #67 and #68 merge.
- **#58 (splitting `Monitor`)** continues through FND-012, FND-013, and FND-015, and closes when FND-013 is done.
- **#59 (removing `@ts-nocheck`)** is closed by FND-018. Until then, the FND-001 ratchet stops the count from rising.

---

## Stage F — Foundation: types, guardrails, Effect

No feature work starts until this stage's exit criteria are met. Adding features on top of untyped, unguarded code only adds debt. AI agents do most of the rewrite, so the stage invests first in the guardrails that let agents rewrite safely: a typechecker that runs, a strict lint preset, and characterization tests that pin every wire contract. Decisions D16 (Effect) and D17 (toolchain) apply.

Starting point on 2026-11-21: 234 of 269 TypeScript files in `src/` carry `@ts-nocheck`, `strict` is off, CI runs no typecheck (and `tsc` currently errors out on `ignoreDeprecations`), oxlint runs only the `correctness` category, and `test:backend:unit` is a hand-kept file list that misses some tests.

**Exit criteria (all required before Stage 1 backend work):**

- Zero `@ts-nocheck` in `src/`, enforced by lint. `strict` is on.
- `bun run typecheck` (TS 7 native) and `bun run lint` (full `@cloudflare/oxlint-config` preset, with only documented exceptions) pass in CI.
- All backend code under `src/server/` runs on Effect (D16). No Promise-based service code remains outside documented interop edges.
- The characterization suite (FND-006) passes unchanged against the rewritten backend.
- Binary size, startup RSS, idle RSS, and scheduler lag are within the budget set in FND-005, measured against the FND-005 baseline.

**Order.** FND-001 to FND-006 are the guardrails and go first; FND-001, FND-002, and FND-003 can run in parallel. The rewrites (FND-010 onward) start once FND-005 and FND-006 land, and can run in parallel across agents where their `Depends on` allow. The UI track's #91 does not touch the backend and may run in parallel with this stage.

**Stage 0 interaction.** Stage F starts after the Stage 0 PRs land (or are folded in, per Stage 0's fallback). Their tests and measurements become part of the characterization net. FND-001, FND-002, and FND-003 only touch config and CI, so they may start while the last Stage 0 rebases are in review.

### Guardrails

#### FND-001 TypeScript 7 typecheck gate

- **Status:** todo · **Depends on:** —
- **Scope:** Add `tsrs` (the TS 7 native compiler) and a `bun run typecheck` script for the backend, scripts, and tests. Fix the tsconfig for TS 7: drop `ignoreDeprecations` and `baseUrl` (keep the `@/` path mapping in `paths`), and keep `module`/`moduleResolution` working with Bun. Add the typecheck to CI. Add a ratchet check in CI that fails if the number of `@ts-nocheck` files or `strict`-mode violations rises above a committed baseline, and that lowers the baseline when it falls. Add a Vue SFC typecheck for `src/**/*.vue` if a TS 7-compatible checker exists; if none does, record the gap here and ratchet the frontend `.ts` files only.
- **Acceptance:**
    - `bun run typecheck` passes on `main` and runs in CI.
    - The ratchet blocks a PR that adds a `@ts-nocheck`.
    - The plan to turn on `strict` is recorded: on per directory as each rewrite lands, globally at stage exit.

#### FND-002 Adopt `@cloudflare/oxlint-config`

- **Status:** todo · **Depends on:** FND-001 (type-aware rules need the TS 7 setup)
- **Scope:** Follow the package's own migration skill (`skills/migrate-oxlint-config/SKILL.md` in the npm package). Upgrade oxlint to ^1.94 and add `tsrs` as its type-aware backend. Replace `.oxlintrc.json` with `oxlint.config.ts` spreading the preset, and carry over this repo's ignore patterns and still-relevant rules. Commit a passing baseline with each newly failing rule set to `'off'` with a `// temporary` marker, then enable rules one per commit with fixes, or keep a rule off with a written reason. Prioritise rules that catch bugs (promises, unsafe `any`, strict equality) over style. stylelint stays as is.
- **Acceptance:**
    - `oxlint.config.ts` loads and lint runs under Bun only, locally and in CI, with no Node fallback (AGENTS.md). If the config loader needs Node, stop and raise it.
    - Every remaining `'off'` rule has a reason comment. Temporary disables are listed in this ticket, and each rewrite ticket removes the ones it makes pass.
    - The migration lands as one PR with one commit per rule.

#### FND-003 Test runner, discovery, and coverage

- **Status:** todo · **Depends on:** —
- **Scope:** Replace the hand-kept `test:backend:unit` list with directory-based discovery. Mark tests that need Docker (testcontainers: databases, brokers) with a clear naming or directory convention, and run them in a separate opt-in CI job. Restore tests that were dropped by accident (`monitor-conditions/operators.test.ts`, `ping.test.ts`, and `snmp.test.ts` look like candidates). Add `bun test --coverage` reporting, with a coverage floor on directories that have been rewritten.
- **Acceptance:**
    - A new test file under `test/backend-test/` runs in CI without touching `package.json`.
    - Docker-backed tests are excluded by default and pass in their own job.
    - The default definition of done in this file is updated to drop the "add to the list" rule.

#### FND-004 Guardrails as code

- **Status:** todo · **Depends on:** FND-002
- **Scope:** Turn the AGENTS.md rules into checks so agents get a failing check instead of a review comment: no relative imports outside the documented exceptions, no barrel or re-export files, no new process-global state (module-level mutable `let`, singletons, static mutable class fields), `@ts-nocheck` banned in rewritten directories, and, inside rewritten directories, no raw `async`/`Promise` service code, no `throw` for expected errors, and no direct `process.env` reads outside the config layer. Prefer oxlint rules and overrides; use the existing `import-boundaries.test.ts` style where lint cannot express a rule.
- **Acceptance:**
    - Each rule has a failing fixture or test that proves it fires.
    - The list of rewritten directories is one config entry that each rewrite ticket extends.

#### FND-005 Effect runtime, conventions, and performance budget

- **Status:** todo · **Depends on:** FND-001
- **Scope:** Add `effect` (4.x) and `@effect/platform-bun`, and `@effect/language-service` if it works with TS 7. Build the Effect composition root: one `ManagedRuntime` built from layers in the server entry, with an interop layer so not-yet-rewritten code can call Effect services and vice versa during the migration. Write `docs/effect.md`, the house style agents follow: how to define a service and its layer, tagged errors and where they become HTTP/socket/MCP errors, `Schema` at every boundary, resources and shutdown with scopes, config, logging, `Clock` and `TestClock` in tests, concurrency limits, and which Effect modules are off-limits. Port one small module end to end (for example settings or `clear-old-data`) as the reference implementation the doc points to. Take baseline measurements before adding Effect, then after: compiled binary size, startup time, startup and idle RSS, and scheduler lag (with #80's metric if it exists, otherwise the existing scheduler benchmark). Set the stage budget from these numbers.
- **Acceptance:**
    - The server starts and shuts down cleanly through the Effect runtime, including on signals.
    - `docs/effect.md` exists and the reference module follows it.
    - Before/after numbers and the agreed budget are in `docs/perf/`.

#### FND-006 Characterization suite for wire and data contracts

- **Status:** todo · **Depends on:** FND-003
- **Scope:** Pin the externally visible behaviour that rewrites must preserve: every socket event's payload and response shape (about 88 events), the HTTP routes (`/api/push`, badges, Prometheus metrics, status-page APIs, auth), the `kuma.db` schema and the Uptime Kuma upgrade path, and notification provider request shapes, which can be recorded against a local HTTP stub. Use real recorded payloads where possible. These tests import nothing internal: they drive the server over its public interfaces so they survive the rewrite unchanged.
- **Acceptance:**
    - Every socket event and HTTP route has at least one characterization test. A coverage list shows none are missing.
    - The suite passes on `main` before any rewrite starts.

### Rewrites into Effect

Each rewrite ticket follows the same definition of done on top of the default one: the area's `@ts-nocheck` pragmas are gone, it compiles under `strict`, it is added to the FND-004 rewritten-directories list, its temporary lint disables are removed, FND-006 passes unchanged, and the scheduler, storage, and networking rewrites include before/after numbers. Rewrites change structure, not behaviour. A behaviour bug found during a rewrite becomes its own ticket, unless fixing it is required to make the code typecheck.

| Item    | Area                                                                                                                                                                                                                       | Depends on        |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| FND-010 | SQLite store as an Effect service: connection lifecycle, transactions, migrations, typed row schemas. Builds on #67 (closes #56 if #67 is folded in).                                                                      | FND-005, FND-006  |
| FND-011 | Config, settings, logging, clock, and data-directory services. No direct `process.env` or settings statics outside this layer.                                                                                             | FND-005           |
| FND-012 | Monitor scheduler and lifecycle on fibers and `Schedule`, with explicit concurrency and shutdown. Behaviour-preserving; #80 adds bounding afterwards. Scheduler-lag numbers required.                                      | FND-010, FND-011  |
| FND-013 | Monitor types (24 files): one service interface, `Schema`-validated monitor config per type, timeouts and cancellation through Effect. Continues #58.                                                                      | FND-012           |
| FND-014 | Auth, sessions, and socket handlers: handlers become thin adapters over Effect services with `Schema`-decoded payloads. This is the base #83 and #84 build on (D14). Builds on #68 (closes #57 if folded in).              | FND-010, FND-011  |
| FND-015 | Models (13 files): replace RedBean-style models with typed domain modules and repositories over FND-010. Continues #58.                                                                                                    | FND-010           |
| FND-016 | HTTP routes: API router, status pages, badges, Prometheus, push. Effect HTTP handlers or thin adapters over services.                                                                                                      | FND-014           |
| FND-017 | Notification providers (95 files): a shared provider service, `Schema` config per provider, HTTP through one client service. Batch it across agents, about 10 providers per PR, recorded shapes from FND-006 as the check. | FND-011, FND-006  |
| FND-018 | Remaining backend sweep (monitor conditions, `db/schema`, generated code, utils, the dayjs module), then turn on `strict` globally and ban `@ts-nocheck` repo-wide. Closes #59.                                            | FND-010 – FND-017 |
| FND-019 | Frontend typing: type the stores, composables, and socket client against the shared wire schemas; Vue SFC typecheck in CI if FND-001 found a checker. The frontend is not moved to Effect (D16).                           | FND-014, FND-001  |

---

## Stage 1 — Platform and agent foundations

Starts when Stage F's exit criteria are met. The tracks run in parallel, and all backend items are written in Effect (D16).

### Platform track

| Item | Role in this plan                                                                                                                                                                                                                                                                             | Depends on |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| #76  | Pure monitor state machine. Prerequisite for incidents (#82), the outbox's monitor integration (#79b), job runs (#86), and diagnostics (#90).                                                                                                                                                 | #66        |
| #77  | Shared evidence sanitizer. **Telemetry reuses it** for scrubbing event payloads (OBS-104), so there is one redaction rule for monitors and telemetry.                                                                                                                                         | —          |
| #78  | Observation freshness and measured coverage. Feeds the dashboard (#92), details (#93), the public snapshot (#87), and health (#81).                                                                                                                                                           | —          |
| #80  | Bounded monitor execution and the scheduling-lag metric. **This metric is the yardstick for P1**: OBS-103 must show no lag regression under ingest load.                                                                                                                                      | #76        |
| #79a | **Part A of #79**: the outbox table, dispatcher, delivery states, and retry/ambiguity handling, usable by any producer. Telemetry alerts (OBS-107, OBS-208) enqueue into it. Splitting it lets the errors MVP proceed without waiting for #76. The split is recorded on #79 as parts A and B. | —          |

### UI track

| Item | Role in this plan                                                                                                                                         | Depends on |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| #91  | Visual system, primitives, and app shell. Every new screen from OBS-004 onward uses it, so telemetry pages are designed once, not rebuilt after a reskin. | —          |

### Agent track

#### #83 Scoped machine keys and query services (rewritten)

- **Status:** todo · **Depends on:** #68 (and #67 if it lands first)
- **Spec:** GitHub issue #83, rewritten on 2026-11-21.

#### #85 MCP server: transport, conventions, and parity gate (rewritten)

- **Status:** todo · **Depends on:** #83
- **Spec:** GitHub issue #85, rewritten on 2026-11-21.

### Telemetry track

#### OBS-001 Telemetry module skeleton and composition-root wiring

- **Status:** todo · **Depends on:** Stage F (FND-011, FND-014)
- **Scope:** Create `src/server/telemetry/` as an Effect layer provided from the composition root, depending on the FND-011 config, logger, data-directory, and clock services. Add a setting so the whole area can be disabled. Startup must not load telemetry code when it is disabled; enforce this with an import-boundary test like those in `test/backend-test/import-boundaries.test.ts`.
- **Acceptance:**
    - Server starts and stops cleanly with telemetry enabled and disabled.
    - Startup memory is unchanged when disabled. The startup-memory harness shows the delta when enabled.
    - No telemetry code imports `Database` statics or the `IgloMonitorServer` singleton.

#### OBS-002 `events.db` store with owned migrations

- **Status:** todo · **Depends on:** OBS-001, FND-010
- **Scope:** Open `events.db` in the data directory with `bun:sqlite` (WAL, `busy_timeout`, `auto_vacuum=INCREMENTAL`). Use the FND-010 SQLite service (built on #67's explicit `SQLiteStore`) with telemetry's own `Schema`-typed rows. Telemetry owns a migration runner and a schema version table, separate from `kuma.db` migrations (D1). Expose explicit transactions. Close the store on shutdown.
- **Acceptance:**
    - A fresh start creates `events.db` at the current schema version. Restarting is a no-op.
    - A migration test upgrades an older fixture schema to current.
    - The `kuma.db` upgrade tests (`upgrade.test.ts`, `schema.test.ts`) are unchanged and pass.
    - Deleting `events.db` while the server is stopped results in a clean recreate on next start.

#### OBS-003 Projects and DSN keys (backend)

- **Status:** todo · **Depends on:** OBS-002
- **Scope:** Tables `project` (id, name, slug, platform, created_at, archived) and `project_key` (public key, active, created_at, optional per-key rate limit). Authenticated socket handlers following the #68 pattern for create, rename, archive, and delete, plus key rotate and revoke. Build the DSN from the configured primary base URL. A project is a telemetry source, not a workspace (D12).
- **Acceptance:**
    - CRUD and key rotation are covered by backend tests.
    - The key lookup used by ingest rejects revoked keys (tested here, wired in OBS-102).
    - Deleting a project deletes its telemetry in a background job that does not block the request.

#### OBS-004 Projects UI and setup snippets

- **Status:** todo · **Depends on:** OBS-003, #91
- **Scope:** A "Projects" area in the #91 shell: list, create, and a settings page per project. The settings page shows the DSN with a copy button, key management, and setup snippets. Snippets cover the first-party SDK for Bun, Astro, Vue, and Alpine (from SDK-003 onward) and official Sentry SDKs for everything else (JavaScript, Python, Go, PHP, Ruby), with logs enabled where supported. The snippets come from one source that the AGT-104 `get_sdk_setup` tool also serves.
- **Acceptance:** Playwright e2e covers creating a project and copying its DSN.

#### OBS-005 Sentry envelope fixture corpus

- **Status:** todo · **Depends on:** none
- **Scope:** Capture real envelopes from current `@sentry/node`, `@sentry/browser`, `sentry-python`, and `sentry-go`. Cover handled and unhandled exceptions, messages, chained exceptions, breadcrumbs, user and tags, compressed bodies, log batches, cron `check_in` items, replay items, and unsupported item types (session, transaction, attachment, client report). Store them under `test/backend-test/fixtures/sentry-envelopes/` with a README that records SDK versions and how to regenerate them. Use a throwaway script outside `src/`, so the SDKs never become runtime dependencies.
- **Acceptance:** At least 20 fixtures, each with a short description. The regeneration script is documented and reproducible.

#### OBS-006 Ingest load benchmark harness

- **Status:** todo · **Depends on:** OBS-001
- **Scope:** A script under `scripts/` that runs the server with N active monitors against a loopback target, replays fixture envelopes at a configurable rate, and reports monitor scheduling lag (p50, p95, p99), ingest accept rate, 429 rate, RSS, and `events.db` size. Use #80's due-to-start lag metric once it lands; until then, measure lag externally. Store a no-ingest baseline in `docs/perf/`.
- **Acceptance:** The baseline report is committed. The harness runs against both a source run and the compiled binary.

---

## Stage 2 — Errors MVP

This is the first user-visible release: a real app (using an official Sentry SDK or the first-party SDK) gets grouped issues, alerts on new issues and regressions, and bounded storage.

### Platform track

| Item | Role in this plan                                                                                    | Depends on |
| ---- | ---------------------------------------------------------------------------------------------------- | ---------- |
| #79b | The rest of #79: monitor and push transitions enqueue delivery intents in the heartbeat transaction. | #79a, #76  |

### Telemetry track

#### OBS-101 Envelope parser

- **Status:** todo · **Depends on:** OBS-005
- **Scope:** A pure, typed parser covering the envelope header, item headers with and without `length`, and the newline rules. Decompress `gzip`, `deflate`, `br`, and `zstd` with streaming size caps applied after decompression (zip-bomb protection). Skip and count unknown item types. Also parse legacy `/store/` JSON bodies.
- **Acceptance:**
    - Every OBS-005 fixture parses. Malformed inputs (truncated, wrong length, oversized, invalid JSON, compression bombs) fail with typed errors and never throw uncaught.
    - A fuzz-style test of mutated fixtures finds no crashes and no unbounded memory use.

#### OBS-102 Ingest HTTP endpoints and auth

- **Status:** todo · **Depends on:** OBS-003, OBS-101
- **Scope:** `POST /api/<projectId>/envelope/` and `POST /api/<projectId>/store/` in the Bun HTTP path, plus `OPTIONS` preflight. Authenticate with the `X-Sentry-Auth` header, the `sentry_key` query parameter, or the DSN in the envelope header. Send CORS headers on these routes only. Enforce a compressed body-size limit before reading the body. Rate-limit per key with Sentry-compatible `429` and `Retry-After`/`X-Sentry-Rate-Limits`. Return `200 {"id": "<event_id>"}`. Ingest never reads or sets cookies and never touches session auth.
- **Acceptance:**
    - Tests cover wrong project, revoked key, missing auth, oversized body, CORS preflight, and rate limiting.
    - Ingest routes do not collide with `/api/push`, `/api/badge`, or status-page routes (covered by test).

#### OBS-103 Bounded ingest queue and batched writer

- **Status:** todo · **Depends on:** OBS-102, OBS-006, #80
- **Scope:** Two-phase ingest (D4). An in-memory queue, bounded by count and by bytes, that a writer drains in batched transactions. A full queue returns 429. Expose ingest pressure for the UI, metrics, and #81 health. Move parsing and normalization into a Bun `Worker` only if measurements show it is needed.
- **Acceptance:**
    - At the scale-envelope sustained rate, #80's scheduling-lag metric shows no measurable regression against the OBS-006 baseline (report in `docs/perf/`).
    - A burst above capacity sheds with 429, recovers without a restart, and keeps memory bounded.
    - Graceful shutdown drains the queue, or drops it with a logged count. It never hangs.

#### OBS-104 Event normalization and scrubbing

- **Status:** todo · **Depends on:** OBS-101, #77
- **Scope:** Map an event to stored columns (event_id, project, received and occurred timestamps, level, platform, environment, release, server name, exception type and value, culprit, transaction, user id or email, selected tags) plus the full payload compressed with zstd (D5). Clamp field sizes. Scrub sensitive keys and values with the shared #77 sanitizer before storage.
- **Acceptance:**
    - Snapshot tests over the fixture corpus.
    - Payloads above the per-event cap are truncated with a marker, not rejected.
    - Secret-leak fixtures from #77 cannot reach stored payloads.

#### OBS-105 Fingerprinting and issue grouping

- **Status:** todo · **Depends on:** OBS-104
- **Scope:** Grouping algorithm v1 (D8):
    1. Use the SDK `fingerprint` if present, expanding `{{ default }}`.
    2. Otherwise, exception type plus normalized in-app frames (module or file, and function; no line numbers; strip hashes and versions from paths).
    3. Otherwise, the message template.

    Upsert `issue` (fingerprint hash, title, culprit, level, status, first_seen, last_seen, count, grouping_version). Keep a bounded number of sample events per issue (the first plus the last N).

- **Acceptance:**
    - Table-driven tests: the same bug from different deploys groups together, different bugs stay apart, and minified code behaves as documented.
    - Re-ingesting the same event id is idempotent.

#### OBS-106 Issue lifecycle and regressions

- **Status:** todo · **Depends on:** OBS-105
- **Scope:** Statuses `unresolved`, `resolved`, and `ignored` (forever, until a date, or until N more events). A new event on a `resolved` issue makes it `unresolved` and marks a regression. Bulk status changes.
- **Acceptance:** State-machine tests for every transition, including timed ignores expiring under a fake clock.

#### OBS-107 Issue alerts through the outbox

- **Status:** todo · **Depends on:** OBS-106, #79a
- **Scope:** Per project, choose which existing notifications fire on **new issue** and **regression** (D7). Enqueue delivery intents into the #79a outbox in the same `events.db` transaction that creates or reopens the issue. If the outbox lives in `kuma.db`, document how the cross-file write stays correct. Throttle per issue and per project, with a digest when throttled. The message includes title, culprit, count, environment, and a link to the issue.
- **Acceptance:**
    - Delivery goes through the existing provider registry via the outbox. There is no parallel sender.
    - Loopback webhook tests cover delivery, throttling, and restart between commit and send.

#### OBS-108 Telemetry retention and size caps

- **Status:** todo · **Depends on:** OBS-105
- **Scope:** A scheduled job enforces event age (default 30 days) and a hard `events.db` size budget (P3). It deletes the oldest samples first, keeps issue rows and aggregate counts, and runs an incremental vacuum afterwards. Settings UI for both limits. When over budget, the dashboard warns and ingest sheds instead of growing.
- **Acceptance:**
    - Fake-clock tests with a small budget keep the file under budget plus a documented margin.
    - The job is chunked, so it never blocks the event loop or the scheduler for long.

#### OBS-109 Issues list UI

- **Status:** todo · **Depends on:** OBS-106, OBS-004, #91
- **Scope:** Issues per project or across all projects. Filter by status, level, environment, and time range. Sort by last seen, first seen, or count. Per-issue 24-hour sparkline. Bulk resolve and ignore. Cursor pagination through an authenticated query service. Filters live in the URL.
- **Acceptance:** Playwright e2e: ingest a fixture, the issue appears, resolve it, and it leaves the default filter.

#### OBS-110 Issue detail UI

- **Status:** todo · **Depends on:** OBS-109
- **Scope:** Exception chain with stack frames (in-app frames expanded, others collapsed, context lines when present), breadcrumbs, tags, request, user, runtime and OS contexts, raw JSON view, next and previous event, occurrences chart, and first and last seen with release.
- **Acceptance:** Renders every fixture in the corpus without errors.

#### OBS-111 Realtime issue updates

- **Status:** todo · **Depends on:** OBS-106
- **Scope:** Push new-issue, regression, and count updates to authenticated clients over the existing WebSocket server. Coalesce to at most about 1 update per second per client, so a burst cannot flood the UI.
- **Acceptance:** A test shows coalescing under a burst. The list updates without a reload.

#### OBS-112 Ingest security review and hardening

- **Status:** todo · **Depends on:** OBS-102, OBS-103, OBS-104
- **Scope:** Adversarial review of the public ingest surface:
    - limits and decompression
    - header injection and CORS scope
    - separation from the admin session
    - behaviour behind a reverse proxy (trusted proxy IP for rate limits)
    - malicious payloads rendered in the UI (XSS through frames, breadcrumbs, and tags)

    Record the findings and fixes in `docs/audits/`.

- **Acceptance:** Every finding has a test that fails before the fix and passes after it, following the existing audit method.

#### OBS-113 End-to-end tests with real SDKs

- **Status:** todo · **Depends on:** OBS-109, SDK-004
- **Scope:** Integration tests that start the server, create a project, and send errors from a small `@sentry/node` script (a test-only dependency) and from the first-party Bun SDK. Assert the issues appear through the query service. Run against the compiled binary too.
- **Acceptance:** Passes in CI on the compiled binary.

#### OBS-114 Errors MVP documentation

- **Status:** todo · **Depends on:** OBS-113
- **Scope:** README section; operations doc on retention, disk budget, reverse proxy, and CORS; guides for the first-party SDK and for pointing an existing Sentry SDK at iglo.monitor.
- **Acceptance:** Links verified. User-facing claims match shipped behaviour.

### Agent track

#### #84 Command layer with idempotent, scoped writes (rewritten)

- **Status:** todo · **Depends on:** #83, #85
- **Spec:** GitHub issue #84, rewritten on 2026-11-21.

#### AGT-101 Monitor tools

- **Status:** todo · **Depends on:** #84
- **Scope:** MCP tools for the whole monitor family on #83 queries and #84 commands: list, get, create, edit, clone, pause, temporary pause, resume, delete, heartbeats, chart data, important events, push URL examples, and monitor tags. Monitor types needing helper data (for example the game list) expose it as a read tool.
- **Acceptance:** Tool tests for each tool. Parity allowlist entries for these socket events are removed.

#### AGT-102 Tag and group tools

- **Status:** todo · **Depends on:** #84
- **Scope:** Tools to create, edit, and delete tags and groups, and to assign monitors to groups.
- **Acceptance:** As AGT-101.

#### AGT-103 Notification tools

- **Status:** todo · **Depends on:** #84
- **Scope:** Tools to list, create, edit, delete, and test notification channels, and to attach them to monitors. Results expose channel config with secrets masked. An agent can set a secret but never read it back.
- **Acceptance:** As AGT-101, plus a test that no tool output contains a stored secret.

#### AGT-104 Telemetry tools for the errors MVP

- **Status:** todo · **Depends on:** #84, OBS-106
- **Scope:** Tools for projects and keys (create, rename, archive, rotate, revoke, `get_project_dsn`), `get_sdk_setup(platform)` returning the same snippets as OBS-004, issues (list, get with latest event, resolve, ignore, bulk status), and telemetry retention settings. With these, an agent can create a project, wire the SDK into the owner's code, and triage what arrives.
- **Acceptance:** E2e: an agent-style script creates a project, sends an event with the DSN it got back, finds the issue, and resolves it, all through MCP.

### SDK track

The SDK targets the owner's stack only: Bun, Astro, Vue, and Alpine.js (D10). Everything else uses official Sentry SDKs.

#### SDK-001 SDK package skeleton, size budget, and contract tests

- **Status:** todo · **Depends on:** OBS-101
- **Scope:** A zero-dependency TypeScript package in `sdk/` with subpath entry points (`/browser`, `/bun`, `/vue`, `/alpine`, `/astro`, `/vite`). Built with `Bun.build`. CI checks:
    - a size test that fails if the browser core exceeds 5 KB minified and gzipped;
    - a contract test that feeds every envelope the SDK produces through the OBS-101 parser.

    Decide the distribution (D10 default: an npm package released from this repo with the same version as the binary, and the browser build also served by the binary) and record it in D10.

- **Acceptance:** `bun run build` builds the SDK. The size and contract tests run in CI.

#### SDK-002 Core client

- **Status:** todo · **Depends on:** SDK-001
- **Scope:** DSN parsing; event builder; stack-trace parser for V8, SpiderMonkey, and JavaScriptCore formats, with in-app detection; breadcrumbs ring buffer; dedupe of repeated errors; sampling; a `beforeSend` hook; and default scrubbing. Envelope transport that honours 429, `Retry-After`, and `X-Sentry-Rate-Limits`, with a small bounded retry queue.
- **Acceptance:** Unit tests for each part. Stack traces parse correctly from captured Chrome, Firefox, Safari, and Bun outputs.

#### SDK-003 Browser entry and script-tag install

- **Status:** todo · **Depends on:** SDK-002, OBS-102
- **Scope:**
    - Capture `window.onerror` and `unhandledrejection`.
    - Collect console, `fetch`/XHR, navigation, and click breadcrumbs.
    - Set user and tags.
    - Send at page unload with `fetch(..., { keepalive: true })` or `sendBeacon`.
    - Install from the binary with `<script src="https://<host>/sdk/browser.js" data-dsn="...">`, versioned with the server.
- **Acceptance:** Playwright test: a page throws, and the issue appears with breadcrumbs. Within the 5 KB budget.

#### SDK-004 Bun server entry

- **Status:** todo · **Depends on:** SDK-002, OBS-102
- **Scope:** Capture `uncaughtException` and `unhandledRejection`; a helper that wraps a `Bun.serve` `fetch` handler to capture errors with request context; `flush()` before exit.
- **Acceptance:** Integration test against a local iglo.monitor (shared with OBS-113).

---

## Stage 3 — Logs, incidents, and self-health

### Platform track

| Item | Role in this plan                                                                 | Depends on     |
| ---- | --------------------------------------------------------------------------------- | -------------- |
| #82  | Operational incident model. OBS-302 adds telemetry evidence to these incidents.   | #76, #77       |
| #81  | Monitor health versus target health. OBS-115 adds telemetry health signals to it. | #78, #80, #79a |

### UI track (optional in this stage)

| Item | Role in this plan                                                                                      | Depends on    |
| ---- | ------------------------------------------------------------------------------------------------------ | ------------- |
| #90  | Test a monitor once without saving. Run it here if UI capacity is free; otherwise it moves to stage 6. | #76, #77, #80 |
| #94  | Simpler monitor forms. Same rule as #90.                                                               | #91, #90      |

### Agent track

#### AGT-105 Maintenance, status page, and incident tools

- **Status:** todo · **Depends on:** #84, #82
- **Scope:** Tools for maintenance windows (CRUD, pause, resume, attach monitors and status pages), status pages (CRUD, membership, publish and unpublish behind the `publish` scope with `dry_run`), public incidents (post, edit, resolve, unpin), and #82 operational incidents (list, get timeline, acknowledge, write a draft, publish the draft behind `publish`).
- **Acceptance:** As AGT-101. Publishing without the `publish` scope fails, and `dry_run` shows exactly what would become public.

#### AGT-106 Infrastructure resource tools

- **Status:** todo · **Depends on:** #84
- **Scope:** Tools for proxies, Docker hosts, and remote browsers: CRUD plus their test actions.
- **Acceptance:** As AGT-101.

#### AGT-107 Settings and data tools

- **Status:** todo · **Depends on:** #84
- **Scope:** Read and change settings (`admin` scope), database size, shrink, and clearing events, heartbeats, and statistics (`delete` scope, `dry_run` reports affected row counts).
- **Acceptance:** As AGT-101.

#### AGT-108 API key tools

- **Status:** todo · **Depends on:** #84
- **Scope:** List, disable, enable, and revoke keys (`admin`). Create keys only with scopes at most equal to the calling key's scopes, and never with `admin` (D15). The new secret is shown once in the tool result.
- **Acceptance:** Escalation tests: no tool path yields a key with broader scopes than its caller. After this item the parity allowlist is empty.

#### AGT-201 Agent activity log

- **Status:** todo · **Depends on:** #84
- **Scope:** Record every MCP write: time, key name, tool, a sanitized input summary, result, and links to affected resources. Bounded retention (default 90 days or 10k entries). Shown in the UI under Settings and readable through a `list_agent_activity` tool. It answers "what did my agent do", not compliance (D15).
- **Acceptance:** Every write tool produces exactly one entry. Secrets never appear. Retention is enforced.

#### AGT-202 Triage overview tool

- **Status:** todo · **Depends on:** #85, OBS-106, #81
- **Scope:** `get_overview` returns everything that needs attention in one bounded call: monitors down or stale, active operational incidents, new and regressed issues, error-log spikes (once logs land), and #81 health warnings, each with a `ui_url`. This is an agent's first call. It grows as later stages ship.
- **Acceptance:** Fixture-driven tests for each signal. Response stays under a documented byte bound at the target scale.

### Telemetry track

#### OBS-115 Telemetry health signals

- **Status:** todo · **Depends on:** OBS-103, OBS-108, #81
- **Scope:** Add ingest pressure, writer lag, 429 rate, and `events.db` budget usage to #81's owner health details and banner. They stay separate from target and monitor health.
- **Acceptance:** Injected writer stall and budget exhaustion each show a distinct, specific health state.

#### OBS-201 Log storage schema

- **Status:** todo · **Depends on:** OBS-002
- **Scope:** A `log_record` table (project, timestamp, level, message, service, environment, release, trace id, span id, attributes as compressed JSON). Indexes on (project, timestamp) and (project, level, timestamp). An FTS5 table over the message and selected attributes (D6). Decide between day-bucketed tables and one table using benchmark data at the disk cap, and document the choice.
- **Acceptance:** A benchmark at the default 5 GB budget meets the north-star query-latency target. Report in `docs/perf/`.

#### OBS-202 Sentry log item ingest

- **Status:** todo · **Depends on:** OBS-201, OBS-103
- **Scope:** Parse `log` envelope items (batched records with attributes). Map severity to six levels (`trace`, `debug`, `info`, `warn`, `error`, `fatal`). Write through the bounded queue in a separate lane, so a log flood cannot starve error ingest.
- **Acceptance:** Fixture tests. A log flood at 2× the target rate still lets error events through, measured.

#### OBS-203 Plain HTTP log ingest

- **Status:** todo · **Depends on:** OBS-202
- **Scope:** `POST /api/<projectId>/logs` accepting JSON arrays or NDJSON with a minimal documented schema (`timestamp`, `level`, `message`, and optional `service` and `attributes`), authenticated with the project key. Document `curl`, Vector, and Fluent Bit examples.
- **Acceptance:** Tests for both formats, limits, and auth. The example configs are checked by hand, with the result recorded in the PR.

#### OBS-204 Log query service

- **Status:** todo · **Depends on:** OBS-201
- **Scope:** An authenticated query with filters for projects, time range, minimum level, service, environment, trace id, full-text query, and attribute equality. Cursor pagination in both directions. A histogram of counts per time bucket for the current filter.
- **Acceptance:** Tests for each filter. Latency at the disk cap is recorded.

#### OBS-205 Log explorer UI

- **Status:** todo · **Depends on:** OBS-204, #91
- **Scope:** Filter bar, time-range picker, volume histogram, a virtualized list with level colouring, expandable records with attributes, and copy-as-JSON. Filters live in the URL.
- **Acceptance:** Playwright e2e for filter, search, and expand. Scrolling stays smooth with 100k matching records.

#### OBS-206 Live tail

- **Status:** todo · **Depends on:** OBS-205, OBS-202
- **Scope:** Stream matching new records over WebSocket, filtered on the server against the current query. Per-client backpressure drops records and shows "N records skipped" instead of buffering without limit. Pause and resume.
- **Acceptance:** A test shows bounded server memory with a slow client during a flood.

#### OBS-207 Log retention and size cap

- **Status:** todo · **Depends on:** OBS-201
- **Scope:** Separate age (default 7 days) and size (default 5 GB) limits for logs, using the OBS-108 job pattern. The oldest data is deleted first, and FTS stays consistent.
- **Acceptance:** As OBS-108, plus an FTS-consistency test after pruning.

#### OBS-208 Log alert rules

- **Status:** todo · **Depends on:** OBS-204, OBS-107
- **Scope:** Rules of the form "count of records matching (filter) over (window) is at least (threshold)", delivered through the outbox, with cooldown. Evaluated incrementally, without rescanning the window every tick.
- **Acceptance:** Fake-clock tests for firing, cooldown, and recovery.

#### OBS-209 Logs ↔ errors linking

- **Status:** todo · **Depends on:** OBS-110, OBS-205
- **Scope:** An error event shows logs with the same trace id (or, failing that, from the same project within ±N seconds). A log record with a trace id links to related events.
- **Acceptance:** E2e test with fixtures that share a trace id.

#### OBS-210 Logs documentation

- **Status:** todo · **Depends on:** OBS-203, OBS-206, OBS-207, SDK-005
- **Scope:** README and operations doc sections covering the ingest paths (first-party SDK, Sentry SDK, plain HTTP), the disk budget, and query syntax.
- **Acceptance:** Links verified.

### SDK track

#### SDK-005 Logs API

- **Status:** todo · **Depends on:** SDK-003, SDK-004, OBS-202
- **Scope:** `log.trace/debug/info/warn/error/fatal(message, attributes)` for browser and Bun, batched into `log` envelope items with trace id propagation. Optional console capture. Logs at `warn` and above also become breadcrumbs.
- **Acceptance:** Contract tests. Batching is flushed at unload or exit.

#### SDK-006 Vue plugin

- **Status:** todo · **Depends on:** SDK-003
- **Scope:** `app.use(igloMonitor)`: hook `app.config.errorHandler` (chaining any existing handler), add the component name and component trace to events, and add router navigation breadcrumbs when Vue Router is present.
- **Acceptance:** A component test shows a thrown error captured with the component name.

#### SDK-007 Alpine.js plugin

- **Status:** todo · **Depends on:** SDK-003
- **Scope:** `Alpine.plugin(igloMonitor)`: capture Alpine expression errors with the expression and the element's identifying attributes, without capturing user data from inputs.
- **Acceptance:** A test page with a broken `x-data` expression produces one grouped issue.

---

## Stage 4 — One view and agent-run setup

### Agent track

#### #96 Service setup suggestions, agent-first (rewritten)

- **Status:** todo · **Depends on:** #84, #90, #77
- **Spec:** GitHub issue #96, rewritten on 2026-11-21.

#### AGT-203 Agent connection guide and real-client smoke test

- **Status:** todo · **Depends on:** AGT-108, AGT-202
- **Scope:** A "Connect an agent" panel next to API keys showing ready-to-paste MCP config for common clients (Claude Code, Cursor, and similar), plus `docs/mcp.md` covering the tool catalogue, scopes, `dry_run`, and `request_id`. A CI smoke test drives the compiled binary through a scripted agent session: overview → create monitor → triage issue → temporary pause.
- **Acceptance:** The smoke test passes in CI. The docs match the generated tool list.

### UI track

| Item | Role in this plan                                                                                                                    | Depends on         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| #92  | Dashboard redesign, first slice monitors only. OBS-303 then extends the same view with telemetry, instead of building a second home. | #91, #78, #82, #81 |
| #93  | Monitor details as an evidence timeline. OBS-302 adds a telemetry lane to it.                                                        | #91, #82, #78, #79 |

### Telemetry track

#### OBS-301 Link projects to monitors and groups

- **Status:** todo · **Depends on:** OBS-003
- **Scope:** Link a project to monitors or to existing monitor groups (D9, D12). The link lives in `events.db`. Edit it from the monitor editor, the group, and project settings. Deleting a monitor, group, or project cleans up links.
- **Acceptance:** Tests for linking, unlinking, and cascade cleanup. The `kuma.db` schema is unchanged.

#### OBS-302 Telemetry on the incident timeline

- **Status:** todo · **Depends on:** OBS-301, OBS-110, OBS-204, #82, #93
- **Scope:** For each operational incident (#82) and on the #93 details timeline, show the linked projects' new issues, error-count spike, and warn-or-higher logs, from N minutes before the outage until recovery.
- **Acceptance:** E2e: simulate an outage with fixtures in the window, and the timeline shows them in order.

#### OBS-303 Unified home

- **Status:** todo · **Depends on:** OBS-301, OBS-109, OBS-204, #92
- **Scope:** Extend the #92 dashboard so each service row also shows open and new issues (24 hours), error rate, and warn/error log counts for its linked projects. Unlinked monitors and unlinked projects still appear. Each cell links into its view.
- **Acceptance:** Loads within the north-star latency at target scale (measured). E2e smoke test.

#### OBS-304 Correlated notifications

- **Status:** todo · **Depends on:** OBS-301, OBS-107, #79b, #82
- **Scope:** A monitor-down notification includes the top new issues and error count for its linked projects in the window before the outage. Plain text for every provider, with links for providers that support them.
- **Acceptance:** Loopback webhook test asserts the content.

#### OBS-305 Command palette

- **Status:** todo · **Depends on:** OBS-303
- **Scope:** A ⌘K palette that jumps to a monitor, project, or issue by name or id, and starts a log search with the typed text.
- **Acceptance:** Keyboard-only e2e.

#### OBS-306 Cross-signal incident context tool

- **Status:** todo · **Depends on:** OBS-302, AGT-202
- **Scope:** `get_incident_context(monitor_id | incident_id | time_range)` returns, in one bounded call, the monitor state and evidence, the linked projects' new and regressed issues with top frames, and the warn-or-higher logs around the window. It is the agent equivalent of OBS-302, for "why did my site go down?".
- **Acceptance:** Same fixtures as OBS-302. The output stays under its byte bound and includes `ui_url` links.

### SDK track

#### SDK-008 Astro integration

- **Status:** todo · **Depends on:** SDK-003, SDK-004, SDK-005
- **Scope:** An Astro integration that injects the browser client into pages, captures server-rendering and endpoint errors through middleware on the Bun adapter, and reads the DSN from environment variables.
- **Acceptance:** An example Astro app in the test fixtures reports a client error and a server error.

---

## Stage 5 — Readable JavaScript stacks and cron jobs

### Platform track

| Item | Role in this plan                                                                  | Depends on    |
| ---- | ---------------------------------------------------------------------------------- | ------------- |
| #86  | Push monitors with job run lifecycles. OBS-501 maps Sentry cron check-ins onto it. | #76, #77, #78 |

### Telemetry track

#### OBS-401 Source map upload and storage

- **Status:** todo · **Depends on:** OBS-110, #83
- **Scope:** An upload endpoint authenticated with a #83 key that has the `write` scope and is restricted to the project (never the public DSN key). Files are keyed by release, dist, URL path, and debug id. They are stored in the data directory with metadata in `events.db`.
- **Acceptance:** Tests for upload, overwrite, and auth. Uploads count toward the disk budget.

#### OBS-402 Frame resolution with source maps

- **Status:** todo · **Depends on:** OBS-401
- **Scope:** Resolve minified frames to original file, line, function, and context lines when an event is rendered, with a bounded LRU cache. Match by debug id first, then by release plus URL. Prefer a small, focused VLQ decoder over a large dependency if the code stays small, and justify the choice in the PR. Grouping (OBS-105) uses resolved frames when maps exist at ingest.
- **Acceptance:** Fixture tests with real Vite and esbuild output resolve correctly.

#### OBS-403 `sentry-cli` upload compatibility

- **Status:** todo · **Depends on:** OBS-402
- **Scope:** Implement enough of the Sentry upload API (artifact bundles and debug ids) for `sentry-cli sourcemaps upload` to work. Optional: drop it if the API surface proves too large, and record the decision here.
- **Acceptance:** An integration test uploads with `sentry-cli` and the frames resolve.

#### OBS-404 Source map retention

- **Status:** todo · **Depends on:** OBS-401
- **Scope:** Keep maps for the last N releases per project, plus any release that still has stored events, enforced through the shared retention job.
- **Acceptance:** Fake-clock tests.

#### OBS-501 Sentry cron check-ins as job runs

- **Status:** todo · **Depends on:** OBS-102, #86
- **Scope:** Accept `check_in` envelope items (`in_progress`, `ok`, `error`, plus monitor slug and duration) and translate them into #86 job events (start, success, fail) for a push monitor linked by slug. Optionally auto-create the monitor from the item's `monitor_config`, behind a per-project setting that is off by default.
- **Acceptance:** Fixture tests for each status and for duplicate or out-of-order check-ins. A missed schedule raises the #86 "missed" outcome.

### SDK track

#### SDK-009 Vite plugin for debug ids and upload

- **Status:** todo · **Depends on:** SDK-001, OBS-401
- **Scope:** A Vite plugin (also used by Astro) that injects debug ids into bundles and source maps and uploads them to OBS-401 after build. It deletes `.map` files from the output by default.
- **Acceptance:** An example Vite build uploads maps, and a captured error resolves to source lines.

#### SDK-010 Cron helper

- **Status:** todo · **Depends on:** SDK-004, OBS-501
- **Scope:** `monitor.cron("slug", async () => { ... })` for Bun sends `in_progress`, then `ok` or `error` with the duration.
- **Acceptance:** Integration test: a failing job produces a #86 fail outcome.

---

## Stage 6 — Uptime polish

| Item | Plan                                                                        |
| ---- | --------------------------------------------------------------------------- |
| #87  | Keep as specified. The public snapshot is the safe contract that #95 needs. |
| #95  | Keep as specified, after #87.                                               |
| #90  | Keep as specified, unless already done in stage 3.                          |
| #94  | Keep as specified, unless already done in stage 3.                          |
| #88  | Rewritten below: one opt-in second opinion before alerting.                 |
| #89  | Rewritten below: p50/p95 from fixed histograms.                             |

(#84 moved to stage 2 and #96 to stage 4, because agent operation depends on them.)

#### #88 Second opinion before alerting (rewritten)

- **Status:** todo · **Depends on:** #76, #77
- **Spec:** GitHub issue #88, rewritten on 2026-11-21.

#### #89 p50/p95 response times from fixed histograms (rewritten)

- **Status:** todo · **Depends on:** none (shows freshness context once #78 lands)
- **Spec:** GitHub issue #89, rewritten on 2026-11-21.

---

## Stage 7 — Post-MVP: session replay

Starts only when stages 0–6 are shipped (D13). Scope: **replay on errors only**. The browser keeps a short buffer and uploads it only when an error happens, so storage stays small and every stored replay is relevant.

#### OBS-701 Replay ingest

- **Status:** todo · **Depends on:** OBS-103, OBS-005 (replay fixtures)
- **Scope:** Parse `replay_event` and `replay_recording` envelope items. Write compressed recording segments as files in the data directory and their metadata in `events.db`, through the bounded queue.
- **Acceptance:** Fixture tests. Oversized or malformed segments are rejected with bounded memory use.

#### OBS-702 Replay retention and budget

- **Status:** todo · **Depends on:** OBS-701
- **Scope:** A separate replay disk budget and age limit (default 7 days). Replays linked to unresolved issues are kept preferentially.
- **Acceptance:** Fake-clock and budget tests, as OBS-108.

#### OBS-703 Replay player

- **Status:** todo · **Depends on:** OBS-701
- **Scope:** A replay page using a lazily loaded `rrweb-player`, with a timeline of errors, breadcrumbs, and network events. First, spike player compatibility with the recording format the SDKs actually emit (Sentry records with its own rrweb fork), and record the result here.
- **Acceptance:** Fixture replays from both the Sentry SDK and SDK-011 play correctly. The player is not in the main bundle.

#### OBS-704 Replay ↔ issue linking

- **Status:** todo · **Depends on:** OBS-703, OBS-110
- **Scope:** Issue and event detail show "watch replay" when the event carries a replay id. The replay page links back to its issues.
- **Acceptance:** E2e from an issue to its replay.

#### SDK-011 Replay on errors

- **Status:** todo · **Depends on:** OBS-701, SDK-003
- **Scope:** An optional replay add-on for the browser SDK, using rrweb directly in a lazily loaded chunk that is not counted in the 5 KB core budget. Masks all text and inputs by default. Buffers the last ~60 seconds in memory and uploads only when an error is captured.
- **Acceptance:** Playwright: an error after interaction produces a playable replay. With no error, nothing is uploaded.

---

## Later (not committed)

Candidates for after stage 7. Each must be checked against the north-star non-goals before it is promoted.

- OTLP/HTTP logs endpoint.
- A REST adapter over the same query and command services, only if a real script or integration needs one (D14).
- OAuth for MCP, only if a client the owner uses cannot send a bearer key.
- Release tracking (first seen in a release, resolve in the next release).
- Export and import of a project's telemetry.
- Per-project ingest quotas and sampling.
