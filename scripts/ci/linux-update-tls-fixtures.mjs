// Produce public certificates only. Private keys stay in memory and pipe stdin.
import assert from 'node:assert/strict'
import {generateKeyPairSync} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import path from 'node:path'
import https from 'node:https'
import {startFixture} from '../release/test-support/in-app-update-server.mjs'
const root=path.resolve(process.argv[2]);await mkdir(root,{recursive:true})
const server=await startFixture({artifact:Buffer.from('inert TLS contract, not deb'),directory:root,openssl:'/usr/bin/openssl',maxMs:10000})
try{
 const wrong=await new Promise((resolve,reject)=>https.get(server.base+'/manifest.json',{ca:server.cert},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve(Buffer.concat(chunks)))}).on('error',reject))
 await writeFile(path.join(root,'wrong-manifest.json'),wrong)
 await writeFile(path.join(root,'inert-package.bin'),Buffer.from('inert TLS contract, not deb'))
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048})
 const old=execFileSync('/bin/sh',['-c','cat | "$@"','certificate','/usr/bin/openssl','req','-new','-x509','-key','/dev/stdin','-outform','PEM','-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-addext','basicConstraints=critical,CA:TRUE'],{input:privateKey.export({type:'pkcs8',format:'pem'}),timeout:10000,stdio:['pipe','pipe','pipe']})
 assert(!server.cert.includes('PRIVATE KEY'))
 await writeFile(path.join(root,'legacy-ca.pem'),old)
 await writeFile(path.join(root,'actual-fixture.pem'),server.cert)
}finally{await server.stop()}
