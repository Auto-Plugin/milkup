#!/usr/bin/env bash
set -euo pipefail
cd /tmp/milkup-p7-outline-1.3.3-external
# Existing verified dependency closure only. This does not install or download.
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.tests.json
node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1
node scripts/build.mjs
node verify.mjs
