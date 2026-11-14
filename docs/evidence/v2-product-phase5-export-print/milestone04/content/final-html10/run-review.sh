#!/usr/bin/env bash
set -euo pipefail
review_root=/workspace/milkup-export-print-evidence/milestone01
review_content="$review_root/content"
review_output="$review_content/final-html10"
review_run="$review_root/native-ui/runs/p5-html-10"
for required in complete.html without-images.html source.md assets/logo-fixture.png; do
  if [[ ! -f "$review_run/$required" ]]; then
    echo "Missing actual production artifact: $review_run/$required" >&2
    exit 2
  fi
done
node "$review_content/review-production-html.cjs" "$review_run/complete.html" "$review_run/source.md" "$review_output/production-rich-html-review.json" "$review_output/production-rich-complete.png"
node "$review_content/review-production-html.cjs" "$review_run/without-images.html" "$review_run/source.md" "$review_output/production-rich-without-images-review.json" "$review_output/production-rich-without-images.png"
python3 "$review_content/finalize-production-review.py" "$review_output/production-rich-html-review.json" "$review_run/assets/logo-fixture.png"
python3 "$review_content/finalize-production-review.py" "$review_output/production-rich-without-images-review.json"
node "$review_output/audit-rich-details.cjs"
python3 "$review_output/compare-production.py"
