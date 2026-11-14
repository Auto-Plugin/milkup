import { describe, it, expect, vi } from 'vitest'
import { ActionRegistry } from '@milkup/core'
import type { PluginManifest, PluginPackageArchive } from '@milkup/plugin'
import { DesktopPluginManager } from './desktop-plugin-manager'
import type { DesktopPluginCatalog, PluginCatalogSnapshot, PluginCatalogEntry, PluginCatalogAction } from './plugin-catalog-contract'

const manifest=(version='1.0.0',permissions:PluginManifest['permissions']=[]):PluginManifest=>({id:'test.lifecycle',name:'Lifecycle',version,host:'worker',main:'./dist/plugin.js',permissions})
const archive=(version='1.0.0',permissions:PluginManifest['permissions']=[]):PluginPackageArchive=>({format:'milkup-plugin',version:1,manifest:manifest(version,permissions),files:[{path:'dist/plugin.js',encoding:'utf8',content:'export default {}'}]})
class Catalog implements DesktopPluginCatalog {
  snapshot:PluginCatalogSnapshot={version:1,revision:0,entries:[],diagnostics:[],migrationReceipt:'fresh'}
  events:string[]=[]; sequence=0; failCommit=false
  async read(){return structuredClone(this.snapshot)}
  async migrateLegacy():Promise<PluginCatalogSnapshot>{throw Error('unexpected legacy migration')}
  async prepare({archive:pkg,sourcePath,expectedRevision}:Parameters<DesktopPluginCatalog['prepare']>[0]){
    const before=this.snapshot.entries.find(x=>x.id===pkg.manifest.id)
    expect(expectedRevision).toBe(before?.revision??null)
    const n=++this.sequence
    const entry:PluginCatalogEntry={id:pkg.manifest.id,revision:(before?.revision??0)+1,active:before?.active??null,previous:before?.previous??null,pending:{transactionId:'t'+n,phase:'prepared',restoreEnabled:before?.enabled??false,generation:{id:'g'+n,manifest:pkg.manifest,manifestSha256:'a'.repeat(64),contentSha256:String(n).repeat(64),capabilityFingerprint:'b'.repeat(64),approvedFingerprint:null,verified:false,sourcePath,packageRoot:'/plugins/test.lifecycle/generations/g'+n}},enabled:before?.enabled??false,tombstone:false,startAttempt:null,diagnostics:[],dataRoot:'/data/test.lifecycle',storageRoot:'/storage/test.lifecycle'}
    this.events.push('prepare:'+n);this.set(entry);return this.read()
  }
  private set(entry:PluginCatalogEntry){this.snapshot={...this.snapshot,revision:this.snapshot.revision+1,entries:[...this.snapshot.entries.filter(x=>x.id!==entry.id),entry]}}
  async transition(id:string,revision:number,action:PluginCatalogAction){
    let e=structuredClone(this.snapshot.entries.find(x=>x.id===id)!) as any
    expect(e.revision).toBe(revision);this.events.push(action.type)
    if('transactionId'in action){expect(e.pending.transactionId).toBe(action.transactionId);expect(e.pending.generation.capabilityFingerprint).toBe(action.fingerprint)}
    if(action.type==='approve')e.pending.generation.approvedFingerprint=action.fingerprint
    if(action.type==='beginTrial')e.pending.phase='trial'
    if(action.type==='commit'){
      if(this.failCommit)throw Error('commit disk failure')
      e.previous=e.active;e.active={...e.pending.generation,verified:true};e.pending=null;e.enabled=action.enabled
    }
    if(action.type==='abort'){e.enabled=e.pending.restoreEnabled;e.pending=null}
    if(action.type==='startupBegin'){e.startAttempt='attempt'+(++this.sequence);e.enabled=true}
    if(action.type==='startupComplete'){expect(e.startAttempt).toBe(action.attemptId);e.startAttempt=null}
    if(action.type==='disable'){e.enabled=false;e.startAttempt=null}
    if(action.type==='markFailed'){e.enabled=false;e.startAttempt=null;e.diagnostics.push(action.message)}
    if(action.type==='remove'){e.tombstone=true;e.enabled=false;e.pending=null;e.startAttempt=null;if(e.active)e.active.approvedFingerprint=null}
    if(action.type==='revokeApproval'){e.enabled=false;e.pending=null;e.startAttempt=null;e.active.approvedFingerprint=null}
    if(action.type==='approveActive')e.active.approvedFingerprint=action.fingerprint
    if(action.type==='rollback'){e.active=e.previous;e.previous=null;e.enabled=false;e.pending=null}
    e.revision++;this.set(e);return this.read()
  }
}
function setup(options:{activate?:(version:string,context:any)=>unknown;storage?:Storage}={}) {
 const catalog=new Catalog(),events:string[]=[], actions=new ActionRegistry();let pkg=archive()
 const manager=new DesktopPluginManager({catalog,actionRegistry:actions,permissions:['document:write'],milkupVersion:'2.0.0',pluginSdkVersion:'0.3.7',...(options.storage?{storage:options.storage}:{}),manifestHost:{selectManifestPath:async()=>undefined,readManifestText:async()=>JSON.stringify(pkg)},loadModule:async(manifest)=>({module:{runtimeHost:'isolated',activate:context=>{events.push('activate:'+manifest.version);options.activate?.(manifest.version,context);return{};}},dispose:()=>{events.push('dispose:'+manifest.version)}})})
 const approve=async()=>{const e=catalog.snapshot.entries[0]!;return manager.approve(e.id,e.pending?.generation.capabilityFingerprint??e.active!.capabilityFingerprint,e.revision)}
 const install=async(version='1.0.0',permissions:PluginManifest['permissions']=[])=>{pkg=archive(version,permissions);return manager.installManifestPath('/candidate.milkup-plugin')}
 return {catalog,manager,events,actions,approve,install}
}
describe('P6 authoritative catalog transactions',()=>{
 it('stages without running or replacing old active approval; exact review is required',async()=>{
  const s=setup();await s.manager.ready;await s.install();expect(s.events).toEqual([]);expect(s.manager.state().records[0]?.enabled).toBe(false)
  const stale=s.catalog.snapshot.entries[0]!.revision;await s.install('2.0.0')
  await expect(s.manager.approve('test.lifecycle','b'.repeat(64),stale)).rejects.toThrow('stale')
  expect(s.catalog.snapshot.entries[0]!.pending!.generation.approvedFingerprint).toBeNull()
  await s.approve();await s.manager.enable('test.lifecycle');expect(s.manager.state().records[0]?.manifest.version).toBe('2.0.0')
  await s.install('3.0.0',['document:write']);expect(s.manager.state().records[0]?.manifest.version).toBe('2.0.0');expect(s.manager.state().records[0]?.enabled).toBe(true)
  expect(s.manager.state().records[0]?.approvals.permissions).toEqual([])
 })
 it('tears old epoch down before trial, commits before publish, and recovers old version with new epoch on failure',async()=>{
  const s=setup({activate:version=>{if(version==='2.0.0')throw Error('bad activation')}});await s.manager.ready;await s.install();await s.approve();await s.manager.enable('test.lifecycle')
  const epoch=s.manager.documentRendererGeneration('test.lifecycle');await s.install('2.0.0');await s.approve()
  await expect(s.manager.enable('test.lifecycle')).rejects.toThrow('bad activation')
  expect(s.events.indexOf('dispose:1.0.0')).toBeLessThan(s.events.indexOf('activate:2.0.0'))
  expect(s.events.filter(x=>x==='activate:1.0.0')).toHaveLength(2)
  expect(s.manager.documentRendererGeneration('test.lifecycle')).toBeGreaterThan(epoch)
  expect(s.manager.state().records[0]).toMatchObject({enabled:true,manifest:{version:'1.0.0'}})
 })
 it('cannot grant candidate capabilities via pending approval or side effects during activate',async()=>{
  const s=setup({activate:(_version,context)=>{context.host.ui?.update('not-a-view')}})
  await s.manager.ready;await s.install();await s.approve();await s.manager.enable('test.lifecycle')
  // Sidecar and DOM cannot silently bypass a restricted activation unsupported by the host.
  const entry=s.catalog.snapshot.entries[0]!
  s.catalog.snapshot={...s.catalog.snapshot,entries:[{...entry,active:{...entry.active!,manifest:{...entry.active!.manifest,host:'sidecar'}}}]}
  const restarted=new DesktopPluginManager({catalog:s.catalog,actionRegistry:new ActionRegistry(),permissions:[],milkupVersion:'2.0.0',pluginSdkVersion:'0.3.7',manifestHost:{selectManifestPath:async()=>undefined,readManifestText:async()=>''}})
  await restarted.ready;expect(restarted.state().records[0]?.enabled).toBe(false)
 })
 it('serializes queued approval and remove; tombstone keeps data/settings and never revives from mirror',async()=>{
  const values=new Map<string,string>([['milkup.plugin.storage.test.lifecycle.keep','KEEP']]);const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)},clear:()=>{},key:()=>null,length:1} as Storage
  const s=setup({storage});await s.manager.ready;await s.install();const approval=s.approve();const removal=s.manager.remove('test.lifecycle');await Promise.all([approval,removal])
  expect(s.catalog.events.slice(-2)).toEqual(['approve','remove']);expect(s.catalog.snapshot.entries[0]!.tombstone).toBe(true);expect(values.get('milkup.plugin.storage.test.lifecycle.keep')).toBe('KEEP');expect(s.manager.state().records).toEqual([])
 })
 it('recovers a committed generation when contribution publication fails',async()=>{
  const s=setup();await s.manager.ready;await s.install();await s.approve();await s.manager.enable('test.lifecycle');await s.install('2.0.0');await s.approve()
  const runtime=(s.manager as any).runtime;vi.spyOn(runtime,'publishPlugin').mockImplementationOnce(()=>{throw Error('publish failed')})
  await expect(s.manager.enable('test.lifecycle')).rejects.toThrow('publish failed');expect(s.catalog.events).toContain('rollback');expect(s.manager.state().records[0]).toMatchObject({enabled:true,manifest:{version:'1.0.0'}})
 })
})

describe('P6 candidate failure injection',()=>{
 it('denies a swallowed initialization write and restores unchanged data',async()=>{
  const values=new Map<string,string>([['milkup.plugin.storage.test.lifecycle.existing','OLD']]);const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v)},removeItem:(k:string)=>{values.delete(k)},clear:()=>{},key:()=>null,length:1} as Storage
  const s=setup({storage,activate:(version,context)=>{if(version==='2.0.0')try{context.host.storage.setItem('existing','BAD')}catch{/* malicious swallow */}}})
  await s.manager.ready;await s.install();await s.approve();await s.manager.enable('test.lifecycle');await s.install('2.0.0');await s.approve()
  await expect(s.manager.enable('test.lifecycle')).rejects.toThrow()
  expect(values.get('milkup.plugin.storage.test.lifecycle.existing')).toBe('OLD')
  expect(s.manager.state().records[0]).toMatchObject({enabled:true,manifest:{version:'1.0.0'}})
 })
 it('recovers old active after native commit rejects without publishing the candidate',async()=>{
  const s=setup();await s.manager.ready;await s.install();await s.approve();await s.manager.enable('test.lifecycle');await s.install('2.0.0');await s.approve();s.catalog.failCommit=true
  await expect(s.manager.enable('test.lifecycle')).rejects.toThrow('commit disk failure')
  expect(s.catalog.snapshot.entries[0]!.pending).toBeNull();expect(s.manager.state().records[0]).toMatchObject({enabled:true,manifest:{version:'1.0.0'}})
 })
 it('caps hanging candidate activation and attempts new-epoch recovery',async()=>{
  vi.useFakeTimers()
  try{
   const s=setup();await s.manager.ready;await s.install();await s.approve();await s.manager.enable('test.lifecycle');await s.install('2.0.0');await s.approve()
   const original=(s.manager as any).loadModule;const loader=vi.spyOn(s.manager as any,'loadModule').mockImplementation(async(m:any,...args:any[])=>m.version==='2.0.0'?({module:{runtimeHost:'isolated',activate:()=>new Promise(()=>{})},dispose:()=>{}}):original(m,...args))
   const pending=s.manager.enable('test.lifecycle');const assertion=expect(pending).rejects.toThrow('timed out')
   await vi.advanceTimersByTimeAsync(10001);loader.mockRestore();await assertion
   expect(s.catalog.snapshot.entries[0]!.pending).toBeNull()
  }finally{vi.useRealTimers()}
 })
 it('does not trust a poisoned mirror and quarantines an interrupted startup instead of retrying forever',async()=>{
  const s=setup();await s.manager.ready;await s.install();await s.approve();await s.manager.enable('test.lifecycle')
  const e=s.catalog.snapshot.entries[0]!;s.catalog.snapshot={...s.catalog.snapshot,entries:[{...e,startAttempt:'interrupted',enabled:true}]}
  const load=vi.fn();const storage={getItem:()=>{throw Error('blocked storage')},setItem:()=>{throw Error('quota')},removeItem:vi.fn(),length:0,key:()=>null,clear:()=>{}} as Storage
  const next=new DesktopPluginManager({catalog:s.catalog,storage,actionRegistry:new ActionRegistry(),permissions:[],milkupVersion:'2.0.0',pluginSdkVersion:'0.3.7',manifestHost:{selectManifestPath:async()=>undefined,readManifestText:async()=>''},loadModule:load})
  await next.ready;expect(load).not.toHaveBeenCalled();expect(next.state().records[0]).toMatchObject({enabled:false,state:'failed'});expect(s.catalog.events).toContain('markFailed')
 })
})

 describe('P6 retirement and public diagnostic boundaries',()=>{
 it('retains a rejected isolation owner and retries before any new activation',async()=>{
  const s=setup();await s.manager.ready;await s.install();await s.approve();await s.manager.enable('test.lifecycle')
  const owner=(s.manager as any).loadedModules.get('test.lifecycle');let confirmed=false;const stop=vi.fn(async()=>{if(!confirmed)throw Error('stop not confirmed')});owner.dispose=stop
  await expect(s.manager.disable('test.lifecycle')).rejects.toThrow('cleanup')
  await expect(s.manager.enable('test.lifecycle')).rejects.toThrow('cleanup')
  expect(s.events.filter(x=>x==='activate:1.0.0')).toHaveLength(1)
  confirmed=true;await s.manager.enable('test.lifecycle')
  expect(stop.mock.calls.length).toBeGreaterThanOrEqual(3);expect(s.events.filter(x=>x==='activate:1.0.0')).toHaveLength(2)
 })
 it('keeps callback errors diagnostic when the trusted owner confirms termination',async()=>{
  const s=setup();await s.manager.ready;await s.install();await s.approve();await s.manager.enable('test.lifecycle')
  const runtime=(s.manager as any).runtime;const original=runtime.disablePlugin.bind(runtime)
  vi.spyOn(runtime,'disablePlugin').mockImplementation(async(id:any)=>{const result=await original(id);return {...result,errors:[...result.errors,{phase:'disable',message:'plugin callback rejected'}]}})
  await s.manager.disable('test.lifecycle');expect(s.manager.state().diagnostics?.join(' ')).toContain('plugin callback rejected')
  await s.manager.enable('test.lifecycle');expect(s.manager.state().records[0]?.enabled).toBe(true)
 })
 it('never exposes native or activation paths through the public management adapter',async()=>{
  const s=setup();await s.manager.ready;await s.install();await s.approve();await s.manager.enable('test.lifecycle')
  const entry=s.catalog.snapshot.entries[0]!;s.catalog.snapshot={...s.catalog.snapshot,entries:[{...entry,diagnostics:['Activation failed: /private/home/secret/plugin.js:1','Native cleanup failed at C:\\Users\\private\\plugin']}]};(s.manager as any).applyCatalog(await s.catalog.read())
  const detail=s.manager.managementDescribe({pluginId:entry.id,revision:s.catalog.snapshot.revision})
  expect(detail.diagnostics).toHaveLength(2);expect(JSON.stringify(detail.diagnostics)).not.toMatch(/private|secret|Users|plugin\.js/);expect(detail.diagnostics[0]?.message).toContain('host details')
 })
 })


describe('Read-only cross-review regressions',()=>{
 it('first-install publication failure must persist disabled state when no rollback generation exists',async()=>{
  const s=setup();await s.manager.ready;await s.install();await s.approve()
  const nativeTransition=s.catalog.transition.bind(s.catalog)
  vi.spyOn(s.catalog,'transition').mockImplementation(async(id,revision,action)=>{
   if(action.type==='rollback'&&!s.catalog.snapshot.entries[0]!.previous)throw Error('[plugin-catalog:conflict] no verified previous installation')
   return nativeTransition(id,revision,action)
  })
  vi.spyOn((s.manager as any).runtime,'publishPlugin').mockImplementationOnce(()=>{throw Error('first publication failed')})
  await expect(s.manager.enable('test.lifecycle')).rejects.toThrow('first publication failed')
  expect(s.catalog.snapshot.entries[0]!.enabled).toBe(false)
 })
})
