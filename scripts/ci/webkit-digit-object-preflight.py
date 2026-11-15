#!/usr/bin/env python3
"""New FontCascade actual-TU gate; do not rerun the accepted geometry gate."""
import argparse, hashlib, importlib.util, json, os, pathlib, shlex, signal, subprocess, time

p = pathlib.Path(__file__).with_name('webkit-geometry-object-preflight.py')
spec = importlib.util.spec_from_file_location('geometry_helpers', p)
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)

def run(source, build, out):
    out.mkdir(parents=True, exist_ok=False)
    report = {'status': 'running', 'scope': 'Only new actual FontCascade TU; inherited geometry objects not retested', 'samples': []}
    def persist(): (out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    def execute(name, cmd, timeout, cwd=None, env=None):
        (out / (name + '-command.json')).write_text(json.dumps({'cwd': str(cwd or build), 'arguments': cmd}, indent=2))
        start = time.monotonic()
        with (out / (name + '.log')).open('w') as log:
            proc = subprocess.Popen(cmd, cwd=cwd or build, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try: code = proc.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGTERM)
                try: proc.wait(timeout=5)
                except subprocess.TimeoutExpired: os.killpg(proc.pid, signal.SIGKILL); proc.wait()
                raise RuntimeError(name + ' exceeded bounded timeout')
        report['samples'].append({'name': name, 'exitCode': code, 'seconds': round(time.monotonic()-start, 3)}); persist()
        assert code == 0, name + ' failed'
    try:
        assert os.getuid() != 0
        execute('refresh-manifest', ['ninja', 'build.ninja'], 120)
        db = json.loads((build / 'compile_commands.json').read_text())
        actual = source / 'Source/WebCore/platform/graphics/FontCascade.cpp'
        selected = [e for e in db if g.unit_contains(e, actual)]
        assert len(selected) == 1
        report['selectedUnit'] = selected[0]; report['sourceSha256'] = g.digest(actual)
        report['compileDatabaseSha256'] = g.digest(build / 'compile_commands.json'); persist()
        targets = set(x.rsplit(': ', 1)[0] for x in subprocess.check_output(['ninja', '-t', 'targets', 'all'], cwd=build, text=True, timeout=30).splitlines())
        header_targets = g.HEADER_TARGETS + (['ANGLE-webgl-headers'] if 'ANGLE-webgl-headers' in targets else [])
        assert set(header_targets) <= targets
        plan = subprocess.check_output(['ninja', '-t', 'commands', *header_targets], cwd=build, text=True, timeout=45)
        report['headerPlanLines'] = g.validate_header_plan(plan)
        (out / 'header-plan.log').write_text(plan)
        execute('generate-headers', ['ninja', '-v', '-j', '4', *header_targets], 240)
        report['headerExecution'] = g.validate_header_execution((out / 'generate-headers.log').read_text(), plan, build)
        for name in g.NAME_INPUTS:
            target = 'WebCore/DerivedSources/' + name + 'Names.h'
            graph = subprocess.check_output(['ninja', '-t', 'commands', target], cwd=build, text=True, timeout=30)
            cwd, cmd = g.name_generator_command(graph, name, source, build)
            execute('generate-' + name, cmd, 30, cwd=cwd)
        headers = {str(p.relative_to(build)): g.digest(p) for d in build.glob('*/DerivedSources') for p in d.rglob('*.h') if p.is_file() and not p.is_symlink()}
        assert 0 < len(headers) < 20000
        (out / 'generated-header-sha256.json').write_text(json.dumps(headers, indent=2))
        entry = selected[0]; args = entry.get('arguments') or shlex.split(entry['command']); target = args[args.index('-o')+1]
        graph = subprocess.check_output(['ninja', '-t', 'commands', target], cwd=build, text=True, timeout=30)
        assert len(graph.encode()) < 32 * 1024 * 1024
        (out / 'actual-object-graph.log').write_text(graph)
        target, cmd = g.original_command(entry, graph, build)
        (out / 'actual-unit.cpp').write_bytes(pathlib.Path(entry['file']).read_bytes())
        obj = build / target; obj.parent.mkdir(parents=True, exist_ok=True); obj.unlink(missing_ok=True)
        execute('FontCascade', cmd, 180, env={**os.environ, 'CCACHE_DISABLE': '1'})
        assert obj.is_file() and obj.stat().st_size > 0
        assert g.digest(actual) == report['sourceSha256']
        report.update(status='passed', objectSha256=g.digest(obj), sourceUnchanged=True)
    except Exception as error: report.update(status='failed', error=str(error))
    finally: persist()
    return report

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for key in ['source', 'build', 'output']: parser.add_argument('--' + key, type=pathlib.Path, required=True)
    a = parser.parse_args(); r = run(a.source.resolve(), a.build.resolve(), a.output.resolve())
    print(json.dumps(r)); raise SystemExit(0 if r['status'] == 'passed' else 1)
