#!/usr/bin/env bash
# Local CI gate for LogueOS-Console — local replacement for the disabled GH Actions (ci.yml).
# `make preflight` runs it; the pre-push hook runs it before every push.
# Blocking: vitest + production build. Advisory (matches old CI continue-on-error):
# lint / svelte-check / design-drift. Heavy Playwright e2e is `make e2e` (run on apple-node).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0; step(){ printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
[ -d node_modules ] || { step "npm ci"; npm ci || fail=1; }
step "unit tests (vitest)"; npm run test:unit || fail=1
step "production build"; npm run build || fail=1
step "lint (advisory)"; npm run lint || echo "⚠ lint findings (advisory)"
step "typecheck (advisory)"; npm run check || echo "⚠ svelte-check findings (advisory)"
step "design-token drift (advisory)"; npm run check:drift || echo "⚠ drift findings (advisory)"
[ "$fail" = 0 ] && printf '\n\033[32m✓ preflight passed\033[0m\n' || printf '\n\033[31m✗ preflight FAILED (override: git push --no-verify)\033[0m\n'
exit $fail
