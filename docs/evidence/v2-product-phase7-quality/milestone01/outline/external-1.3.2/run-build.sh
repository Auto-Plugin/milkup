#!/usr/bin/env bash
set -euo pipefail
cd /tmp/milkup-p7-outline-external
evidence=/workspace/milkup-p7-quality-evidence/milestone01/outline/external-1.3.2
pnpm_cli=/workspace/.cache/corepack/v1/pnpm/11.7.0/bin/pnpm.cjs
node "$pnpm_cli" install --offline --ignore-scripts --no-frozen-lockfile --store-dir /tmp/milkup-p5-m06-pnpm-home/store --cache-dir /tmp/milkup-p6-outline-cache --config.manage-package-manager-versions=false --config.verify-store-integrity=true > "$evidence/install-offline.log" 2>&1
node "$pnpm_cli" install --offline --ignore-scripts --frozen-lockfile --store-dir /tmp/milkup-p5-m06-pnpm-home/store --cache-dir /tmp/milkup-p6-outline-cache --config.manage-package-manager-versions=false --config.verify-store-integrity=true > "$evidence/install-frozen.log" 2>&1
node node_modules/typescript/bin/tsc --noEmit > "$evidence/typecheck.log" 2>&1
node node_modules/vitest/vitest.mjs run --config vitest.config.mjs > "$evidence/tests.log" 2>&1
node scripts/build.mjs > "$evidence/build.log" 2>&1
node verify.mjs > "$evidence/verification.log" 2>&1
