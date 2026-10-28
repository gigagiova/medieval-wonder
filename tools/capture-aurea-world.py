"""Full production Porta Aurea view and phone rendering budget."""
import argparse,fcntl,json,time
from pathlib import Path
from playwright.sync_api import sync_playwright,TimeoutError
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:5484');p.add_argument('--out',type=Path,default=Path('docs/benevento/aurea-alignment/world'));a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
lock=open('/tmp/medieval-wonder-world-capture.lock','w');fcntl.flock(lock,fcntl.LOCK_EX)
with sync_playwright() as pw:
 b=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
 page=b.new_page(viewport={'width':390,'height':844},device_scale_factor=1);errors=[];rows=[]
 page.route('https://fonts.googleapis.com/**',lambda r:r.fulfill(status=200,content_type='text/css',body=''));page.route('**/favicon.ico',lambda r:r.fulfill(status=204,body=''))
 page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
 try:
  page.goto(a.base+'/?debug&shot=-30,40,5,0,0',wait_until='domcontentloaded',timeout=120000)
  deadline=time.monotonic()+900
  while True:
   try:page.wait_for_function('window.__ready===true',timeout=15000);break
   except TimeoutError:
    print(page.evaluate('document.querySelector("#overlay .enter")?.textContent'),flush=True)
    if time.monotonic()>deadline:raise RuntimeError('World readiness timeout')
  page.evaluate('__step()');page.wait_for_function('window.__done===true',timeout=120000)
  for name in ['Porta Aurea']:
   target=page.evaluate('n=>__teleports().find(t=>t.name===n)',name);assert target,name
   target['pitch']=-.05 if name!='Sepulcra Sancti Petri' else -.25
   page.evaluate('''t=>{if(window.savedCopy)__camera.position.copy=window.savedCopy;__teleport(t);__setPitch(t.pitch);const p=[t.x,t.y,t.z];__camera.position.set(...p);window.savedCopy=__camera.position.copy;__camera.position.copy=function(){return this.set(...p)};window.__done=false;window.captureError=null;const v=new __THREE.Vector3(...p);__stream.update(v);const pump=setInterval(()=>__stream.update(v),100);const deadline=setTimeout(()=>{clearInterval(pump);captureError='Streamtimeout'},90000);__stream.ready(t.x,t.z,36).then(()=>{clearInterval(pump);clearTimeout(deadline);__resume(4)});}''',target)
   page.wait_for_function('window.__done===true||window.captureError',timeout=180000)
   data=page.evaluate('()=>({camera:__camera.position.toArray(),rotation:__camera.rotation.toArray(),render:{...__renderer.info.render},stats:__stats(),error:window.captureError})');assert not data['error'],data
   filename=name.lower().replace(' ','-');page.screenshot(path=str(a.out/(filename+'.png')),timeout=120000)
   data['afterCapture']=page.evaluate('()=>({...__renderer.info.render})');data.update(name=name,errors=list(errors));rows.append(data);(a.out/'report.json').write_text(json.dumps(rows,indent=2));print(json.dumps(data),flush=True)
   assert data['afterCapture']['triangles']<=350000 and data['afterCapture']['calls']<=130,data
  assert not errors,errors
 finally:b.close()
