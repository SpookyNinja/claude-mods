#!/usr/bin/env bash
# Usage: ./publish.sh "commit message"  – sync this repo with GitHub
set -e
cd "$(dirname "$0")"
git pull --rebase --autostash
git add -A
git diff --cached --quiet || git commit -m "${1:-Update mods}"
git push
