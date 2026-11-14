#!/usr/bin/env python3
"""Use the exact WebKit header lists and forwarding macro, without engine build.

The negative graph removes only the new registration, recreating the failed
candidate. The positive graph uses the actual corrected source unchanged.
Private framework headers are build interfaces, not installed public SDK APIs.
"""
import argparse, hashlib, json, pathlib, re, shutil, subprocess

p = argparse.ArgumentParser()
p.add_argument('--source', type=pathlib.Path, required=True)
p.add_argument('--output', type=pathlib.Path, required=True)
p.add_argument('--cmake', default='cmake')
p.add_argument('--ninja', default='ninja')
p.add_argument('--compiler', default='c++')
a = p.parse_args()
a.ninja = shutil.which(a.ninja) or a.ninja
source = a.source.resolve()
out = a.output.resolve()
out.mkdir(parents=True, exist_ok=False)
patch = pathlib.Path(__file__).resolve().parents[2] / 'research/linux-pdf-unicode-20261114/0002-research-only-scalar-source-to-skia.patch'
headers = [name for name in re.findall(r'^\+\+\+ b/(.+\.h)$', patch.read_text(), re.M)]
assert len(headers) == 7 and len(set(headers)) == 7
registry = source / 'Source/WebCore/Headers.cmake'
assert registry.read_text().count('    platform/graphics/ScalarGlyphText.h\n') == 1
inputs = ['Source/WebCore/Headers.cmake', 'Source/WebCore/platform/Skia.cmake',
          'Source/cmake/WebKitMacros.cmake', *headers]
report = {'scope': 'Exact CMake forwarding/header compile only; no engine or runtime acceptance',
          'source': str(source), 'inputSha256': {n: hashlib.sha256((source/n).read_bytes()).hexdigest() for n in inputs},
          'cases': [], 'status': 'running'}
def persist(): (out/'result.json').write_text(json.dumps(report, indent=2)+'\n')
def run(name, argv):
    r = subprocess.run(argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=120)
    (out/(name+'.log')).write_text(r.stdout)
    return r
persist()
try:
    for fixed in [False, True]:
        name = 'fixed' if fixed else 'old-missing-registration'
        project = out/name
        project.mkdir()
        # Convert every path to absolute before invoking the original macro. No
        # source-dir header fallback is placed on the consumer's include path.
        content = '''cmake_minimum_required(VERSION 3.20)
project(WebKitHeaderForwarding LANGUAGES NONE)
include("${WEBKIT_SOURCE}/Source/cmake/WebKitMacros.cmake")
set(WEBCORE_DIR "${WEBKIT_SOURCE}/Source/WebCore")
include("${WEBCORE_DIR}/Headers.cmake")
include("${WEBCORE_DIR}/platform/Skia.cmake")
'''
        if not fixed:
            content += 'list(REMOVE_ITEM WebCore_PRIVATE_FRAMEWORK_HEADERS platform/graphics/ScalarGlyphText.h)\n'
        content += 'set(REVIEWED_HEADERS\n' + '\n'.join('    '+h.removeprefix('Source/WebCore/') for h in headers) + '\n)\n'
        content += '''file(WRITE "${CMAKE_BINARY_DIR}/registered.txt" "${WebCore_PRIVATE_FRAMEWORK_HEADERS}")
# Exercise only the seven reviewed source headers. Unrelated generated headers
# require the full engine configure and are not claimed by this cheap graph.
set(FORWARDED_HEADERS)
foreach(header IN LISTS REVIEWED_HEADERS)
    if(header IN_LIST WebCore_PRIVATE_FRAMEWORK_HEADERS)
        list(APPEND FORWARDED_HEADERS "${WEBCORE_DIR}/${header}")
    endif()
endforeach()
WEBKIT_SYMLINK_FILES(WebCore_CopyPrivateHeaders
    DESTINATION "${CMAKE_BINARY_DIR}/WebCore/PrivateHeaders/WebCore"
    FILES ${FORWARDED_HEADERS} FLATTENED)
'''
        (project/'CMakeLists.txt').write_text(content)
        build = project/'build'
        r = run(name+'-configure', [a.cmake, '-S', str(project), '-B', str(build), '-G', 'Ninja',
                '-DCMAKE_MAKE_PROGRAM='+a.ninja, '-DWEBKIT_SOURCE='+str(source)])
        assert r.returncode == 0, r.stdout[-3000:]
        r = run(name+'-forward', [a.cmake, '--build', str(build), '--target', 'WebCore_CopyPrivateHeaders'])
        assert r.returncode == 0, r.stdout[-3000:]
        forwarded = build/'WebCore/PrivateHeaders/WebCore'
        registered = (build/'registered.txt').read_text().split(';')
        rows = []
        for h in headers:
            rel = h.removeprefix('Source/WebCore/')
            dest = forwarded/pathlib.Path(h).name
            expected = fixed or not h.endswith('/ScalarGlyphText.h')
            assert (rel in registered) == expected
            assert dest.exists() == expected
            if expected:
                assert dest.is_symlink() and dest.resolve() == (source/h).resolve()
                assert dest.read_bytes() == (source/h).read_bytes()
            rows.append({'header': h, 'registered': rel in registered, 'forwarded': dest.exists()})
        probe = project/'consumer.cpp'
        probe.write_text('#include <ScalarGlyphText.h>\nint main() { WebCore::ScalarGlyphText text; return text.utf8.size(); }\n')
        r = run(name+'-consumer', [a.compiler, '-std=c++20', '-Wall', '-Wextra', '-Werror',
                '-fsyntax-only', '-I'+str(forwarded), str(probe)])
        if fixed:
            assert r.returncode == 0, r.stdout
        else:
            assert r.returncode != 0 and 'ScalarGlyphText.h' in r.stdout and ('No such file' in r.stdout or 'file not found' in r.stdout)
        report['cases'].append({'case': name, 'consumerExitCode': r.returncode, 'headers': rows,
                                'registeredCount': len(registered)})
        persist()
    report['status'] = 'passed'
except Exception as error:
    report['status'] = 'failed'; report['error'] = str(error)
    raise
finally:
    persist()
print(json.dumps(report))
