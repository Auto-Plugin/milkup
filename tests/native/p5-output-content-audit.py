#!/usr/bin/env python3
"""Check PDF content against frozen source fixtures, independently of its renderer.

Exit 1 means a content assertion failed (including expanded Arabic logical order).
This does not replace visual checks or prove a production GUI generated the PDF.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def codepoints(text):
    return [f"U+{ord(char):04X}" for char in text]


def poppler(pdf, mode):
    return subprocess.run(
        ["pdftotext", mode, str(pdf), "-"],
        check=True, capture_output=True, text=True,
    ).stdout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=["unicode", "pagination"], required=True)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, help="Optional independent fixture manifest, e.g. oversized-cases.json")
    parser.add_argument("--scope", choices=["experiment", "native-helper", "production"], required=True)
    parser.add_argument("--fixtures", type=Path, default=Path(__file__).resolve().parents[1] / "fixtures/p5-output/acceptance")
    args = parser.parse_args()
    manifest_name = "unicode-expectations.json" if args.kind == "unicode" else "pagination-cases.json"
    manifest_path = args.manifest or args.fixtures / manifest_name
    manifest = json.loads(manifest_path.read_text())
    frozen_sources = [manifest] if args.kind == "unicode" else manifest["cases"]
    source_checks = [{"path": str(args.fixtures / item["sourceFile"]),
                      "sha256": sha(args.fixtures / item["sourceFile"]),
                      "expectedSHA256": item["sourceSHA256"]} for item in frozen_sources]
    for item in source_checks:
        item["matches"] = item["sha256"] == item["expectedSHA256"]
    raw, layout = poppler(args.pdf, "-raw"), poppler(args.pdf, "-layout")
    version = subprocess.run(["pdftotext", "-v"], capture_output=True, text=True).stderr.splitlines()[0]
    result = {"scope": args.scope, "kind": args.kind, "pdf": str(args.pdf.resolve()),
              "pdfSHA256": sha(args.pdf), "fixtureManifest": str(manifest_path),
              "sourceChecks": source_checks, "popplerVersion": version,
              "limitations": ["Scope is a caller-supplied label, not proof of GUI/native provenance; retain run, binary, source and input hashes separately.",
                              "Text extraction does not establish glyph appearance, no clipping or page geometry; inspect actual page pixels separately."]}
    if args.kind == "pagination":
        pages = raw.split("\f")
        if not pages[-1].strip():
            pages.pop()
        # Only ASCII test identifiers may span extraction whitespace. Never use
        # this normalization for source Unicode or copied code text assertions.
        identifiers = [re.sub(r"\s", "", page) for page in pages]
        occurrences = lambda marker: [i + 1 for i, page in enumerate(identifiers) for _ in range(page.count(marker))]
        cases = []
        for case in manifest["cases"]:
            # A table may repeat its declared source header between two halves
            # of an ASCII marker split across pages. Strip only those labels
            # for global marker counting; keep original page streams unchanged.
            headers = case.get("repeatedHeaderText", [])
            stream = "".join(identifiers)
            for header in headers:
                stream = stream.replace(re.sub(r"\s", "", header), "")
            kind = {"table": "ROW", "code": "LINE", "list": "ITEM"}[case["type"]]
            markers = [f'{case["id"]}-{kind}-{i:03}' for i in range(1, case["count"] + 1)]
            markers += [case["id"] + "-HEADING", case["id"] + "-END"]
            markers += case.get("additionalMarkers", [])
            counts = {marker: stream.count(marker) for marker in markers}
            if any(header in marker for header in headers for marker in markers):
                raise ValueError("Repeated header exclusion overlaps a required marker")
            heading, first = occurrences(case["id"] + "-HEADING"), occurrences(case["firstMarker"])
            cases.append({"id": case["id"], "headingPages": heading, "firstPages": first,
                          "lastPages": occurrences(case["lastMarker"]), "endPages": occurrences(case["id"] + "-END"),
                          "headingAndFirstSamePage": len(heading) == len(first) == 1 and heading == first,
                          "markerCounts": counts, "repeatedHeaderTextExcludedFromGlobalMarkerStream": headers,
                          "crossPageMarkers": [marker for marker in markers if counts[marker] and not occurrences(marker)],
                          "missing": [marker for marker, count in counts.items() if count == 0],
                          "duplicates": [marker for marker, count in counts.items() if count > 1]})
        result["markerReaderPolicy"] = "Poppler raw reading order preserves table-cell text; layout may interleave columns. ASCII marker matching removes extraction whitespace only. Global counts join pages after excluding only explicitly declared repeated table-header labels; per-page heading/first relationships use unchanged raw page streams. Unicode assertions are entirely separate and never use this normalization."
        result.update(pageCount=len(pages), blankPages=[i + 1 for i, page in enumerate(pages) if not page.strip()], cases=cases)
        passed = not result["blankPages"] and all(c["headingAndFirstSamePage"] and not c["missing"] and not c["duplicates"] for c in cases)
    else:
        import fitz
        document = fitz.open(args.pdf)
        mupdf = "\n".join(page.get_text() for page in document)
        result["mupdfVersion"] = fitz.VersionBind
        result["actualTextPolicy"] = "No NFC/NFKC, bidi reordering, joiner removal, glyph-alias substitution, or whitespace rewriting is applied to Unicode comparisons."
        texts = {"popplerRaw": raw, "popplerLayout": layout, "mupdf": mupdf}
        ids = [case["id"] for case in manifest["cases"]]
        cases = []
        for case in manifest["cases"]:
            readers = {}
            for reader, text in texts.items():
                label = case["id"] + ":"
                start = text.find(label)
                if start < 0:
                    # The diagnostic SVG has visible labels without an SVG:
                    # prefix; still require all original label strings.
                    region = text if case["id"] == "SVG" else ""
                else:
                    start += len(label)
                    stops = [text.find(other + ":", start) for other in ids if other != case["id"]]
                    end = min([value for value in stops if value >= 0], default=len(text))
                    region = text[start:end].strip()
                readers[reader] = {"extractedRegion": region, "extractedCodepoints": codepoints(region),
                                   "exactPhrase": case["text"] in region,
                                   "units": [{"expected": unit, "codepoints": codepoints(unit), "expectedCount": case["text"].count(unit), "actualCount": region.count(unit), "exact": region.count(unit) == case["text"].count(unit)} for unit in case["units"]]}
            passed_case = all(all(unit["exact"] for unit in reader["units"]) for reader in readers.values()) and all(readers[name]["exactPhrase"] for name in case.get("requiredExactPhraseReaders", []))
            cases.append({"id": case["id"], "scope": case["scope"], "expected": case["text"],
                          "expectedCodepoints": case["codepoints"], "readers": readers, "passed": passed_case})
        result.update(cases=cases, originalLossAndExpandedUnicodePassed=all(c["passed"] for c in cases if c["scope"] != "expanded-rtl"),
                      expandedArabicLogicalPassed=all(c["passed"] for c in cases if c["scope"] == "expanded-rtl"),
                      arabicVisualAndGlyphOrder="NOT_VERIFIED: requires separate visual review; extraction order alone cannot establish Arabic visual correctness.")
        passed = all(case["passed"] for case in cases)
    result["passed"] = passed and all(item["matches"] for item in source_checks)
    result["status"] = "PASS_CONTENT_ASSERTIONS_ONLY" if result["passed"] else "FAIL"
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "status": result["status"]}))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    sys.exit(main())
