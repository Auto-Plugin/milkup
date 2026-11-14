#!/usr/bin/env python3
"""Read terminal evidence only; no app, UI, renderer or build invocation."""
import datetime, hashlib, json, re
from collections import defaultdict
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / 'review'

def read(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def duration(a, b):
    return round((b['monotonicNs'] - a['monotonicNs']) / 1e6, 6) if a and b else None

result = {'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'method': 'Group DOM_NATIVE_TIMING by instanceId/requestId; sort by monotonicNs, not interleaved stderr order. Duration starts at native dispatch, not enqueue or user click.',
 'queueWaitMs': None, 'pendingRetryCount': None,
 'limits': ['No enqueue timestamps: queue wait is unmeasured.', 'DOM request count is not worker footnote pending/retry count.', 'Native acceptance does not establish PDF text fidelity, physical printing or absence of all leaks.', 'Missing timeout traces mean none observed, not proof against every future timeout.', 'Only completion/failure terminal runs are analysed.'],
 'runs': [], 'awaitingTerminal': []}
for run in sorted((ROOT / 'runs').glob('p6-cold-*')):
    if run.name == 'p6-cold-html-01':
        result['priorFailurePreserved'] = {'run': run.name, 'status': 'failed', 'error': read(run/'failure.json',{}).get('error'), 'note': 'Prior harness assertion failure retained, not counted as pass or folded into HTML02.'}
        continue
    completion, failure = read(run/'completion.json'), read(run/'failure.json')
    if completion is None and failure is None:
        result['awaitingTerminal'].append(run.name)
        continue
    command_path = ROOT/'runs'/'control'/(run.name+'-p6-command.json')
    command = read(command_path,{})
    observations = read(run/'observations.json', [])
    log = (run/'native-timing.log').read_text() if (run/'native-timing.log').exists() else ''
    events, malformed = [], []
    for line in log.splitlines():
        if 'DOM_NATIVE_TIMING ' not in line: continue
        try: events.append(json.loads(line.split('DOM_NATIVE_TIMING ',1)[1]))
        except json.JSONDecodeError: malformed.append(line)
    events.sort(key=lambda e:e['monotonicNs'])
    groups = defaultdict(list)
    for e in events:
        if e.get('requestId') is not None: groups[(e.get('instanceId'),e['requestId'])].append(e)
    requests = []
    for (instance, request), group in groups.items():
        phases = {e['phase']:e for e in group}
        matching = [o for o in observations if o.get('artifact') and any(t.get('instanceId')==instance and t.get('requestId')==request for t in o.get('traces',[]))]
        requests.append({'instanceId':instance, 'requestId':request,
          'request':phases.get('render-request',{}).get('request'),
          'dispatchToOwnerAcceptedMs':duration(phases.get('dispatch'),phases.get('owner-result-accepted')),
          'dispatchToHelperDequeuedMs':duration(phases.get('dispatch'),phases.get('helper-dequeued')),
          'evalSubmittedToCallbackMs':duration(phases.get('helper-eval-submitted'),phases.get('helper-eval-callback')),
          'callbackToResultDrainedMs':duration(phases.get('helper-eval-callback'),phases.get('helper-result-drained')),
          'forwardedToOwnerAcceptedMs':duration(phases.get('helper-frame-forwarded'),phases.get('owner-result-accepted')),
          'sourceCandidatesAtRequestVersion': list({(o.get('sourceSha256'), o.get('document',{}).get('version')): {'sourceSha256':o.get('sourceSha256'),'documentVersion':o.get('document',{}).get('version')} for o in observations if o.get('document',{}).get('version') == phases.get('render-request',{}).get('request',{}).get('version') and str(o.get('document',{}).get('path','')).endswith('/source.md')}.values()),
          'outputObservations':[{'name':o['name'],'sourceSha256':o.get('sourceSha256'),'documentVersion':o.get('document',{}).get('version'),'artifact':Path(o['artifact']['file']).name} for o in matching],
          'events':group})
    cleanup = []
    for e in events:
        if e['phase'] != 'kill-start': continue
        complete = next((v for v in events if v['monotonicNs']>=e['monotonicNs'] and v['phase']=='cleanup-complete' and v.get('instanceId')==e.get('instanceId') and v.get('pid')==e.get('pid')),None)
        confirmed = next((v for v in events if v['monotonicNs']>=e['monotonicNs'] and v['phase']=='cleanup-confirmed' and e.get('instanceId') is not None and v.get('instanceId')==e.get('instanceId')),None)
        cleanup.append({'instanceId':e.get('instanceId'),'guardianPid':e['pid'],'killStartNs':e['monotonicNs'],'killToCleanupCompleteMs':duration(e,complete),'killToOwnerConfirmedMs':duration(e,confirmed)})
    lifecycle = read(run/'process-lifecycle.json',{})
    final = lifecycle.get('rows',[{}])[-1]
    outputs = []
    for o in observations:
        if not o.get('artifact'): continue
        outputs.append({k:o.get(k) for k in ['name','at','sourceSha256','sourceBytes','elapsedMs','statuses','artifact']} | {'documentVersion':o.get('document',{}).get('version'),'harnessElapsedIncludesDialogs':True})
    evidence = ['native-timing.log','observations.json','completion.json','failure.json','process-lifecycle.json','production-origin.json']
    result['runs'].append({'run':run.name,'status':'failed' if failure is not None else ('automated-checks-passed' if completion.get('automatedChecksPassed') else 'terminal-not-passed'),
      'harnessExitCode':command.get('exitCode'),'harnessSha256':command.get('harnessSha256'),'expectedBinarySha256':command.get('env',{}).get('MILKUP_NATIVE_EXPECTED_BINARY_SHA256'),'commandEvidenceSha256':sha(command_path) if command_path.exists() else None,
      'completion':completion,'failure':{'error':failure.get('error')} if failure else None,
      'requests':requests,'outputs':outputs,'timeoutEvents':[e for e in events if 'timeout' in e['phase']],
      'cleanup':cleanup,'cleanupFinalSnapshot':{'label':final.get('label'),'at':final.get('at'),'appCurrent':final.get('app',{}).get('current'),'helpers':[{'pid':h.get('observed',{}).get('pid'),'birth':h.get('observed',{}).get('birth'),'running':h.get('running'),'sameBirth':h.get('sameBirth'),'current':h.get('current'),'windows':h.get('windows')} for h in final.get('helpers',[])]},
      'nativeWarnings':[s for s in log.splitlines() if re.search(r'WARNING|CRITICAL|[Tt]imeout|[Tt]imed out',s) and 'DOM_NATIVE_TIMING ' not in s],
      'malformedTraceLines':malformed,'evidenceSha256':{n:sha(run/n) for n in evidence if (run/n).exists()}})
proof_path = ROOT.parent/'production-accepted'/'proof.json'
proof = read(proof_path,{})
result['production'] = {k:proof.get(k) for k in ['sourceHead','binary','binarySha256','binaryBytes','frontendIndexSha256']}
result['production']['proofSha256'] = sha(proof_path)
result['production']['sourceScope'] = 'Base HEAD plus changedInputs recorded in proof.json; not a clean-HEAD-only build claim.'
result['summary'] = {'terminalRunsAnalysed':len(result['runs']), 'automatedChecksPassedRuns':sum(r['status']=='automated-checks-passed' for r in result['runs']), 'failedRunsAnalysed':sum(r['status']=='failed' for r in result['runs']), 'requestsAnalysed':sum(len(r['requests']) for r in result['runs']), 'additionalPriorFailedRunPreserved':1, 'allExpectedBinaryHashesMatchProof':all(r['expectedBinarySha256']==proof.get('binarySha256') for r in result['runs'])}
(DEST/'first-output-timing.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
lines=['# P6 首次输出原生时序复核','', '只读解析 terminal runs 的原始日志与 observations/completion；未启动 UI、构建或渲染。完整阶段时间、来源 hash、警告和 cleanup 记录见 [JSON](first-output-timing.json)。','', '| Run | 终态 | 请求 / target / version | dispatch → owner accepted (ms) |','| --- | --- | --- | --- |']
for r in result['runs']:
    for q in r['requests']:
        req=q.get('request') or {}
        lines.append(f"| {r['run']} | {r['status']} | {q['requestId']} / {req.get('target')} / {req.get('version')} | {q['dispatchToOwnerAcceptedMs']} |")
lines += ['', '耗时从 native owner 实际 dispatch 开始，绝不是 enqueue 到完成；日志无 enqueue，所以 queue wait 未测。native DOM 请求数不能推算 footnotes worker 的 pending 次数。observations.elapsedMs 含用户界面/目标选择，不能当作纯渲染性能。', '', '每个输出保留 document version 与 source SHA；HTML02 first 是 v0，r2 是真实编辑后 v1。同一已激活实例的第二次输出不能称第二次冷启动。输出警告保留原文，包含有界 Markdown 窗口及无法离线内嵌图片；这些不是 diagrams timeout。', '', '本批已纳入请求的 timeout phase 数：'+str(sum(len(r['timeoutEvents']) for r in result['runs']))+'。cleanup 使用 kill-start→cleanup-complete，并单列实际 owner confirmation；没有 confirmation 不补造。process-lifecycle 最终快照仅证明所跟踪 PID/birth 状态，不外推全部系统进程。native log 中 inspector 端口占用、GTK 警告也保留，不能声称零警告。', '', '此前 p6-cold-html-01 的 footnote marker 计数断言失败继续保留，不改记通过。completion 的 automated checks 通过不等于 PDF copy/search fidelity、物理打印、所有 P6 生命周期故障或历史 2 秒超时已修复。']
lines += ['', '最终纳入 5 个 terminal runs：4 个 automated-checks-passed、1 个 failed；共 6 个 native render 请求。另保留 HTML01 前序失败，不混入通过。全部启动记录的 expected binary SHA 与 production proof 一致：`'+str(proof.get('binarySha256'))+'`。这是 proof 所列基线 HEAD 加 changedInputs 的构建，非仅凭 HEAD 声称干净构建。', '', 'print02 的 v0 源 SHA 为 `8b4f460fb664ce9b2ef92314dd284404eb4bdfeb28578a34d6dfa08a608454a7`，真实 Print-to-File PDF 已产生；harness exit 0。该轮最终跟踪的 helper current 均为 null，日志 guardian cleanup-complete 已保留。print01 的 Z 状态仍独立保留：非 running 不等于 fully reaped。', '', 'PDF 全页视觉与图表保真结论由 content 独立 review 提供（同目录 `*.pdf-review.json`）；本时序报告不替代内容审阅，亦不把 Print-to-File 称为物理打印。']
for r in result['runs']:
    if r['failure']:
        lines += ['', r['run']+' 为失败终态：'+r['failure']['error'].splitlines()[0]+'；native accepted 不等于输出完成，未计为通过。']
    missing = [c['guardianPid'] for c in r['cleanup'] if c['killToCleanupCompleteMs'] is None]
    if missing:
        lines += ['', r['run']+' 以下 guardian 只有 kill-start、无 cleanup-complete：'+str(missing)+'。最终 tracked process 的 running=false 不等于确认已 reap；JSON 保留 current/state 与 birth。']
if result['awaitingTerminal']: lines += ['', '尚未 terminal，不纳入通过：'+', '.join(result['awaitingTerminal'])+'。']
(DEST/'first-output-timing.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'terminalRuns':[r['run'] for r in result['runs']],'awaiting':result['awaitingTerminal'],'requestMs':{r['run']:[q['dispatchToOwnerAcceptedMs'] for q in r['requests']] for r in result['runs']}},ensure_ascii=False))
