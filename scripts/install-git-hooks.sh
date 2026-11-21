#!/bin/sh
set -eu

root=$(git rev-parse --show-toplevel 2>/dev/null) || {
    echo "Error: not inside a git repository." >&2
    exit 1
}

cd "$root"

for hook in pre-commit pre-push lib.sh; do
    if [ ! -f ".githooks/$hook" ]; then
        echo "Error: .githooks/$hook not found." >&2
        exit 1
    fi
done

git config --local core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push

echo "Git hooks installed (core.hooksPath=.githooks): pre-commit formats and lints staged files, pre-push runs scripts/verify.sh."