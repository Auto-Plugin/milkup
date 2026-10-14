from pathlib import Path
repo=Path('/workspace/milkup');root=Path('/workspace/.milkup-v2-phase20')
s=(repo/'tests/native/tauri-production-latency.mjs').read_text().replace("'../helpers/", "'/workspace/milkup/tests/helpers/")
hook='''
  await app.execute(`
  const view=window.__phase20View;if(!view)throw Error('phase20 diagnostic binary required');
  window.__phase20Spans=[];
  const wrap=(object,prefix,names)=>{for(const name of names){const original=object[name];if(typeof original!=='function')throw Error('missing trace method '+name);object[name]=function(...args){const start=performance.now(),wall=Date.now(),version=view.currentSource.version;const info={name:prefix+name,start,wall,version};
  if(name==='parseLiveWindow'){info.from=args[0];info.to=args[1];info.cacheHit=view.markdownCache.has([view.currentSource.documentId,version,args[0],args[1]].join(':'))}
  if(name==='renderSourceLineWindow'){info.from=args[0].fromLine;info.to=args[0].toLine;info.cacheHit=view.sourceWindowCacheKey===view.currentSource.documentId+':'+version&&view.sourceWindowCache.has(args[0].fromLine+':'+args[0].toLine)}
  if(prefix==='nativeSource.'){info.from=args[0];info.to=args[1]}
  const finish=()=>{info.end=performance.now();info.ms=info.end-start;window.__phase20Spans.push(info)};
  try{const result=original.apply(this,args);if(result&&typeof result.then==='function')return result.then(value=>{finish();return value},error=>{finish();throw error});finish();return result}catch(error){finish();throw error}}}};
  wrap(view,'view.', ['scrollToLine','renderVisibleWindow','renderSourceLineWindow','renderLiveLineWindow','parseLiveWindow','parseCompleteTableWindow','measureTableRows','renderCursor','renderSelection','renderSearchHighlights','readSourceLine','readVisibleEditRange','flushPendingVisibleEdit','commitVisibleEdit','refreshAfterOptimisticCommit','applyTextInput','renderOptimisticSourceWindow','renderRenderedLine','renderSingleLiveLine','renderLiveSyntaxAroundPositions','scrollGeometry']);
  wrap(view.currentSource,'nativeSource.',['readLineWindow','lineAtPosition']);
  `)
'''
# Check actual optimistic method name before running.
hook=hook.replace("'renderOptimisticSourceWindow'", "'renderOptimisticSourceWindow'")
needle="  await app.focus('.milkup-input-proxy')\n";assert s.count(needle)==1;s=s.replace(needle,needle+hook)
s=s.replace("'return {invokeDescriptor:window.__latency.invokeDescriptor", "'return {spans:window.__phase20Spans,invokeDescriptor:window.__latency.invokeDescriptor")
s=s.replace('metadata,\n    samples,\n    resources,\n    complete: true,','metadata,\n    samples,\n    resources,\n    diagnosticBuild: true,\n    complete: true,')
(root/'trace-probe.mjs').write_text(s)
