from pathlib import Path
from playwright.sync_api import sync_playwright
import json,os,subprocess
ROOT=Path(__file__).resolve().parents[1];out=ROOT/'docs/benevento/trajan-relief-integration';out.mkdir(exist_ok=True)
source=subprocess.check_output(['git','show','48d8682:src/benevento/arcus-traiani.ts'],cwd=ROOT,text=True).replace("from '../","from '../../src/").replace("from './","from '../../src/benevento/").replace('export function arcusTraiani','export function arcusSculptureBefore')
cache=ROOT/'tools/.cache/arcus-sculpture-before.ts';cache.parent.mkdir(exist_ok=True);cache.write_text(source)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=b.new_page(viewport={'width':780,'height':844});errors=[]
 page.on('pageerror',lambda e:(errors.append(str(e)),print(e,flush=True)))
 page.on('console',lambda m:errors.append(m.text) if m.type=='error' or 'texture failed' in m.text else None)
 page.goto(os.environ.get('TRAJAN_AUDIT_URL','http://localhost:5417')+'/tools/arcus-relief-world-audit.html',wait_until='domcontentloaded',timeout=120000);page.wait_for_function('window.ready',timeout=120000)
 report={'baseline':'48d8682','scope':'Isolated full monument; production materials, shared neutral lighting; excludes town/walls'}
 for view in ['front','rear','quarter','passage']:
  for before in [True,False]:
   name=('before-' if before else 'after-')+view;report[name]=page.evaluate('(a)=>window.render(...a)',[before,view]);page.screenshot(path=str(out/(name+'.png')));print(name,report[name],flush=True)
 report['errors']=errors;report['valid']=not errors;(out/'render-check.json').write_text(json.dumps(report,indent=2));b.close()
 if errors:raise RuntimeError(errors)
