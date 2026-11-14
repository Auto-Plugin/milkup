#!/usr/bin/env bash
set -euo pipefail
review_root=/workspace/milkup-export-print-evidence
review_output="$review_root/milestone05/html10-screen"
review_run="$review_root/milestone01/native-ui/runs/p5-html-10"
for required in complete.html without-images.html source.md assets/logo-fixture.png provenance.json; do
 test -f "$review_run/$required"
done
node "$review_output/review-production-html.cjs" "$review_run/complete.html" "$review_run/source.md" "$review_output/production-rich-html-review.json" "$review_output/production-rich-complete.png"
node "$review_output/review-production-html.cjs" "$review_run/without-images.html" "$review_run/source.md" "$review_output/production-rich-without-images-review.json" "$review_output/production-rich-without-images.png"
python3 "$review_output/finalize-production-review.py" "$review_output/production-rich-html-review.json" "$review_run/assets/logo-fixture.png"
python3 "$review_output/finalize-production-review.py" "$review_output/production-rich-without-images-review.json"
node "$review_output/audit-rich-details.cjs"
