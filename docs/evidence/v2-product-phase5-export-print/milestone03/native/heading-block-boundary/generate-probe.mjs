import { renderStaticMarkdownDocument } from './static-serializer.mjs';
import { writeFile } from 'node:fs/promises';
const cases=[];let head='';const bodies=[],wrapped=[];
for(const {height,short} of [{height:400,short:true},{height:450,short:true},{height:500,short:true},{height:550,short:true}])for(const type of ['table','code','list']){
 const id=type.toUpperCase()+'-'+height+(short?'-SHORT':'');const count=short?(type==='table'?2:3):(type==='table'?60:80);
 let markdown='## '+id+'-HEADING\n\n';
 if(type==='table')markdown+='| '+id+'-HEADER | Value |\n|---|---|\n'+Array.from({length:count},(_,i)=>'| '+id+'-ROW-'+String(i+1).padStart(3,'0')+' | 中文表格分页检查 |').join('\n');
 if(type==='code')markdown+='```text\n'+Array.from({length:count},(_,i)=>id+'-LINE-'+String(i+1).padStart(3,'0')+": const value = '中文代码';").join('\n')+'\n```';
 if(type==='list')markdown+=Array.from({length:count},(_,i)=>'- '+id+'-ITEM-'+String(i+1).padStart(3,'0')+' 中文列表内容分页检查。').join('\n');
 markdown+='\n\n'+id+'-END\n';
 const result=renderStaticMarkdownDocument(markdown,{documentId:'boundary',version:0,pageSize:'letter',landscape:true,title:'heading boundary'});if(result.warnings.length)throw Error(JSON.stringify(result.warnings));
 const [start,tail]=result.html.split('<body>');head=start+'<body>';bodies.push('<section style="page-break-before:always;break-before:page"><div style="height:'+height+'px">FIXTURE-FILLER-'+id+'</div>'+tail.split('</body>')[0]+'</section>');
 const tag=type==='table'?'table':type==='code'?'pre':'ul';const content=tail.split('</body>')[0];wrapped.push('<section style="page-break-before:always;break-before:page"><div style="height:'+height+'px">FIXTURE-FILLER-'+id+'</div><div class="heading-lead">'+content.replace('</'+tag+'>','</'+tag+'></div>')+'</section>');
 cases.push({id,type,height,short,count,source:markdown,firstMarker:id+(type==='table'?'-ROW-001':type==='code'?'-LINE-001':'-ITEM-001'),lastMarker:id+(type==='table'?'-ROW-':type==='code'?'-LINE-':'-ITEM-')+String(count).padStart(3,'0')});
}
await writeFile(new URL('./probe.html',import.meta.url),head+bodies.join('')+'</body></html>');await writeFile(new URL('./probe-wrapped.html',import.meta.url),head+wrapped.join('')+'</body></html>');await writeFile(new URL('./probe-cases.json',import.meta.url),JSON.stringify(cases,null,2)+'\n');
