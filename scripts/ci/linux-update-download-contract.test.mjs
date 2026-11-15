import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import https from 'node:https'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {startFixture} from '../release/test-support/in-app-update-server.mjs'
import {verifyMinisign} from '../release/update-readiness.mjs'
import {requireLoopbackTest} from './check-linux-update-unit.mjs'
import {unwrapWebDriverValue} from '../../tests/helpers/native-production.mjs'
test('actual transport rejects the old error-key observation; scoped UI field preserves native errors',async()=>{
 const source=await readFile('tests/helpers/native-production.mjs','utf8')
 const body=source.split('  const request = async (method, route, body) => {')[1]?.split('  const execute =')[0]
 assert(body?.endsWith('\n'))
 const requestFor=fetch=>Function('fetch','nativeRequestTimeout','unwrapWebDriverValue','process',`const request = async (method, route, body) => {${body};return request`)(fetch,()=>1000,unwrapWebDriverValue,{env:{TAURI_DRIVER_URL:'http://127.0.0.1:1'}})
 const ui=await readFile('scripts/ci/linux-update-download-gui.mjs','utf8')
 const script=/const state=\(\)=>app.execute\(`([^`]+)`\)/.exec(ui)?.[1]
 assert(script)
 const document={querySelector:selector=>selector==='[data-app-version]'?{textContent:'2.0.0-beta.9'}:{innerText:'observed update error',querySelector:()=>({textContent:'The signature verification failed'}),querySelectorAll:()=>[{dataset:{applicationUpdateAction:'check'}}]}}
 const observation=Function('document',script)(document)
 assert.equal(observation.updateError,'The signature verification failed')
 const transport=(value,status=200)=>requestFor(async()=>new Response(JSON.stringify({value}),{status}))('POST','/session/owned/execute/sync',{})
 assert.deepEqual(await transport(observation),observation)
 const legacy=Function('document',script.replace('updateError:','error:'))(document)
 await assert.rejects(transport(legacy),/signature verification failed/)
 await assert.rejects(transport({error:'no such element',message:'real protocol failure'},404),/no such element/)
 await assert.rejects(transport({error:'invalid session id',message:'driver failure'},200),/invalid session id/)
})
test('actual wrapper exports fixture before driver spawn; original late export is rejected',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'milkup-driver-env-'))
 const run=promisify(execFile),wrapper=await readFile('scripts/ci/run-linux-update-download.sh','utf8')
 try{
  for(const fixed of [false,true]){
   const root=path.join(directory,String(fixed)),bin=path.join(root,'bin')
   const {mkdir}=await import('node:fs/promises')
   await mkdir(bin,{recursive:true});await mkdir(path.join(root,'apps/desktop/src-tauri/target/release'),{recursive:true})
   await writeFile(path.join(root,'apps/desktop/src-tauri/target/release/milkup-desktop'),'inert test bytes')
   const script=path.join(root,'wrapper.sh')
   await writeFile(script,fixed?wrapper:wrapper.replace(/^export MILKUP_CI_UPDATE_FIXTURE=.*\n/m,''))
   const shim=async(name,code)=>writeFile(path.join(bin,name),`#!${process.execPath}\n${code}`,{mode:0o700})
   await shim('tauri-driver',`require('node:fs').writeFileSync(process.env.RUNNER_TEMP+'/driver-env.json',JSON.stringify({fixture:process.env.MILKUP_CI_UPDATE_FIXTURE}));setInterval(()=>{},1000)`)
   await shim('curl','process.exit(0)')
   await shim('node',`const fs=require('node:fs'),assert=require('node:assert/strict');const expected=process.env.MILKUP_NATIVE_EVIDENCE_DIR+'/public-fixture.json';assert.equal(process.env.MILKUP_CI_UPDATE_FIXTURE,expected);const until=Date.now()+3000;(function poll(){try{assert.equal(JSON.parse(fs.readFileSync(process.env.RUNNER_TEMP+'/driver-env.json')).fixture,expected)}catch(e){if(e.code==='ENOENT'&&Date.now()<until)return setTimeout(poll,10);throw e}})()`)
   const env={...process.env,PATH:bin+':'+process.env.PATH,GITHUB_ACTIONS:'true',GITHUB_WORKSPACE:root,RUNNER_TEMP:root,GITHUB_RUN_ID:'owned-inert-contract'}
   delete env.MILKUP_CI_UPDATE_FIXTURE
   const operation=run('bash',[script],{env,timeout:10000})
   if(fixed)await operation;else await assert.rejects(operation,/AssertionError/)
  }
 }finally{await rm(directory,{recursive:true,force:true})}
})
test('test-log gate rejects missing, zero, ignored, failed and repeated results',()=>{
 const good='test updates::ci_fixture::tests::download_is_exact_loopback_origin_and_path ... ok\n\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 280 filtered out; finished in 0.00s\n'
 requireLoopbackTest(good)
 for(const bad of ['',good.replace('1 passed','0 passed'),good.replace('0 ignored','1 ignored'),good.replace('0 failed','1 failed'),good+good,good.replace(' ... ok',' ... ignored')])assert.throws(()=>requireLoopbackTest(bad))
})
test('normal channel remains empty and both QA install entry points reject',async()=>{
 assert.deepEqual(JSON.parse(await readFile('release/update-channel.json','utf8')),{channel:'beta',endpoints:[],publicKey:null})
 const host=await readFile('apps/desktop/src-tauri/src/updates.rs','utf8'),vendor=await readFile('vendor/tauri-plugin-updater/src/updater.rs','utf8')
 assert.match(host,/#\[cfg\(feature = "ci-update-fixture"\)\][\s\S]*?pub async fn install_application_update\([\s\S]*?QA_DOWNLOAD_ONLY_INSTALL_BLOCKED[\s\S]*?#\[cfg\(not\(feature = "ci-update-fixture"\)\)\]/)
 assert.match(vendor,/#\[cfg\(feature = "milkup-ci-download-only"\)\][\s\S]*?pub fn install\([\s\S]*?QA_DOWNLOAD_ONLY_INSTALL_BLOCKED[\s\S]*?#\[cfg\(not\(feature = "milkup-ci-download-only"\)\)\]/)
 assert.match(vendor,/\/\/\/ Linux \(AppImage, Deb, RPM\)[\s\S]*?#\[cfg\(not\(feature = "milkup-ci-download-only"\)\)\][\s\S]*?impl Update \{/)
 assert.match(await readFile('apps/desktop/src-tauri/Cargo.toml','utf8'),/ci-update-fixture = \["dep:reqwest", "tauri-plugin-updater\/milkup-ci-download-only"\]/)
 assert.match(host,/validate_download\(&update.download_url\)/)
})
test('native negative observations bind current request mode/path, and never request installation',async()=>{
 const ui=await readFile('scripts/ci/linux-update-download-gui.mjs','utf8')
 assert.match(ui,/requests\.slice\(requestStart\)\.some\(r=>r.mode===expectedMode&&r.path===expectedPath\)/)
 assert.match(ui,/s.updateError&&pattern.test\(s.updateError\)/)
 assert(!ui.includes("clickAction('install')"))
 assert.match(ui,/clickAction\('cancel'\)/)
})
test('loopback HTTPS uses fresh signatures and detects wrong authority/corruption',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'milkup-qa-update-contract-'));let server
 try{
  const artifact=Buffer.from('synthetic contract bytes, not an installer')
  server=await startFixture({artifact,openssl:'/usr/bin/openssl',directory,maxMs:15000})
  const config=JSON.parse(await readFile(path.join(directory,'public-fixture.json'),'utf8'))
  assert.equal(config.scope,'isolated-linux-download-only-not-for-distribution')
  const get=route=>new Promise((resolve,reject)=>{https.get(server.base+route,{ca:server.cert},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks)}))}).on('error',reject)})
  let envelope=JSON.parse((await get('/manifest.json')).body)
  assert.throws(()=>verifyMinisign(Buffer.from(envelope.payload,'base64'),envelope.signature,config.channel.publicKey))
  await writeFile(path.join(directory,'endpoint-mode.txt'),'valid')
  envelope=JSON.parse((await get('/manifest.json')).body);const payload=Buffer.from(envelope.payload,'base64')
  verifyMinisign(payload,envelope.signature,config.channel.publicKey)
  const release=JSON.parse(payload).release,platform=release.platforms['linux-x86_64']
  assert.equal(release.version,'2.0.0-beta.10');assert.equal(platform.url,server.base+'/candidate.deb')
  verifyMinisign((await get('/candidate.deb')).body,platform.signature,config.channel.publicKey)
  await writeFile(path.join(directory,'endpoint-mode.txt'),'bad-artifact')
  assert.throws(()=>verifyMinisign((Buffer.from(artifact).map((v,i)=>i===artifact.length-1?v^1:v)),platform.signature,config.channel.publicKey))
  const corrupt=await get('/candidate.deb');assert.notDeepEqual(corrupt.body,artifact);assert.throws(()=>verifyMinisign(corrupt.body,platform.signature,config.channel.publicKey))
  await writeFile(path.join(directory,'endpoint-mode.txt'),'download-error');assert.equal((await get('/candidate.deb')).status,503)
 }finally{await server?.stop();await rm(directory,{recursive:true,force:true})}
})
