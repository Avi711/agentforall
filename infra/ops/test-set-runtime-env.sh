#!/bin/bash
# Exercises startup.sh's set_runtime_env against the characters that break a sed replacement.
set -euo pipefail
startup="$(cd "$(dirname "$0")/.." && pwd)/startup.sh"
tmp="$(mktemp -d)"
cd "$tmp"
printf 'A=1\nSAMPLE_URL=old\nB=2\n' > .env.runtime
eval "$(sed -n '/^  set_runtime_env() {/,/^  }/p' "$startup")"
set_runtime_env SAMPLE_URL 'postgresql://u:p%40ss@host:5432/db?sslmode=require&application_name=a|b\\c'
set_runtime_env NEW_KEY 'x=y'
expected='A=1
SAMPLE_URL=postgresql://u:p%40ss@host:5432/db?sslmode=require&application_name=a|b\\c
B=2
NEW_KEY=x=y'
[ "$(cat .env.runtime)" = "$expected" ] || { echo "set_runtime_env corrupted the file:"; cat .env.runtime; exit 1; }
echo "set_runtime_env ok"
