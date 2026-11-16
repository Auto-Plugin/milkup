"""Use the exact installed output helper/guard for every combined fixture."""
import hashlib,importlib.util,json,pathlib,shutil,subprocess,sys,time
HERE=pathlib.Path(__file__).resolve().parent
LINKS=HERE.parent/'linux-pdf-links-20261114';UNICODE=HERE.parent/'linux-pdf-unicode-20261114'
sys.path[:0]=[str(HERE),str(UNICODE),str(LINKS)]
import pdf_links,paint_contract,digit_pdf_contract,paper_render
_digit_fixtures=digit_pdf_contract.fixtures
spec=importlib.util.spec_from_file_location('combined_contract',HERE/'contract.py');contract=importlib.util.module_from_spec(spec);spec.loader.exec_module(contract)

def local_digit_fixtures(root):
 receipt=_digit_fixtures(root)
 import re
 for name in ['digit-baseline','digit-candidate']:
  p=root/(name+'.html');s=p.read_text()
  s,n=re.subn(r'@font-face \{font-family:DigitCollision;src:url\(data:font/ttf;base64,[A-Za-z0-9+/=]+\)\}\n','',s);assert n==1
  assert s.count('font-family:DigitCollision')==1
  s=s.replace('font-family:DigitCollision',"font-family:'MilkupDigitCollisionResearch'");p.write_text(s)
 receipt.update(originalEmbeddedHtmlSha256=receipt['htmlSha256'],htmlSha256=hashlib.sha256(s.encode()).hexdigest(),fontDelivery='Owned XDG user font, not web font; original font-src none remains')
 (root/'local-font-adaptation.json').write_text(json.dumps(receipt,indent=2)+'\n');return receipt

def prepare_owned_font(root,env):
 assert not env.get('FONTCONFIG_FILE')and not env.get('FONTCONFIG_PATH')
 folder=pathlib.Path(env['XDG_DATA_HOME'])/'fonts';folder.mkdir(mode=0o700,exist_ok=False)
 source=root/'digit-collision.ttf';target=folder/source.name;shutil.copyfile(source,target);target.chmod(0o600)
 subprocess.run(['fc-cache','-f',str(folder)],env=env,check=True,timeout=30,capture_output=True)
 matched=subprocess.check_output(['fc-match','--format','%{file}\n','MilkupDigitCollisionResearch'],env=env,text=True,timeout=10).strip()
 assert pathlib.Path(matched).resolve()==target.resolve(),'Exact owned collision font required; no fallback'
 assert target.read_bytes()==source.read_bytes()
 return {'path':str(target),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'fcMatch':matched,'scope':'Only this run XDG data/cache; no system font or CSP change'}

def run(out,binary,guard,env,validate,persist):
 root=out/'combined-fidelity';root.mkdir(exist_ok=False)
 pdf_links.fixtures(root);paint_contract.fixtures(root);font_fixture=local_digit_fixtures(root)
 # Only adds an explicit identity gate title to our synthetic text fixtures.
 for name in ['links','no-links']:
  p=root/(name+'.html');s=p.read_text();assert '<title>'not in s
  p.write_text(s.replace('<meta charset="utf-8">','<meta charset="utf-8"><title>MILKUP_COMBINED_TEXT</title>',1))
 report={'status':'running','runs':[],'fontFixture':font_fixture,'ownedFont':prepare_owned_font(root,env),'scope':'Same installed helper/guard and exact private runtime; no historical-pass inheritance'}
 def save():(root/'combined-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');persist(report)
 start=time.monotonic();save()
 for name in contract.NAMES:
  assert time.monotonic()-start<420,'Combined native batch limit'
  e=env.copy();e.update(MILKUP_COMBINED_PROBE='1',MILKUP_PRINT_LAYOUT_PROBE='1',MILKUP_PAINT_PROBE='1',MILKUP_PAINT_DEDUP='1',MILKUP_DIGIT_PROBE='1')
  e.pop('MILKUP_DIGIT_NOMINAL_ONLY',None)
  if name=='digit-baseline':e['MILKUP_DIGIT_NOMINAL_ONLY']='1'
  dest=root/name;html=(root/(name+'.html')).read_text()
  native=paper_render.render(binary,guard,html,dest,e,{'name':name,'pageSize':'a4','orientation':'portrait'})
  # Identity/cleanup failure is fatal; it cannot be collected as a content pass.
  validate(native,dest)
  row={'case':name,'identityPassed':True,'native':native};report['runs'].append(row)
  shutil.copyfile(dest/(name+'.pdf'),root/(name+'.pdf'));shutil.copyfile(dest/'native.log',root/(name+'.log'))
  try:
   import fitz
   with fitz.open(root/(name+'.pdf'))as pdf:row['pageBoundary']=contract.pages((root/(name+'.log')).read_text(),len(pdf))
  except Exception as error:row['error']=repr(error)
  save()
 # Same source/font/cluster contract with an explicitly different font delivery
 # permitted by the unchanged product CSP. Regenerate and byte-check this form.
 digit_pdf_contract.fixtures=local_digit_fixtures
 try:result=digit_pdf_contract.run(root)
 finally:digit_pdf_contract.fixtures=_digit_fixtures
 # The existing independent source audit records equality; make it mandatory
 # here rather than silently relying only on the positive URI target set.
 if result.get('status')=='passed':
  try:
   assert result['sourceText']['textIdenticalBetweenControls']
   assert result['sourceText']['wordBoxesIdenticalBetweenControls']
  except Exception as error:result['errors'].append('linked/no-link source equality: '+repr(error));result['status']='failed'
 report.update(status='passed'if contract.complete(report['runs'],result)else'failed',contracts=result,seconds=round(time.monotonic()-start,3))
 save();return report

def original_controls(out,report):
 for row in report['rootMarginControls']:
  dest=out/('root-control-'+row['case'])
  try:
   audit=json.loads((dest/'pagination-audit.json').read_text())
   mappings=audit['papers'][0]['mappingDiagnostics'];assert len(mappings)==3 and all(r['exact']for r in mappings)
   sample=pdf_links.inspect(dest/'a4-portrait.pdf')
   assert any(r['uri']=='https://example.invalid/pagination'for r in sample['links'])
   row['combinedFidelity']=True
  except Exception as error:row.update(combinedFidelity=False,combinedFidelityError=repr(error))
