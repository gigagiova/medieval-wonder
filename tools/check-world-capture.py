#!/usr/bin/env python3
"""Capture the full world with loading-stage diagnostics; one browser at a time."""
import argparse,json,time,fcntl
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright,TimeoutError as PlaywrightTimeout
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:5370');p.add_argument('--out',required=True);p.add_argument('--places',nargs='+',default=['Curtis','Episcopium']);p.add_argument('--cdp-port',type=int,default=9227);p.add_argument('--timeout',type=int,default=600);p.add_argument('--check-lore',action='store_true',help='Validate new lore cards on Vite source server');p.add_argument('--reuse',action='store_true',help='Reuse loaded world between places; preserves GPU programs');a=p.parse_args()
out=Path(a.out);out.mkdir(parents=True,exist_ok=True)
lock=open('/tmp/medieval-wonder-world-capture.lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
start=time.monotonic();log=open(out/'progress.jsonl','w')
def emit(kind,**data):
 row={'elapsed':round(time.monotonic()-start,2),'kind':kind,**data};line=json.dumps(row);print(line,flush=True);log.write(line+'\n');log.flush()
reports=[]
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader',f'--remote-debugging-port={a.cdp_port}','--remote-debugging-address=127.0.0.1'])
 page=None
 try:
  for place in a.places:
   fresh=page is None
   if fresh:page=browser.new_page(viewport={'width':390,'height':844},device_scale_factor=1)
   errors=[];pending={}
   if fresh:
    page.on('pageerror',lambda e:(errors.append(str(e)),emit('pageerror',message=str(e))))
    page.on('console',lambda e:emit('console',level=e.type,message=e.text[:1500]) if e.type in ['error','warning'] or e.text.startswith('WORLD_STAGE') else None)
    page.on('request',lambda r:pending.update({r.url:time.monotonic()}))
    page.on('requestfinished',lambda r:pending.pop(r.url,None))
    page.on('requestfailed',lambda r:(pending.pop(r.url,None),emit('requestfailed',url=r.url,reason=r.failure)))
    page.on('response',lambda r:(errors.append(str(r.status)+' '+r.url),emit('http-error',url=r.url,status=r.status)) if r.status>=400 else None)
    page.add_init_script("""document.addEventListener('DOMContentLoaded',()=>{const el=document.querySelector('#overlay .enter');if(el)new MutationObserver(()=>console.log('WORLD_STAGE '+el.textContent)).observe(el,{subtree:true,childList:true,characterData:true});});""")
   url=a.base+'/?'+urlencode({'shot':'0,2,0,0,0','at':place,'debug':''})
   if fresh:
    emit('navigate',place=place,url=url);page.goto(url,wait_until='domcontentloaded',timeout=120000)
   else:
    emit('teleport',place=place)
    page.evaluate("""async name=>{let t=window.__teleports().find(t=>t.name.toLowerCase()===name.toLowerCase())??window.__teleports().find(t=>t.name.toLowerCase().includes(name.toLowerCase()));if(!t){const inside=name.toLowerCase().endsWith(' interior');const baseName=inside?name.slice(0,-9):name;const e=window.__map().explorables.find(e=>e.name.toLowerCase()===baseName.toLowerCase());if(!e)throw Error('Teleport or explorable missing: '+name);const r=(await import('/src/benevento/readables.ts')).PLACED.find(r=>r.id===e.id);if(!r)throw Error('Readable missing: '+e.id);const x=inside?e.x+(r.pos.x-e.x)*.5:e.x,z=inside?e.z+(r.pos.z-e.z)*.5:e.z;t={name:e.name,x,z,y:window.__groundY(x,z)+2,yaw:Math.atan2(-(r.pos.x-x),-(r.pos.z-z))};}window.__teleport(t);window.__done=false;window.__captureError=null;// Current production R_IN=40; wait for the inner36m, as main.ts does.
const pos=new window.__THREE.Vector3(t.x,t.y,t.z);window.__stream.update(pos);const pump=setInterval(()=>window.__stream.update(pos),100);let expired=false;const timeout=setTimeout(()=>{expired=true;clearInterval(pump);window.__captureError='Streaming did not settle within90seconds';},90000);window.__stream.ready(t.x,t.z,36,f=>console.log('WORLD_STAGE Streaming '+name+' '+Math.round(f*100)+'%')).then(()=>{clearInterval(pump);clearTimeout(timeout);if(!expired)window.__resume(13);}).catch(e=>{clearInterval(pump);clearTimeout(timeout);window.__captureError=String(e);});}""",place)
   deadline=time.monotonic()+a.timeout
   done=False
   while time.monotonic()<deadline:
    try:
     page.wait_for_function('window.__done===true',timeout=15000);done=True;break
    except PlaywrightTimeout:
     state=page.evaluate("({stage:document.querySelector('#overlay .enter')?.textContent,ready:window.__ready,done:window.__done,stats:window.__stats?.(),title:document.title,stream:window.__stream?.stats,captureError:window.__captureError})")
     emit('loading',place=place,state=state,pending=[{'url':u,'seconds':round(time.monotonic()-t)} for u,t in pending.items()][:20])
     if errors or state.get('captureError'):break
   if not done:
    emit('failed',place=place,errors=errors);raise RuntimeError('World did not settle; see progress.jsonl')
   data=page.evaluate('({ready:window.__ready,stats:window.__stats(),render:window.__renderer.info.render,memory:window.__renderer.info.memory,camera:window.__camera.position.toArray(),teleports:window.__teleports?.()})')
   emit('settled',place=place,**{k:v for k,v in data.items() if k!='teleports'})
   emit('screenshot-start',place=place)
   page.screenshot(path=str(out/(place.replace('/','_')+'.png')),timeout=120000)
   emit('screenshot-done',place=place)
   row={'place':place,'errors':errors,**data};reports.append(row);(out/'report.json').write_text(json.dumps(reports,indent=2));
   if a.check_lore and place==a.places[-1]:
    for lore_id in ['synagoga','triggioBurials']:
     lore=page.evaluate("""async id=>{const {PLACED}=await import('/src/benevento/readables.ts');const {LORE}=await import('/src/benevento/lore.ts');const {updateSecrets}=await import('/src/benevento/secrets.ts');const p=PLACED.find(p=>p.id===id);if(!p)throw Error('Missing placed readable '+id);const c=window.__camera.clone();c.position.copy(p.pos).add(new window.__THREE.Vector3(0,.1,1));c.lookAt(p.pos);c.updateMatrixWorld(true);updateSecrets(c);const b=document.querySelector('#lorebtn');if(b.hidden)throw Error('Reading button unavailable '+id);b.click();const card=document.querySelector('#lorecard'),text=card.innerText,original=card.querySelector('[lang]');return {id,open:card.classList.contains('open'),text,lang:original.lang,dir:original.dir,statusElements:card.querySelectorAll('.status,.source').length,sourceExposed:text.includes(LORE[id].source),uncertaintyLabel:/invented|hypothes|reconstruction|attested/i.test(text)};}""",lore_id)
     assert lore['open'] and not lore['statusElements'] and not lore['sourceExposed'] and not lore['uncertaintyLabel'],lore
     if lore_id=='synagoga':assert lore['lang']=='he' and lore['dir']=='rtl',lore
     emit('lore-verified',**lore);(out/(lore_id+'-lore.json')).write_text(json.dumps(lore,indent=2,ensure_ascii=False))
     page.screenshot(path=str(out/(lore_id+'-lore.png')),timeout=120000)
     page.locator('#lorecard button').click()
   if not a.reuse:page.close();page=None
   if errors:raise RuntimeError(errors)
 finally:browser.close();log.close()
