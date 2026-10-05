---
name: deploy-iglo-monitor
description: Deploy an already-published iglo.monitor GitHub Release to the local systemd instance with architecture detection, checksum verification, remote smoke testing, backup, health checks, and automatic rollback. Use when installing, upgrading, redeploying, or rolling back iglo.monitor on the known SSH host or another explicitly supplied server.
---

# Deploy iglo.monitor

Deploy only an existing, successful GitHub Release. Do not change versions, create commits or tags, publish releases, or edit release notes.

## Deployment contract

- Resolve releases from `iglo-tech/iglo.monitor` (https://github.com/iglo-tech/iglo.monitor/releases); use `--repo iglo-tech/iglo.monitor` for repository-scoped `gh` commands.
- Resolve the exact release tag before changing the host. Never silently switch between stable and prerelease channels.
- Use the release artifact and `checksums-sha256.txt` from GitHub, not a local build.
- Preserve the existing data directory and service arguments.
- Keep a versioned backup of the current binary.
- Restore the backup automatically if restart or health verification fails.

For the known local instance, start with these discovered defaults but verify them read-only each time:

- SSH: `root@192.168.1.153`
- service: `iglo-monitor.service`
- binary: `/opt/iglo-monitor/iglo.monitor`
- data: `/opt/iglo-monitor/data`
- port: `3001`

## 1. Resolve and inspect

1. Resolve the requested tag and confirm its GitHub Release workflow succeeded.
2. Confirm the release contains `checksums-sha256.txt` and the expected platform artifacts.
3. Inspect the target OS, architecture, libc, service definition, current process, disk space, binary checksum, and HTTP status.
4. Re-read the actual systemd unit to obtain the binary path, data directory, host, and port. Treat the defaults above only as starting values.
5. Stop if the service is already unhealthy, the target is ambiguous, disk space is insufficient, or the requested release is incomplete.

## 2. Select and verify the artifact

Use:

- `iglo.monitor-linux-x64` for `x86_64` with glibc;
- `iglo.monitor-linux-arm64` for `aarch64`;
- `iglo.monitor-linux-x64-musl` only for x64 musl systems.

Download the artifact and checksum file from the exact release. Verify SHA-256 locally, upload the artifact under a versioned staging name, and verify SHA-256 again on the host.

Do not proceed if either checksum differs.

## 3. Smoke-test the staged binary

1. Make the staged binary executable.
2. Start it on an unused loopback port with a new temporary data directory.
3. Require the requested version in logs and a successful HTTP response.
4. Stop the temporary process gracefully.
5. Do not point the smoke test at production data.

## 4. Replace with rollback

1. Copy the current binary to a unique backup named for the incoming tag. Never overwrite an existing backup.
2. Install the verified staged binary at the existing binary path without changing the service unit or data directory.
3. Restart the existing systemd service.
4. Wait up to 30 seconds for both `systemctl is-active` and the HTTP check to succeed.
5. If restart or health verification fails:
    - show the relevant journal;
    - restore the backup at the original binary path;
    - restart the service;
    - verify the restored service;
    - report the rollback and stop.

Never delete production data, rewrite the systemd unit without a separate request, or leave a failed service stopped.

## 5. Verify the running service

Require all of the following:

- systemd reports `active/running`;
- HTTP responds on the configured port;
- logs report the requested iglo.monitor version;
- the installed binary matches the published SHA-256;
- the rollback backup exists and its checksum is recorded.

## Final report

Report the release tag and URL, target host, selected artifact, checksum, running version, systemd and HTTP state, backup path, and whether rollback was needed.
