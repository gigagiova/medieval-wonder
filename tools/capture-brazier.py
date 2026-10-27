from pathlib import Path
import json,subprocess
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1];out=root/'docs/brazier-validation';out.mkdir(exist_ok=True)
# Reference code/materials frozen at the last published control update.
for source,name in [('src/lights.ts','lights-brazier-before.ts'),('src/shaders.ts','shaders-brazier-before.ts')]:
 s=subprocess.check_output(['git','show',f'08079e6:{source}'],text=True,cwd=root).replace("from './builder'","from '../../src/builder'")
 (root/'tools/.cache'/name).write_text(s)
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']);page=b.new_page(viewport={'width':780,'height':780});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
 page.goto('http://127.0.0.1:5423/tools/brazier-audit.html');page.wait_for_function('window.ready',timeout=120000)
 report={}
 for view in ['full','side','top']:
  for fire in [False,True] if view=='side' else [False]:
   for old in [True,False]:
    name=('before' if old else 'after')+'-'+view+('-fire' if fire else '')
    report[name]=page.evaluate('v=>render(...v)',[old,view,fire]);page.screenshot(path=str(out/(name+'.png')));print(name,report[name],flush=True)
 for i in range(16):
  page.evaluate('t=>render(false,"side",true,t)',2.4+i/12)
  page.screenshot(path=str(out/f'flow-{i:02d}.png'))
 report['charcoalTextures']=page.evaluate('charcoalTextures');report['valid']=not errors
 report['errors']=errors;(out/'render-check.json').write_text(json.dumps(report,indent=2));b.close();assert not errors,errors
