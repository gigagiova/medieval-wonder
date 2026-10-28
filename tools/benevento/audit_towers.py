"""Reproduce tower/plan registration from the attributed OSM snapshot; run at repo root."""
import sys,math,json,xml.etree.ElementTree as ET,numpy as np
sys.path.insert(0,'tools/benevento');from tps import world2px_fast
root=ET.parse('docs/benevento/towers/source.osm').getroot();nodes={e.attrib['id']:(float(e.attrib['lat']),float(e.attrib['lon']))for e in root.findall('node')};g=json.load(open('src/benevento/geo.json'));w=np.array(g['wall']);kx=111320*math.cos(math.radians(41.1305));out=[]
for e in root.findall('way'):
 tags={t.attrib['k']:t.attrib['v']for t in e.findall('tag')}
 if tags.get('tower:type')!='defensive':continue
 pts=[nodes[n.attrib['ref']]for n in e.findall('nd')];pts=pts[:-1]if pts[-1]==pts[0]else pts;p=np.array([[(lon-14.7745)*kx,(41.1305-lat)*110574]for lat,lon in pts]);c=p.mean(axis=0);px=world2px_fast([c])[0];dist=1e9
 for i,a in enumerate(w):
  b=w[(i+1)%len(w)];v=b-a;t=np.clip((c-a)@v/(v@v),0,1);q=a+t*v;d=np.linalg.norm(q-c)
  if d<dist:dist=d;nearest=q.tolist()
 row={'id':e.attrib['id'],'name':tags.get('name','Unnamed tower'),'world':c.tolist(),'planPx':px.tolist(),'footprint':p.tolist(),'wallDistance':float(dist),'wallPoint':nearest};out.append(row)
 print(row['id'],row['name'],np.round(c,1),np.round(px,1),round(dist,1))
json.dump(out,open('docs/benevento/towers/osm-inventory.json','w'),indent=2)
from PIL import Image,ImageDraw
im=Image.open('docs/benevento/urban-plan-reference.webp').convert('RGB');d=ImageDraw.Draw(im)
for i,r in enumerate(out):
 x,y=r['planPx'];d.ellipse((x-6,y-6,x+6,y+6),outline='red',width=2);d.text((x+7,y-12),str(i+1),fill='red')
im.save('docs/benevento/towers/osm-on-plan.png')
