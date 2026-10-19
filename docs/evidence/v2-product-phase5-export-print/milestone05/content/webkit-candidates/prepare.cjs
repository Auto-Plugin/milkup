const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const {JSDOM}=createRequire('/workspace/milkup/packages/view-dom/package.json')('jsdom');
const root=__dirname, old='/workspace/milkup-export-print-evidence/milestone01/native/heading-block-final';
const baseline=fs.readFileSync(path.join(old,'final-converter.html'),'utf8');
fs.writeFileSync(path.join(root,'baseline.html'),baseline);
fs.copyFileSync(path.join(old,'cases.json'),path.join(root,'cases.json'));
const css=`@media print{.heading-lead{break-inside:auto;page-break-inside:auto}.heading-lead>h1,.heading-lead>h2,.heading-lead>h3,.heading-lead>h4,.heading-lead>h5,.heading-lead>h6{break-after:avoid;page-break-after:avoid;break-inside:avoid;page-break-inside:avoid}.heading-lead>table,.heading-lead>pre,.heading-lead>ul,.heading-lead>ol{break-before:avoid;page-break-before:avoid}thead{break-before:avoid;page-break-before:avoid;break-after:avoid;page-break-after:avoid;break-inside:avoid;page-break-inside:avoid}tbody{break-before:avoid;page-break-before:avoid}tbody>tr:first-child,ul>li:first-child,ol>li:first-child{break-before:avoid;page-break-before:avoid}}`;
const summaries=[];
for(const variant of ['chain','caption-chain','split-first']){
 const doc=new JSDOM(baseline).window.document;const changes=[];
 const before=doc.body.textContent;
 const style=doc.createElement('style');style.textContent=css;doc.head.append(style);
 if(variant==='caption-chain'){
  for(const group of doc.querySelectorAll('.heading-lead')){const heading=group.firstElementChild,next=heading?.nextElementSibling;if(next?.tagName!=='TABLE')continue;const caption=doc.createElement('caption');caption.className='export-heading-caption';next.prepend(caption);caption.append(heading);changes.push({heading:heading.textContent,type:'table',tableRows:next.rows.length});}
  style.textContent+='@media print{caption.export-heading-caption{text-align:left;break-inside:avoid;page-break-inside:avoid;break-after:avoid;page-break-after:avoid}}';
 }
 if(variant==='split-first'){
  for(const group of doc.querySelectorAll('.heading-lead')){const heading=group.firstElementChild,next=heading?.nextElementSibling;if(!next)continue;
   if(next.tagName==='PRE'){
    const code=next.querySelector('code'),text=code?.textContent;if(!code||!text||!text.includes('\n'))continue;const split=text.indexOf('\n')+1,remainder=next.cloneNode(true);code.textContent=text.slice(0,split);remainder.querySelector('code').textContent=text.slice(split);next.classList.add('code-first');remainder.classList.add('code-rest');group.after(remainder);group.classList.add('bounded-first');changes.push({heading:heading.textContent,type:'code',originalText:text,rejoinedText:code.textContent+remainder.querySelector('code').textContent});
   }else if(['UL','OL'].includes(next.tagName)&&next.children.length>1){
    const remainder=next.cloneNode(false),items=[...next.children];for(const item of items.slice(1))remainder.append(item);if(next.tagName==='OL')remainder.setAttribute('start',String(Number(next.getAttribute('start')||1)+1));next.classList.add('list-first');remainder.classList.add('list-rest');group.after(remainder);group.classList.add('bounded-first');changes.push({heading:heading.textContent,type:'list',count:items.length,retainedCount:next.children.length+remainder.children.length});
   }
  }
  style.textContent+='@media print{.heading-lead.bounded-first{break-inside:avoid;page-break-inside:avoid}.code-first{margin-bottom:0;padding-bottom:0}.code-rest{margin-top:0;padding-top:0}.list-first{margin-bottom:0}.list-rest{margin-top:0}}';
 }
 summaries.push({variant,textContentUnchanged:before===doc.body.textContent,changes});fs.writeFileSync(path.join(root,variant+'.html'),doc.documentElement.outerHTML);
}
fs.writeFileSync(path.join(root,'candidate-construction.json'),JSON.stringify({scope:'Evidence-only fixed DOM/CSS candidates; no product modifications. split-first changes code/list container structure and is not accepted without semantics/copy/screen review.',summaries},null,2)+'\n');
for(const name of ['run-pair.py','with-display.py'])fs.copyFileSync(path.join(old,name),path.join(root,name));
let sh=fs.readFileSync(path.join(old,'run.sh'),'utf8').replaceAll(old,root).replaceAll('/tmp/milkup-p5-heading-final','/tmp/milkup-p5-content-pagination');fs.writeFileSync(path.join(root,'run.sh'),sh);
