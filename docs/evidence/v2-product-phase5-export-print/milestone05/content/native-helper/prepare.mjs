import {renderStaticMarkdownDocument} from './static-serializer.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const fixtures='/workspace/milkup/tests/fixtures/p5-output/acceptance/';
const manifest=JSON.parse(await readFile(fixtures+'oversized-cases.json','utf8'));
let header='';const bodies=[],cases=[];
for(const c of manifest.cases){const source=await readFile(fixtures+c.sourceFile,'utf8'),sha=createHash('sha256').update(source).digest('hex');if(sha!==c.sourceSHA256)throw Error('fixture changed');
 const result=renderStaticMarkdownDocument(source,{documentId:'oversized',version:0,pageSize:manifest.pageSize,landscape:manifest.landscape,title:'Oversized first unit acceptance'});if(result.warnings.length)throw Error(JSON.stringify(result.warnings));
 const parts=result.html.split('<body>');header=parts[0]+'<body>';const body=parts[1].split('</body>')[0];bodies.push(`<section style="page-break-before:always;break-before:page"><div style="height:${c.height}px">FIXTURE-FILLER-${c.id}</div>${body}</section>`);cases.push({id:c.id,sourceSHA256:sha,ordinaryStaticRendererUsed:true,sourceUtf16:source.length});}
const html=header+bodies.join('')+'</body></html>';await writeFile(new URL('./oversized.html',import.meta.url),html);
await writeFile(new URL('./construction.json',import.meta.url),JSON.stringify({scope:'Actual current static converter; only exterior page-boundary positioning/filler added. No code/text/table rewriting.',manifest:fixtures+'oversized-cases.json',htmlSHA256:createHash('sha256').update(html).digest('hex'),serializerSourceSHA256:createHash('sha256').update(await readFile('/workspace/milkup/packages/export/src/static-html.ts')).digest('hex'),cases},null,2)+'\n');
