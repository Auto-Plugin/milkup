import assert from 'node:assert/strict'
import {test} from 'node:test'
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import https from 'node:https'
import {startFixture} from '../release/test-support/in-app-update-server.mjs'
import {verifyMinisign} from '../release/update-readiness.mjs'
test('normal channel remains empty and both QA install entry points reject',async()=>{
 assert.deepEqual(JSON.parse(await readFile('release/update-channel.json','utf8')),{channel:'beta',endpoints:[],publicKey:null})
 const host=await readFile('apps/desktop/src-tauri/src/updates.rs','utf8'),vendor=await readFile('vendor/tauri-plugin-updater/src/updater.rs','utf8')
 assert.match(host,/#\[cfg\(feature = "ci-update-fixture"\)\][\s\S]*?pub async fn install_application_update\([\s\S]*?QA_DOWNLOAD_ONLY_INSTALL_BLOCKED[\s\S]*?#\[cfg\(not\(feature = "ci-update-fixture"\)\)\]/)
 assert.match(vendor,/#\[cfg\(feature = "milkup-ci-download-only"\)\][\s\S]*?pub fn install\([\s\S]*?QA_DOWNLOAD_ONLY_INSTALL_BLOCKED[\s\S]*?#\[cfg\(not\(feature = "milkup-ci-download-only"\)\)\]/)
 assert.match(await readFile('apps/desktop/src-tauri/Cargo.toml','utf8'),/ci-update-fixture = \["dep:reqwest", "tauri-plugin-updater\/milkup-ci-download-only"\]/)
 assert.match(host,/validate_download\(&update.download_url\)/)
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
