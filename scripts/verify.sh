#!/bin/sh
# Full local gate. CI runs only after a merge to main, so this is the check that
# stops broken work before it leaves the machine.
#
# Usage:
#   bun run verify                      run every check
#   sh scripts/verify.sh --changed FILE  run the checks that the changed paths
#                                        listed in FILE (one per line) need;
#                                        .githooks/pre-push calls it this way
#
# Checks: lint, typecheck (once the script exists), frontend build, backend
# tests, e2e tests when UI paths changed, and the compiled-binary tests when
# build or runtime-loading paths changed.
set -eu

root=$(git rev-parse --show-toplevel)
cd "$root"
. "$root/.githooks/lib.sh"

bun=$(find_bun) || {
    echo "verify: bun not found. Install Bun (https://bun.sh) or set BUN_BIN." >&2
    exit 1
}

changed=""
if [ "${1:-}" = "--changed" ]; then
    changed=$(cat "$2")
fi

# touches REGEX: true when running everything, or when a changed path matches.
touches() {
    [ -z "$changed" ] && return 0
    printf '%s\n' "$changed" | grep -Eq "$1"
}

if [ -n "$changed" ] && ! printf '%s\n' "$changed" | grep -Evq '^(docs/.*|.*\.md)$'; then
    echo "verify: documentation-only change, app checks skipped"
    exit 0
fi

step() {
    echo ""
    echo "verify: $1"
}

step "lint"
"$bun" run lint

if "$bun" -e 'process.exit(require("./package.json").scripts?.typecheck ? 0 : 1)'; then
    step "typecheck"
    "$bun" run typecheck
fi

# The frontend build rewrites src/server/generated/ while those files are still
# tracked (until PR #72 lands). Restore them afterwards if they were clean before.
generated=$(git ls-files src/server/generated)
generated_was_clean=1
if [ -n "$generated" ] && ! git diff --quiet -- src/server/generated; then
    generated_was_clean=0
fi
restore_generated() {
    if [ -n "$generated" ] && [ "$generated_was_clean" = 1 ]; then
        git checkout -- src/server/generated
    fi
}
trap restore_generated EXIT INT TERM

step "frontend build"
"$bun" run build:frontend > /dev/null

step "backend tests"
"$bun" run test:backend

ui_paths='^(src/(pages|components|composables|layouts|mixins|util|lang|assets|router|stores|i18n|icon)|src/[^/]+\.(vue|ts|js)$|config/(vite|playwright)|test/e2e/|package\.json$|bun\.lock$)'
if touches "$ui_paths"; then
    step "end-to-end tests"
    # Installs the Chromium build that this Playwright version expects; a no-op when present.
    "$bun" x playwright install chromium > /dev/null
    "$bun" run test-e2e
else
    echo ""
    echo "verify: no UI paths changed, end-to-end tests skipped"
fi

binary_paths='^(scripts/build/|package\.json$|bun\.lock$|src/server/(server|bun-http-server|.*-loader|.*-registry|.*-loading)\.ts$|src/server/notification-providers/|test/integration-test/)'
if touches "$binary_paths"; then
    step "compiled binary"
    binary="$root/dist/verify/iglo.monitor"
    "$bun" scripts/build/build-binary.ts --outfile="$binary" > /dev/null
    IGLO_MONITOR_BINARY="$binary" "$bun" run test:notification-provider-binary
    IGLO_MONITOR_BINARY="$binary" "$bun" run test:auth-security-binary
else
    echo ""
    echo "verify: no build or runtime-loading paths changed, compiled-binary tests skipped"
fi

echo ""
echo "verify: all checks passed"
