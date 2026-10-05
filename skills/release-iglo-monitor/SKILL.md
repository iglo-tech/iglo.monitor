---
name: release-iglo-monitor
description: Prepare, publish, and verify iglo.monitor releases through the repository's Bun build and GitHub Actions workflow. Use when creating the next stable, beta, or release-candidate version; bumping the application version; pushing a version tag; or checking generated GitHub release notes, binaries, and checksums.
---

# Release iglo.monitor

Use `.github/workflows/release.yml` as the release implementation. Drive and verify that workflow; do not create a parallel publisher.

## Release contract

- Publish to `iglo-tech/iglo.monitor` (https://github.com/iglo-tech/iglo.monitor); use `--repo iglo-tech/iglo.monitor` for repository-scoped `gh` commands.
- Publish only tags matching `v*`.
- Use SemVer tags such as `v1.2.0`, `v1.2.0-beta.1`, or `v1.2.0-rc.1`.
- Keep `package.json` version equal to the tag without the leading `v`.
- Treat tags containing `-` as prereleases. The workflow must not mark them as latest.
- Expect six binaries plus `checksums-sha256.txt`:
    - `iglo.monitor-linux-x64`
    - `iglo.monitor-linux-arm64`
    - `iglo.monitor-linux-x64-musl`
    - `iglo.monitor-darwin-x64`
    - `iglo.monitor-darwin-arm64`
    - `iglo.monitor-windows-x64.exe`
- Let GitHub generate release notes through `generate_release_notes: true` and inspect the published result.
- Keep Bun as the only release runtime and `bun.lock` as the lockfile. Do not add npm, Node, Docker, or another distribution path.

## 1. Establish the release

1. Read `AGENTS.md`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `package.json`, and `scripts/build/build-binary.ts`.
2. Inspect `git status`, the current branch, remotes, recent commits, existing tags, and releases.
3. Fetch `origin` and tags before choosing a version.
4. Select the next version from existing tags and the user's requested release channel. Never reuse or move an existing tag.
5. Stop before editing if unrelated local changes overlap release files or make the release commit ambiguous. Preserve all user changes.

## 2. Prepare the version

1. Update `package.json` to the exact release version.
2. Run `bun run build` so the embedded frontend records the same version in `src/server/generated/embedded-assets.bundle.ts`.
3. Inspect the generated diff. Confirm both backend and frontend expose the intended version and that no stale version remains.
4. Do not manually edit generated asset contents.

## 3. Verify before publishing

Run the repository gates:

```bash
bun install --frozen-lockfile
bun run lint
bun run build
bun run test:backend
bun run test-e2e
```

Run the compiled binary against a new temporary data directory and unused loopback port. Require the expected version in logs and a successful HTTP response. If sandboxing blocks local listeners, rerun the same test with the required permission instead of weakening it.

Also require `git diff --check`. Do not tag a failing revision; report the exact failing gate and stop.

## 4. Publish

1. Commit only the intended version, generated assets, and explicitly requested release-system changes.
2. Push the release commit to `main`.
3. Wait for `.github/workflows/ci.yml` on that exact commit to succeed.
4. Create and push an annotated tag on that exact commit:

```bash
git tag -a vVERSION COMMIT -m "iglo.monitor vVERSION"
git push origin vVERSION
```

Never force-push a release tag. Do not create a GitHub Release manually; the tag push must exercise `.github/workflows/release.yml`.

## 5. Verify the GitHub Release

Wait for the tag-triggered Release workflow to finish, then verify:

- the workflow conclusion is successful;
- the release exists at `releases/tag/vVERSION`;
- prerelease/latest state matches the version;
- GitHub generated non-empty release notes;
- all seven expected assets exist;
- `checksums-sha256.txt` contains one entry for every binary;
- at least one downloaded binary matches its published SHA-256.

## Final report

Report the release tag and URL, release commit, CI and Release workflow results, asset/checksum verification, tests run, and repository status.
