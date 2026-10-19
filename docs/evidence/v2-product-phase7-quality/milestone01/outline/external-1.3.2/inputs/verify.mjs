import assert from 'node:assert/strict'
import { readFile, realpath, readdir, lstat, mkdir, copyFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { build } from 'esbuild'
const root = await realpath('.'), evidence = '/workspace/milkup-p7-quality-evidence/milestone01/outline/external-1.3.2'
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
const manifest = JSON.parse(await readFile('plugin.json'))
assert.equal(manifest.version,'1.3.2')
assert.deepEqual(manifest.permissions,['document:read'])
const entry = await readFile('dist/plugin.js')
const archiveName = 'milkup.outline-1.3.2.milkup-plugin'
const bytes = await readFile('dist/'+archiveName), archive = JSON.parse(bytes)
assert.deepEqual(archive.manifest,manifest)
assert.equal(archive.files.length,1)
assert.equal(archive.files[0].content,entry.toString())
const rebuild = await build({absWorkingDir:root,entryPoints:['src/plugin.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',outfile:'dist/plugin.js',metafile:true})
assert(entry.equals(Buffer.from(rebuild.outputFiles[0].contents)))
assert(Object.values(rebuild.metafile.outputs).every(value=>value.imports.length===0))
const inputs=[]
for(const input of Object.keys(rebuild.metafile.inputs)) {
 const resolved=await realpath(input)
 assert(resolved.startsWith(root+'/src/')||resolved.includes(root+'/node_modules/.pnpm/@milkup+plugin-sdk@file+vendor+plugin-sdk-0.3.7.tgz/'))
 inputs.push({path:input,realPath:resolved,sha256:hash(await readFile(resolved))})
}
let links=0
async function walk(dir) {
 for(const name of await readdir(dir)) {
  const file=path.join(dir,name), stat=await lstat(file)
  if(stat.isSymbolicLink()){assert((await realpath(file)).startsWith(root+'/'));links++}
  else if(stat.isDirectory()) await walk(file)
 }
}
await walk(path.join(root,'node_modules'))
const sdkRoot=await realpath('node_modules/@milkup/plugin-sdk')
assert.equal(JSON.parse(await readFile(path.join(sdkRoot,'package.json'))).version,'0.3.7')
const sdkTar='vendor/plugin-sdk-0.3.7.tgz'
const tarFiles=execFileSync('tar',['-tzf',sdkTar],{encoding:'utf8'}).trim().split('\n').filter(name=>!name.endsWith('/'))
for(const name of tarFiles){assert(name.startsWith('package/'));assert((await readFile(path.join(sdkRoot,name.slice(8)))).equals(execFileSync('tar',['-xOzf',sdkTar,name])))}
const original=JSON.parse(await readFile(path.join(evidence,'copied-inputs.json')))
for(const item of original) if(item.path!=='package.json') assert.equal(hash(await readFile(item.path)),item.sha256)
await mkdir(path.join(evidence,'inputs'),{recursive:true})
for(const name of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','vitest.config.mjs','verify.mjs','plugin.json','vendor/plugin-sdk-0.3.7.tgz',...original.map(x=>x.path).filter(x=>x!=='package.json'&&x!=='plugin.json')]) {
 await mkdir(path.dirname(path.join(evidence,'inputs',name)),{recursive:true});await copyFile(name,path.join(evidence,'inputs',name))
}
for(const name of [archiveName,'plugin.js','build-meta.json'])await copyFile('dist/'+name,path.join(evidence,name))
const result={status:'passed',root,node:process.version,version:manifest.version,sdkVersion:'0.3.7',sdkSha256:hash(await readFile(sdkTar)),archiveSha256:hash(bytes),archiveBytes:bytes.length,entrySha256:hash(entry),dependencySymlinksWithinExternalRoot:links,inputs,runtimeImports:0,trustedRebuildMatches:true,copiedSourcesUnchanged:true,dependencyPolicy:'external-derived-lock; offline install and frozen follow-up, source devSDK0.2.0 preserved'}
await writeFile(path.join(evidence,'verification.json'),JSON.stringify(result,null,2)+'\n')
console.log(JSON.stringify(result,null,2))
