"""Matched neutral-material audit of the real streamed curtain/gateway geometry.
Run after starting a fresh Vite server (no-HMR instances cache transforms).
"""
from pathlib import Path
import argparse,json,subprocess
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
BASELINE='9200a4ac1282c0d5fb23930b40e57c4adc970ff5'
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',default='http://localhost:5173');p.add_argument('--output',type=Path,default=ROOT/'docs/benevento/gate-validation');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
s=subprocess.check_output(['git','show',BASELINE+':src/benevento/fabric.ts'],cwd=ROOT,text=True).replace("from '../","from '../../src/").replace("from './","from '../../src/benevento/")
cache=ROOT/'tools/.cache/gates-before.ts';cache.parent.mkdir(parents=True,exist_ok=True);cache.write_text(s)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=b.new_page(viewport={'width':1000,'height':760});errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
 page.goto(a.url.rstrip('/')+'/tools/gates-audit.html',wait_until='domcontentloaded',timeout=120000);page.wait_for_function('window.ready',timeout=180000)
 report={'baseline':BASELINE,'scope':'Real wall/gate/terrain geometry with neutral material, same current arch model both modes; baseline arch rotation0 vs corrected ViaTraiana alignment. No NPCs, town buildings, production streaming or postprocess.','views':{}}
 for id in ['aurea','laurentii']:
  for old in [True,False]:
   for view in ['front','top']:
    key=f'{id}-{"before" if old else "after"}-{view}';report['views'][key]=page.evaluate('(a)=>render(...a)',[id,old,view]);page.screenshot(path=str(a.output/(key+'.png')));print(key,report['views'][key],flush=True)
 report['errors']=errors;(a.output/'render-check.json').write_text(json.dumps(report,indent=2)+'\n');b.close()
 if errors:raise SystemExit('Browser errors during gate audit')
