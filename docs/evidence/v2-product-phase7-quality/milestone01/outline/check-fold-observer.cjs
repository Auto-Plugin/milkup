const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('/workspace/milkup/node_modules/typescript');
const source=fs.readFileSync('/workspace/milkup/tests/native/tauri-p7-outline-performance.mjs','utf8');
const ast=ts.createSourceFile('harness.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let program;
function walk(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='arm'){function find(a){if(ts.isCallExpression(a)&&ts.isPropertyAccessExpression(a.expression)&&a.expression.name.text==='execute'){program=a.arguments[0].text}ts.forEachChild(a,find)}find(n)}ts.forEachChild(n,walk)}walk(ast);assert(program);
function setup({total=20,end=20,rows=20,collapsed=true,command='outline.collapseAll'}={}){
 let clock=0,raf=0;const frames=new Map(),listeners=new Map();
 const list={dataset:{virtualStart:'0',virtualEnd:String(end),virtualTotal:String(total),virtualRevision:'1',virtualItemHeight:'28'},scrollTop:0};
 let items=Array.from({length:rows},(_,i)=>({title:'heading-'+i,textContent:'heading-'+i,getAttribute:k=>k==='aria-level'?'1':k==='aria-expanded'?String(!collapsed):null,closest(){return this}}));
 const panel={querySelector:s=>s==='[data-virtual-list]'?list:{textContent:'全文索引完成'},querySelectorAll:()=>items};
 const document={querySelector:s=>s==='panel'?panel:{dataset:{loading:'ready'}},addEventListener:(type,cb)=>listeners.set(type,cb),removeEventListener:(type)=>listeners.delete(type),activeElement:null};
 const window={};const context={window,document,performance:{now:()=>clock},MutationObserver:class{observe(){} disconnect(){}},requestAnimationFrame:cb=>{frames.set(++raf,cb);return raf},cancelAnimationFrame:id=>frames.delete(id),goal:{kind:'fold',count:total,command}};
 vm.runInNewContext('(function(){'+program+'}).call(null,goal,"panel","fixture")',context);
 listeners.get('click')({isTrusted:true,type:'click',target:{closest:()=>({dataset:{pluginCommand:command}})}});
 return {window,list,tick(){clock+=16;const pending=[...frames.values()];frames.clear();for(const cb of pending)cb(clock)},resetRows(n){items=items.slice(0,n)}};
}
let failed=0;function check(name,options,expected){const h=setup(options);for(let i=0;i<5;i++)h.tick();try{assert.equal(h.window.__p7Measure.done!==null,expected);console.log('PASS',name)}catch(e){failed++;console.log('FAIL',name,'done=',h.window.__p7Measure.done)}}
check('reject transient collapsed total with previous 160-row range',{end:160,rows:160},false);
check('reject stale 160 DOM rows behind a 20-row metadata range',{rows:160},false);
check('reject missing DOM row',{rows:19},false);
check('reject stale collapsed branches for expand',{total:18000,end:160,rows:160,command:'outline.expandAll'},false);
check('accept stable complete collapsed roots',{},true);
check('accept stable bounded expanded slice',{total:18000,end:160,rows:160,collapsed:false,command:'outline.expandAll'},true);
const h=setup();h.tick();h.list.dataset.virtualRevision='2';h.tick();try{assert.equal(h.window.__p7Measure.done,null);h.tick();assert.equal(h.window.__p7Measure.done,null);h.tick();assert.notEqual(h.window.__p7Measure.done,null);console.log('PASS two frames after changed valid snapshot')}catch(e){failed++;console.log('FAIL stable frame guard',String(e))}
process.exitCode=failed?1:0;
