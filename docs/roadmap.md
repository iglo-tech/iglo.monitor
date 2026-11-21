# Roadmap

How the work toward the [north star](north-star.md) is organised: uptime, errors, and logs in one self-hosted binary that AI agents can fully operate.
Read the north star first. Its principles (P1–P8) and decisions (D1–D18) apply to every work item.

## Where things live

- **Work items are GitHub issues.** Each issue is one reviewable PR (or a short stack). Its body is the spec, and its acceptance criteria are the definition of done, together with the default definition of done below.
- **Stages are milestones.** Milestone order is delivery order.
- **Tracks are labels:** `foundation`, `platform`, `ui`, `agent`, `telemetry`, `sdk`, plus `stage-0` for landing the open PR backlog and `gate` for stage gates.
- **Dependencies are GitHub issue dependencies** ("blocked by" in the issue sidebar). Each issue's "Plan placement" section lists the same blockers.
- **Direction lives in the repository:** [`north-star.md`](north-star.md), [`AGENTS.md`](../AGENTS.md), and later `docs/effect.md` (FND-005, #108) and `docs/mcp.md` (#85). These change in PRs, next to the code they constrain.
- Issue titles carry stable IDs (`FND-`, `OBS-`, `SDK-`, `AGT-`) for the items created from the original plan. The full pre-migration roadmap, with every item spec in one file, is in git history (commit `218ce52c`).

## Picking work

1. Take an open, unassigned issue from the **earliest open milestone** whose blockers are all closed. Assign yourself before starting.
    - List a stage: `gh issue list --milestone "Stage F — Foundation" --state open`
    - Check blockers: `gh api repos/iglo-tech/iglo.monitor/issues/<n>/dependencies/blocked_by -q '.[] | "\(.number) \(.state)"'`
2. SCOPE-001 (#192) comes before everything: it removes the public-facing features so later work starts from less code. After it, FND-001, FND-002, and FND-003 (#104–#106) may start while Stage 0 is open, and #91 (visual system) may run during Stage F.
3. Every Stage 1+ item is blocked, directly or through its dependencies, by the **Stage F exit gate (#120)**. Session replay (Stage 7) additionally waits until stages 0–6 are shipped (D13).
4. One issue per branch and PR. Put the ID in the PR title when it has one (`FND-012: ...`) and close the issue from the PR body (`Closes #112`).
5. If an issue conflicts with the north star or `AGENTS.md`, stop and comment on the issue. Do not quietly pick one side.
6. Follow-up work becomes a new issue in the right milestone, with its blockers set. It does not become extra code in the current PR.

## Default definition of done

Applies to every issue on top of its own acceptance criteria:

- The local gates pass: the pre-commit hook on every commit and the pre-push hook (`scripts/verify.sh`) on every push. Install them with `bun run hooks:install` and never bypass them. CI runs only after the merge to `main`.
- New backend tests are added to the `test:backend:unit` list in `package.json` until FND-003 (#106) replaces the list with discovery.
- New code has no `@ts-nocheck`, no barrels, and no new process-global state, and uses `@/` imports. Backend code is written in Effect following `docs/effect.md` (D16). No lint rule is disabled without a reason comment (D17).
- Ingest, storage, scheduling, runtime, and dependency changes include before/after numbers under `docs/perf/`.
- New UI strings go through i18n. New screens use the #91 visual system and shell.
- **Agent parity (P8, D14).** Any capability a user can use in the UI ships with its MCP tool(s) in the same PR or stack. UI and MCP call the same Effect service, and the tool has a test. The only exceptions are on the D15 exemption list. Once #85 lands, its parity test enforces this in CI.

## Stages

| Stage | Milestone                                                                               | Goal                                                                                                                                                                  |
| ----- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0     | [Land open PRs](https://github.com/iglo-tech/iglo.monitor/milestone/1)                  | Remove public-facing features first (#192), then rebase and land PRs #72, #71, #69, #65, #68, #67, #66 (issues #97–#103).                                             |
| F     | [Foundation](https://github.com/iglo-tech/iglo.monitor/milestone/2)                     | Typecheck, lint preset, test discovery, guardrails, Effect runtime, characterization suite, then the Effect rewrite. Gate: #120.                                      |
| 1     | [Platform and agent foundations](https://github.com/iglo-tech/iglo.monitor/milestone/3) | State machine, sanitizer, freshness, bounded execution, outbox part A, visual system, scoped keys, MCP server, telemetry skeleton.                                    |
| 2     | [**Errors MVP**](https://github.com/iglo-tech/iglo.monitor/milestone/4)                 | First user-visible release: grouped issues from any Sentry SDK or the first-party SDK, alerts, bounded storage, all operable through MCP.                             |
| 3     | [Logs, incidents, self-health](https://github.com/iglo-tech/iglo.monitor/milestone/5)   | Logs: ingest, search, alerts, saved views, drop rules, patterns, compressed history. One alert per mass outage. Incidents, monitor health, the remaining agent tools. |
| 4     | [**One view**, agent-run setup](https://github.com/iglo-tech/iglo.monitor/milestone/6)  | Unified home and incident timeline across all three signals; agent-first service setup; MCP connection guide.                                                         |
| 5     | [JS stacks and cron jobs](https://github.com/iglo-tech/iglo.monitor/milestone/7)        | Source maps, releases, job-run lifecycles with output, Sentry cron check-ins.                                                                                         |
| 6     | [Uptime polish](https://github.com/iglo-tech/iglo.monitor/milestone/8)                  | Test-once and simpler forms, remote second opinion, latency percentiles.                                                                                              |
| 7     | [**Post-MVP**: session replay](https://github.com/iglo-tech/iglo.monitor/milestone/9)   | Replay on errors only (D13).                                                                                                                                          |

## Critical path

```text
SCOPE-001 (#192) ──► Stage 0 PRs (#97–#103) ──► FND-005 Effect runtime (#108) + FND-006 characterization (#109) ──► FND-010–019 rewrites (#110–#119) ──► Stage F gate (#120) ──► Stage 1
#67 + FND-010 SQLite service (#110) ──► OBS-002 events.db (#122) ──► OBS-003 projects (#123) ──► OBS-102 ingest (#133) ──► OBS-105 grouping (#136) ──► OBS-109/110 issues UI (#140, #141)
#80 scheduling lag ──► OBS-103 bounded ingest queue (#134), which proves P1
#79 outbox part A ──► OBS-107 issue alerts (#138) ──► OBS-208 log alerts (#164) ──► OBS-304 correlated notifications (#174)
#77 shared sanitizer ──► OBS-104 event scrubbing (#135)
#91 visual system and shell ──► every new screen
#82 incidents + #93 timeline ──► OBS-302 telemetry on the incident timeline (#172)
#92 dashboard ──► OBS-303 unified home (#173)
#68 + FND-014 handler layer (#114) ──► #83 scoped keys and query services ──► #85 MCP server ──► every later item ships its tools (P8)
#84 command layer ──► all MCP write tools (AGT-101–108: #128–#130, #150–#153) and #96
#83 scoped keys ──► OBS-401 source-map upload (#178)
#86 job runs ──► OBS-501 Sentry cron check-ins (#182)
```

## Later (not committed)

Candidates for after stage 7. Each must be checked against the north-star non-goals before it becomes an issue.

- OTLP/HTTP logs endpoint.
- A REST adapter over the same query and command services, only if a real script or integration needs one (D14).
- OAuth for MCP, only if a client the owner uses cannot send a bearer key.
- Scripted browser checks (Playwright login or checkout flows). Needs a Chromium install on the server.
- Log alerts on relative change ("error rate up 3× compared with yesterday").
- Export and import of a project's telemetry.
- Per-project ingest quotas and sampling.
