from pathlib import Path
from playwright.sync_api import sync_playwright
import json,fcntl
out=Path('/workspace/npc-audit/missing-sites/churches');out.mkdir(parents=True,exist_ok=True)
with open('/tmp/medieval-wonder-world-capture.lock','w')as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 with sync_playwright()as p:
  b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']);page=b.new_page(viewport={'width':780,'height':844});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.add_init_script("window.addEventListener('error',e=>window.auditError=e.message);window.addEventListener('unhandledrejection',e=>window.auditError=String(e.reason));")
  page.goto('http://127.0.0.1:5461/tools/churches-audit.html');page.wait_for_function('window.ready||window.auditError',timeout=120000)
  assert not page.evaluate('window.auditError'),page.evaluate('window.auditError')
  report={'scope':'Isolated production chapel geometry and colliders, fixed studio illumination and neutral context ground; not whole-city budget','views':{}}
  for site in ['pietro','modesto']:
   for mode,view in [('before','outside'),('after','outside'),('after','inside')]:
    k=site+'-'+mode+'-'+view;report['views'][k]=page.evaluate('([id,m,v])=>window.render(id,m,v)',[site,mode,view]);page.screenshot(path=str(out/(k+'.png')))
  report['paths']=page.evaluate('window.paths()');report['errors']=errors;(out/'report.json').write_text(json.dumps(report,indent=2));b.close();print(json.dumps(report,indent=2));assert not errors;assert not any(p['hits']for p in report['paths'])
