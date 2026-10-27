from pathlib import Path
from playwright.sync_api import sync_playwright
import json,os
ROOT=Path(__file__).resolve().parents[1];out=ROOT/'docs/benevento/trajan-relief-candidate';out.mkdir(exist_ok=True)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=b.new_page(viewport={'width':780,'height':844});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
 page.goto(os.environ.get('RELIEF_AUDIT_URL','http://localhost:5416')+'/tools/trajan-relief-audit.html');page.wait_for_function('window.ready',timeout=120000)
 report={}
 for view,light in [('front','left'),('oblique','left'),('oblique','right')]:
  for kind in ['control','flat','depth','low']:
   name=f'{kind}-{view}-{light}';report[name]=page.evaluate('(a)=>window.render(...a)',[kind,view,light]);page.screenshot(path=str(out/(name+'.png')));print(name,flush=True)
 report['errors']=errors;report['valid']=not errors;(out/'render-check.json').write_text(json.dumps(report,indent=2));b.close()
 if errors:raise RuntimeError(errors)
