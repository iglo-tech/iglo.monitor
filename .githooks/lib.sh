#!/bin/sh
# Shared helpers for the git hooks and scripts/verify.sh. Source it; do not run it.

find_bun() {
    if [ -n "${BUN_BIN:-}" ] && [ -x "$BUN_BIN" ]; then
        echo "$BUN_BIN"
        return 0
    fi

    for candidate in \
        /usr/local/bin/bun \
        /opt/homebrew/bin/bun; do
        if [ -x "$candidate" ]; then
            echo "$candidate"
            return 0
        fi
    done

    if [ -n "${HOME:-}" ]; then
        candidate="$HOME/.bun/bin/bun"
        if [ -x "$candidate" ]; then
            echo "$candidate"
            return 0
        fi
    fi

    search_path="/usr/local/bin:/opt/homebrew/bin"
    if [ -n "${HOME:-}" ]; then
        search_path="$HOME/.bun/bin:$search_path"
    fi
    if [ -n "${PATH:-}" ]; then
        search_path="$search_path:$PATH"
    fi

    bun_path=$(PATH="$search_path" command -v bun 2>/dev/null || true)
    if [ -n "$bun_path" ] && [ -x "$bun_path" ]; then
        echo "$bun_path"
        return 0
    fi

    return 1
}
