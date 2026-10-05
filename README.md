# iglo.monitor

**iglo.monitor is a lightweight, self-hosted monitoring application for websites, APIs, networks, and services.**

Canonical repository: [iglo-tech/iglo.monitor](https://github.com/iglo-tech/iglo.monitor). The default branch is `main`.

It provides the familiar essentials of an uptime monitor—scheduled checks, history, notifications, maintenance windows, incidents, and public status pages—while being built around a smaller and more maintainable architecture.

> iglo.monitor is under active development. Expect breaking changes until the first stable release.

## What it offers

- HTTP, TCP, ping, DNS, certificate, database, and other service monitors
- uptime history, response times, and operational dashboards
- notification integrations and configurable alerting
- public status pages, incidents, and maintenance windows
- SQLite storage with no external database server
- a single executable for deployment

## Why iglo.monitor?

Uptime Kuma is an excellent product, but its codebase has accumulated tightly coupled modules, hidden global state, broad compatibility layers, oversized dependency graphs, and weak internal boundaries. Those problems make the application harder to understand, change, test, and keep lightweight.

iglo.monitor keeps the useful product ideas and rebuilds the internals around explicit ownership, focused modules, direct dependencies, and a deliberately narrow platform.

Read [Why iglo.monitor exists](docs/why-iglo-monitor.md) for the full architectural rationale.

## Run

Download the executable for your platform from [Releases](https://github.com/iglo-tech/iglo.monitor/releases), then run it:

```bash
chmod +x iglo.monitor-linux-x64
./iglo.monitor-linux-x64
```

Open `http://localhost:3001` to complete setup.

```text
--port=3001
--host=0.0.0.0
--data-dir=/path/to/data
```

Application data is stored in `./data` by default. Real-browser monitors also require Chrome or Chromium on the host.

See [Operations](docs/operations.md) for reverse proxies, maintenance, API keys, badges, and password recovery.

## Develop

Use Bun 1.4 or newer:

```bash
git clone https://github.com/iglo-tech/iglo.monitor.git
cd iglo.monitor
bun install --frozen-lockfile
bun run hooks:install
bun run dev
```

Run `bun run build` to produce the local `iglo.monitor` executable. CI checks `main` and pull requests; pushing a `v*` tag builds release binaries through GitHub Actions.

## Migrate from Uptime Kuma

iglo.monitor can migrate a copy of an existing Uptime Kuma SQLite data directory.

1. Stop Uptime Kuma.
2. Back up and copy its data directory, including `kuma.db`, `upload/`, and `screenshots/` when present.
3. Start iglo.monitor with `--data-dir` pointing to the copy; the SQLite importer detects and upgrades it automatically.

Never run both applications against the same database. Migration support is still evolving, so keep the original backup.

## Credits

iglo.monitor is maintained under [iglo.tech](https://iglo.tech).

iglo.monitor is derived from [Uptime Kuma](https://github.com/louislam/uptime-kuma), created by [Louis Lam](https://github.com/louislam) and its contributors. Their work established the product, integrations, translations, and user experience that made this rewrite possible.

iglo.monitor is an independent project and is not affiliated with or supported by Uptime Kuma. The original attribution is retained under the [MIT license](LICENSE).
