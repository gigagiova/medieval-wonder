#!/usr/bin/env python3
"""Validate the photographic arch at the established full-world gate camera."""
import argparse,fcntl,json,time
from pathlib import Path
from urllib.parse import urlencode
from playwright.sync_api import sync_playwright,TimeoutError
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:5400');p.add_argument('--before',required=True);p.add_argument('--out',required=True);a=p.parse_args()
out=Path(a.out);out.mkdir(parents=True,exist_ok=True);start=time.monotonic();log=open(out/'progress.jsonl','w')
lock=open('/tmp/medieval-wonder-world-capture.lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
def emit(kind,**kw):
 line=json.dumps(dict(elapsed=round(time.monotonic()-start,2),kind=kind,**kw));print(line,flush=True);log.write(line+'\n');log.flush()
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=9227'])
 page=b.new_page(viewport={'width':390,'height':844},device_scale_factor=1);errors=[];rows=[]
 # Use the existing CSS fallback fonts in this offline capture. Suppress only
 # those optional external stylesheets and the absent favicon; application,
 # texture and shader errors still fail the audit.
 page.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(status=200,content_type='text/css',body=''))
 page.route('**/favicon.ico',lambda r:r.fulfill(status=204,body=''))
 page.on('pageerror',lambda e:(errors.append(str(e)),emit('pageerror',message=str(e))))
 page.on('console',lambda e:(errors.append(e.text),emit('console',level=e.type,message=e.text[:1000])) if e.type=='error' or 'texture failed' in e.text else None)
 page.on('requestfailed',lambda r:emit('requestfailed',url=r.url,reason=r.failure))
 try:
  for i,name in enumerate(['aurea30']):
   old=json.loads((Path(a.before)/(name+'.json')).read_text());pos=old['camera'];rot=old['rotation'];target=dict(name=name,x=pos[0],y=pos[1],z=pos[2],yaw=rot[1],pitch=rot[0],position=pos)
   if i==0:
    url=a.base+'/?'+urlencode(dict(shot=','.join(map(str,pos+[rot[1],rot[0]])),debug=''));emit('navigate',url=url);page.goto(url,wait_until='domcontentloaded',timeout=120000)
    deadline=time.monotonic()+900
    while True:
     try:page.wait_for_function('window.__ready===true',timeout=15000);break
     except TimeoutError:
      emit('loading',state=page.evaluate('({stage:document.querySelector("#overlay .enter")?.textContent,ready:window.__ready,stats:window.__stats?.()})'))
      if time.monotonic()>deadline:raise RuntimeError('World load deadline')
    page.evaluate('()=>__step()');page.wait_for_function('window.__done===true',timeout=120000)
   emit('match-camera',name=name,target=target)
   page.evaluate('''t=>{if(window.__originalCopy)__camera.position.copy=__originalCopy;__teleport(t);__setPitch(t.pitch);window.__originalCopy=__camera.position.copy;__camera.position.copy=function(){return this.set(...t.position)};__camera.position.set(...t.position);__done=false;__captureError=null;const pos=new __THREE.Vector3(...t.position);__stream.update(pos);const pump=setInterval(()=>__stream.update(pos),100);const timer=setTimeout(()=>{clearInterval(pump);__captureError='Streaming deadline90s'},90000);__stream.ready(t.x,t.z,36).then(()=>{clearInterval(pump);clearTimeout(timer);__resume(3)});}''',target)
   page.wait_for_function('window.__done===true||window.__captureError',timeout=180000)
   data=page.evaluate('''()=>({camera:__camera.position.toArray(),rotation:__camera.rotation.toArray(),stats:__stats(),render:__renderer.info.render,memory:__renderer.info.memory,captureError:window.__captureError,cull:__cullStats,relief:(()=>{const m=__scene.getObjectByName('Arch of Trajan photographic reliefs');return{compressed:m.material.map.isCompressedTexture,width:m.material.map.image.width,lod:m.parent.getCurrentLevel(),triangles:m.geometry.index.count/3}})()})''')
   assert not data.get('captureError'),data
   assert data['relief']['compressed'] and data['relief']['width']==1024,data['relief']
   assert data['render']['triangles']<=350000 and data['render']['calls']<=130,data['render']
   assert data['camera']==pos and data['rotation']==rot,(data,target)
   emit('screenshot-start',name=name,**data);page.screenshot(path=str(out/(name+'.png')),timeout=120000);emit('screenshot-done',name=name)
   # NPC assets can finish loading while SwiftShader produces the screenshot.
   # Preserve both samples rather than presenting the pre-capture count as its HUD.
   data['afterCapture']=page.evaluate('()=>({stats:__stats(),render:{...__renderer.info.render},memory:{...__renderer.info.memory}})')
   assert data['afterCapture']['render']['triangles']<=350000 and data['afterCapture']['render']['calls']<=130,data['afterCapture']
   data.update(name=name,errors=errors);rows.append(data);(out/'report.json').write_text(json.dumps(rows,indent=2))
  assert not errors,errors
 finally:b.close();log.close()
