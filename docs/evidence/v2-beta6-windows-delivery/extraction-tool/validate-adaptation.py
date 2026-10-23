#!/usr/bin/env python3
"""Check the narrow beta.6 adaptation without reading or executing an artifact."""
import ast
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
old_bytes = (ROOT / "extract-embedded.beta5.py.txt").read_bytes()
new_bytes = (ROOT / "extract-embedded.py").read_bytes()
old = ast.parse(old_bytes, filename="beta5/extract-embedded.py")
new = ast.parse(new_bytes, filename="beta6/extract-embedded.py")
compile(new, "beta6/extract-embedded.py", "exec")

def named_nodes(tree):
    return {
        node.name: node
        for node in tree.body
        if isinstance(node, (ast.FunctionDef, ast.ClassDef))
    }

before, after = named_nodes(old), named_nodes(new)
assert before.keys() == after.keys(), "Extraction definitions were added or removed"
unchanged = []
for name in before:
    if name == "frontend_markers":
        continue
    original = ast.dump(before[name], include_attributes=False)
    if name == "validate_evidence":
        original = original.replace("Manifest version must be 2.0.0-beta.5", "Manifest version must be 2.0.0-beta.6")
    assert original == ast.dump(after[name], include_attributes=False), name
    unchanged.append(name)

def constants(tree):
    return {
        node.targets[0].id: node.value
        for node in tree.body
        if isinstance(node, ast.Assign)
    }

old_constants, new_constants = constants(old), constants(new)
assert old_constants.keys() == new_constants.keys()
assert ast.literal_eval(new_constants["VERSION"]) == "2.0.0-beta.6"
assert ast.literal_eval(new_constants["BASELINE"]) == "7cc4edc6747abf5fbc31b60cccf4bd73174af6f8"
for name in old_constants.keys() - {"VERSION", "BASELINE"}:
    assert ast.dump(old_constants[name]) == ast.dump(new_constants[name]), name

def other_nodes(tree):
    return [ast.dump(node) for node in tree.body[1:]
            if not isinstance(node, (ast.Assign, ast.FunctionDef, ast.ClassDef))]

assert other_nodes(old) == other_nodes(new), "Imports or main invocation changed"

def stable_markers(node):
    assignment = next(
        child for child in node.body
        if isinstance(child, ast.Assign) and isinstance(child.targets[0], ast.Name)
        and child.targets[0].id == "stable"
    )
    return ast.literal_eval(assignment.value)

added_markers = ["data-editor-context-menu", "hostContextCommand", "floating-document-toolbar"]
assert stable_markers(after["frontend_markers"]) == stable_markers(before["frontend_markers"]) + added_markers
old_frontend = ast.get_source_segment(old_bytes.decode(), before["frontend_markers"])
new_frontend = ast.get_source_segment(new_bytes.decode(), after["frontend_markers"])
expected_frontend = old_frontend.replace(
    '# These literal UI strings were observed in the current built entry module.',
    '# Required literal UI strings bind the extracted entry to the reviewed source.',
).replace(
    '"document-toolbar"]',
    '"document-toolbar",\n              "data-editor-context-menu", "hostContextCommand", "floating-document-toolbar"]',
).replace(
    '[VERSION, "2.0.0-beta.4", "2.0.0-beta.3", *stable]',
    '[VERSION, "2.0.0-beta.5", "2.0.0-beta.4", "2.0.0-beta.3", *stable]',
).replace('Entry script lacks beta.5 version marker', 'Entry script lacks beta.6 version marker').replace(
    'counts["2.0.0-beta.4"] == counts["2.0.0-beta.3"] == 0',
    'counts["2.0.0-beta.5"] == counts["2.0.0-beta.4"] == counts["2.0.0-beta.3"] == 0',
)
assert new_frontend == expected_frontend, "Unexpected frontend parser or marker change"
print(json.dumps({
    "status": "passed",
    "verificationKind": "static-script-adaptation-only",
    "expectedCandidate": "6b3eeebad7ec433c6420bf5bbfadcf6a6710d20f",
    "version": ast.literal_eval(new_constants["VERSION"]),
    "baseline": ast.literal_eval(new_constants["BASELINE"]),
    "originalSha256": hashlib.sha256(old_bytes).hexdigest(),
    "adaptedSha256": hashlib.sha256(new_bytes).hexdigest(),
    "syntaxCompiledWithoutExecution": True,
    "unchangedDefinitions": unchanged,
    "unchangedConstants": sorted(old_constants.keys() - {"VERSION", "BASELINE"}),
    "addedRequiredMarkers": added_markers,
    "rejectedOldVersionMarkers": ["2.0.0-beta.5", "2.0.0-beta.4", "2.0.0-beta.3"],
    "artifactRead": False,
    "windowsCodeExecuted": False,
    "downloads": False,
}, indent=2) + "\n", end="")
