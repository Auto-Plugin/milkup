"""Fail-closed diagnostic parser. Diagnostic hypotheses are not PDF acceptance."""
import json
import math

PREFIX = 'MILKUP_PAGINATION '
ENTRIES = {'before-break', 'after-break', 'adjust', 'table-layout'}
POINTS = {'return', 'page-height', 'remaining-height', 'child-relayout-enter',
          'child-relayout-exit', 'selected-strut', 'strut-propagate', 'strut-consume',
          'table-recursive-relayout', 'table-recursive-return'}
BOX_FIELDS = {'kind', 'seq', 'tick', 'role', 'node', 'call', 'parent', 'value',
              'top', 'height', 'width', 'marginBefore', 'marginAfter', 'block',
              'strut', 'before', 'after', 'inside', 'dirty', 'horizontal'}


def integer(x, lo, hi):
    assert type(x) is int and lo <= x <= hi, 'integer bounds'


def finite(x):
    assert type(x) in (int, float) and math.isfinite(x) and abs(x) <= 1_000_000, 'finite bounded number'


def rectangle(r):
    assert type(r) is list and len(r) == 4, 'rectangle'
    for v in r: finite(v)
    assert r[2] >= r[0] and r[3] >= r[1], 'inverted rectangle'


def parse(text, expected_pages):
    integer(expected_pages, 1, 32)
    assert len(text.encode()) <= 2 * 1024 * 1024, 'log budget'
    rows = [json.loads(x[len(PREFIX):]) for x in text.splitlines() if x.startswith(PREFIX)]
    assert 0 < len(rows) <= 4096, 'missing/budget records'
    stack = []; calls = {}; identities = {}; pages = {}; current = None
    last_tick = -1; final_started = False
    for seq, r in enumerate(rows, 1):
        assert isinstance(r, dict) and r.get('kind') != 'error', 'native error'
        assert r['seq'] == seq, 'missing/reordered sequence'
        integer(r['tick'], 0, 2**63-1)
        assert r['tick'] >= last_tick, 'non-monotonic process clock'
        last_tick = r['tick']; k = r['kind']
        if k in ENTRIES | POINTS | {'end', 'strut-write', 'strut-written', 'final'}:
            assert set(r) == BOX_FIELDS, 'box schema'
            for f in ['role', 'node']: integer(r[f], 1, 6 if f == 'role' else 32)
            assert identities.setdefault(r['role'], r['node']) == r['node'], 'renderer replaced'
            assert len(set(identities.values())) == len(identities), 'node alias'
            for f in ['value', 'top', 'height', 'width', 'marginBefore', 'marginAfter', 'strut']: finite(r[f])
            for f in ['block', 'dirty', 'horizontal']: assert type(r[f]) is bool, 'boolean'
            assert r['horizontal'], 'writing mode outside fixture contract'
            integer(r['before'], 0, 9); integer(r['after'], 0, 9); integer(r['inside'], 0, 3)
            integer(r['call'], 0, 4096); integer(r['parent'], 0, 4096)
            if k == 'final':
                assert current and not stack and not r['dirty'], 'final layout not settled'
                assert r['call'] == r['parent'] == 0 and r['role'] not in pages[current]['boxes'], 'duplicate final'
                pages[current]['boxes'][r['role']] = r
            else:
                assert not final_started, 'layout changed during spooling'
                if k in ENTRIES:
                    assert r['call'] == len(calls) + 1 and r['parent'] == (stack[-1] if stack else 0), 'call ancestry'
                    calls[r['call']] = [r]; stack.append(r['call'])
                elif k in {'strut-write', 'strut-written'}:
                    assert r['call'] == (stack[-1] if stack else 0), 'write origin'
                    if stack: calls[stack[-1]].append(r)
                else:
                    assert stack and r['call'] == stack[-1], 'unbalanced call'
                    entry = calls[stack[-1]][0]
                    assert r['role'] == entry['role'] and r['parent'] == entry['parent'], 'call subject'
                    calls[stack[-1]].append(r)
                    if k == 'end': stack.pop()
        elif k == 'page':
            assert set(r) == {'kind','seq','tick','page','rect','ctm'}, 'page schema'
            assert not stack and current is None and r['page'] == len(pages) + 1, 'page order'
            final_started = True; current = r['page']
            assert current <= expected_pages, 'extra page'
            rectangle(r['rect']); m = r['ctm']
            assert len(m) == 6, 'matrix'
            for x in m: finite(x)
            assert m[1] == m[2] == 0 and m[0] > 0 and m[3] > 0, 'unsupported matrix'
            pages[current] = {'header':r, 'boxes':{}, 'quads':{}}
        elif k == 'quad':
            assert set(r) == {'kind','seq','tick','page','role','node','rect'}, 'quad schema'
            assert current == r['page'] and r['role'] in pages[current]['boxes'], 'quad outside final box'
            assert r['node'] == identities[r['role']], 'quad instance'
            rectangle(r['rect'])
            q = pages[current]['quads'].setdefault(r['role'], []); q.append(r['rect'])
            assert len(q) <= 32, 'fragment budget'
        elif k == 'page-end':
            assert set(r) == {'kind','seq','tick','page'}, 'end schema'
            assert current == r['page'] and set(pages[current]['boxes']) == set(range(1,7)), 'missing roles'
            assert set(pages[current]['quads']) == set(range(1,7)), 'missing quads'
            current = None
        else: raise AssertionError('unknown kind')
    assert current is None and not stack and len(pages) == expected_pages, 'truncated stream'
    assert calls and any(x[0]['kind'] == 'after-break' and x[0]['role'] == 1 for x in calls.values()), 'heading break path not observed'
    assert any(x[0]['kind'] == 'table-layout' and x[0]['role'] == 3 for x in calls.values()), 'table layout not observed'
    for events in calls.values():
        returns = [e for e in events if e['kind'] == 'return']
        assert len(returns) == (0 if events[0]['kind'] == 'table-layout' else 1), 'missing/duplicate return'
    return {'rows':rows, 'calls':calls, 'pages':pages}


def observations(parsed):
    """Return observable alternatives; never infer intention from a nonzero strut."""
    resets = []
    for call, events in parsed['calls'].items():
        ancestor = call
        while ancestor and parsed['calls'][ancestor][0]['kind'] != 'table-layout':
            ancestor = parsed['calls'][ancestor][0]['parent']
        if not ancestor: continue
        writes = [x for x in events if x['kind'] == 'strut-write' and x['strut'] > 0 and x['value'] == 0]
        for w in writes:
            confirmed = any(e['seq'] > w['seq'] and e['kind'] == 'strut-written' and e['node'] == w['node'] and e['strut'] == e['value'] == 0 for e in events)
            assert confirmed, 'unconfirmed positive strut reset'
            resets.append({'call':call, 'tableCall':ancestor, 'role':w['role'], 'seq':w['seq'], 'oldStrut':w['strut']})
    heading = [e for c in parsed['calls'].values() if c[0]['kind'] == 'after-break' and c[0]['role'] == 1 for e in c]
    avoid = any(x['after'] in (1,3) for x in heading)
    unchanged = all(next((e['value'] for e in c if e['kind'] == 'return'), None) == c[0]['value']
                    for c in parsed['calls'].values() if c[0]['kind'] == 'after-break' and c[0]['role'] == 1)
    visible = {role:[] for role in range(1,7)}
    for page, item in parsed['pages'].items():
        clip = item['header']['rect']
        for role, quads in item['quads'].items():
            if any(min(q[2],clip[2]) > max(q[0],clip[0]) and min(q[3],clip[3]) > max(q[1],clip[1]) for q in quads):
                visible[role].append(page)
    separated = bool(visible[1] and visible[6] and not set(visible[1]) & set(visible[6]))
    return {'headingAvoidObserved':avoid, 'headingBreakReturnedUnchanged':unchanged,
            'positiveStrutResetInsideTableLayout':resets,
            'finalVisibleBoxPages':visible, 'headingAndFirstRowBoxesSeparated':separated,
            'diagnosticBranch':('observed-strut-reset-during-table-layout' if resets else
                                'observed-avoid-without-heading-break-movement' if avoid and unchanged and separated else 'inconclusive'),
            'scope':'Observed paths only. A reset is not proof of lost keep intent; absence is not proof of an uninstrumented path. Compare final geometry and intact baseline separately.'}


if __name__ == '__main__':
    import argparse
    from pathlib import Path
    parser=argparse.ArgumentParser();parser.add_argument('log',type=Path);parser.add_argument('out',type=Path);parser.add_argument('--pages',required=True,type=int)
    args=parser.parse_args()
    try:
        parsed=parse(args.log.read_text(),args.pages)
        report={'status':'complete-diagnostic-only','records':len(parsed['rows']),'observations':observations(parsed)}
    except Exception as error:
        args.out.write_text(json.dumps({'status':'failed','error':str(error)},indent=2)+'\n')
        raise
    args.out.write_text(json.dumps(report,indent=2)+'\n')
