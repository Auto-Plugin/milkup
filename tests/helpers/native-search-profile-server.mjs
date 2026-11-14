// Opt-in measurement server. Instrumentation only observes search work; UI
// operations still use the real native application and its input path.
import { createServer } from 'vite'
const instrumentation = `
window.__searchProfile={enabled:false};
window.__searchProbe=()=>({path:session.file?.path,loading:loadingState.phase,query:currentSearchQuery(),focused:document.activeElement?.outerHTML?.slice(0,200),mode:session.viewMode,version:session.documentVersion,phase:searchResultState?.phase,matches:searchResultState?.matches,matchCount:searchResultState?.matchCount,matchOffset:searchResultState?.matchOffset,selection:sourceView?.selection,notice,dirty:session.dirty,replacing:!!nativeReplacement,complete:searchResultState?.complete,scannedLines:searchResultState?.scannedLineCount,pending:sourceView?.activeVisibleEditTasks.size??0});
window.__resetSearchProfile=()=>{window.__searchProfile={enabled:true,started:performance.now(),reads:[],updates:[],renders:[],maxTimerGapMs:0};};
let profileLastTick=performance.now();setInterval(()=>{const now=performance.now(),p=window.__searchProfile;if(p.enabled)p.maxTimerGapMs=Math.max(p.maxTimerGapMs,now-profileLastTick);profileLastTick=now;},20);
for(const SearchController of [DesktopDocumentSearchController,LargeDocumentSearchController]) {
const originalSearchRun=SearchController.prototype.run;
SearchController.prototype.run=async function(options){const p=window.__searchProfile;const start=performance.now();const update=options.onUpdate;const result=await originalSearchRun.call(this,{...options,onUpdate:s=>{const at=performance.now();update?.(s);if(p.enabled)p.updates.push({at,ms:performance.now()-at,phase:s.phase,scannedLines:s.scannedLineCount,count:s.matches.length});}});if(p.enabled){p.nativeMetrics=this.metrics;p.searchMs=performance.now()-start;p.doneAt=performance.now();p.result={phase:result.phase,complete:result.complete,count:result.matchCount??result.matches.length,scannedLines:result.scannedLineCount};}return result;};
}
import('/src/large-document-source.ts').then(({LargeDocumentSource})=>{const read=LargeDocumentSource.prototype.readLineWindow;LargeDocumentSource.prototype.readLineWindow=async function(...args){const p=window.__searchProfile,start=performance.now();const result=await read.apply(this,args);if(p.enabled)p.reads.push({from:args[0],to:args[1],ms:performance.now()-start,chars:result.text.length,lineChars:result.lines.reduce((n,l)=>n+l.text.length,0)});return result;};window.__searchProfileReady=true;});
function renderSearchNavigation(){const p=window.__searchProfile,start=performance.now();try{renderSearchNavigationCore();}finally{if(p?.enabled)p.renders.push(performance.now()-start);}}
`
const server = await createServer({
  root: 'apps/desktop',
  configFile: 'apps/desktop/vite.config.ts',
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  plugins: [
    {
      name: 'native-search-profile',
      enforce: 'pre',
      transform(code, id) {
        if (!id.split('?')[0].endsWith('/apps/desktop/src/main.ts')) return
        return (
          code.replace(
            'function renderSearchNavigation(): void {',
            'function renderSearchNavigationCore(): void {',
          ) +
          '\n' +
          instrumentation
        )
      },
    },
  ],
})
await server.listen()
console.log('Native search profiling server on 127.0.0.1:1420')
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    await server.close()
    process.exit(0)
  })
