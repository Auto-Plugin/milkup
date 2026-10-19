import assert from 'node:assert/strict';
import {readFile,realpath,readdir,lstat,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root='/tmp/milkup-p6-management-external-03';
const {build}=await import(join(root,'node_modules/esbuild/lib/main.js'));
const result=await build({absWorkingDir:root,entryPoints:['src/plugin.ts'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/plugin.js',write:false,metafile:true});
assert.equal(result.outputFiles.length,1);
assert.deepEqual(Buffer.from(result.outputFiles[0].contents),await readFile(join(root,'dist/plugin.js')));
let symlinks=0;
async function walk(path){for(const item of await readdir(path)){const file=join(path,item),stat=await lstat(file);if(stat.isSymbolicLink()){assert.ok((await realpath(file)).startsWith(root+'/node_modules/'),file);symlinks++;}else if(stat.isDirectory())await walk(file);}}
await walk(join(root,'node_modules'));
const proof={trustedRebuild:'byte-identical',entrySha256:createHash('sha256').update(result.outputFiles[0].contents).digest('hex'),dependencySymlinks:symlinks,allDependencySymlinksWithinExternalDirectory:true};
await writeFile(join(root,'independent-proof.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify(proof));
