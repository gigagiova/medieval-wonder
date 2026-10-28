"""Compare the stored wall trace with the supplied map through exact saved TPS.
No production geography or control points are changed.
"""
import json,sys
from pathlib import Path
import numpy as np
from scipy.optimize import root
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from PIL import Image
sys.path.insert(0,str(Path(__file__).parent))
from tps import px2world,world2px_fast
repo=Path(__file__).resolve().parents[2];out=repo/'docs/benevento/aurea-alignment';out.mkdir(parents=True,exist_ok=True)
reg=json.loads((repo/'tools/benevento/registration.json').read_text());raw=json.loads((repo/'src/benevento/geo.json').read_text());wall=np.array(raw['wall']);arch=np.array([389.,-224.]);rot=-np.arctan2(24,18)
def inv(points):
 results=[]
 for world,initial in zip(points,world2px_fast(points)):
  sol=root(lambda p:px2world([p])[0]-world,initial)
  assert sol.success and np.linalg.norm(px2world([sol.x])[0]-world)<1e-7
  results.append(sol.x)
 return np.array(results)
segments=[]
for i,a in enumerate(wall):
 b=wall[(i+1)%len(wall)];v=b-a;t=np.clip(np.dot(arch-a,v)/np.dot(v,v),0,1);p=a+t*v;segments.append((float(np.linalg.norm(arch-p)),i,p))
distance,nearest_i,nearest=min(segments,key=lambda q:q[0]);direction=np.array([-np.sin(rot),-np.cos(rot)]);cross=lambda a,b:a[0]*b[1]-a[1]*b[0]
returns=[]
for side in [-1,1]:
 pier=arch+side*6.1*np.array([np.cos(rot),-np.sin(rot)]);hits=[]
 for i,a in enumerate(wall):
  edge=wall[(i+1)%len(wall)]-a;c=cross(direction,edge)
  if abs(c)<1e-8:continue
  delta=a-pier;t=cross(delta,edge)/c;u=cross(delta,direction)/c
  if 0<t<60 and 0<=u<=1:hits.append((t,pier+t*direction))
 t,hit=min(hits,key=lambda q:q[0]);returns.append({'pier':pier.tolist(),'wallHit':hit.tolist(),'lengthM':float(t)})
control_errors=[float(np.linalg.norm(px2world([c['plan_px']])[0]-c['world_m']))for c in reg['controls']]
report={'archAnchorM':arch.tolist(),'archSourcePixel':inv([arch])[0].tolist(),'controlMaxErrorM':max(control_errors),'nearestRawWallPointM':nearest.tolist(),'rawWallDistanceM':distance,'rawWallNearestSegment':nearest_i,'localVertices':[{'index':i,'world':wall[i].tolist(),'sourcePixel':inv([wall[i]])[0].tolist()}for i in range(48,58)],'existingReturns':returns,'scope':'Stored exact TPS inverse; source annotation-contaminated outline, not a new historical survey'}
(out/'registration-report.json').write_text(json.dumps(report,indent=2)+'\n')
image=Image.open(repo/'docs/benevento/urban-plan-reference.webp');fig,(ax,worldax)=plt.subplots(1,2,figsize=(16,6),layout='constrained');ax.imshow(image);wp=inv(wall[48:58]);ax.plot(wp[:,0],wp[:,1],'-o',c='#dc322f',lw=2,ms=3,label='Generated wall (inverse TPS)')
for i,row in enumerate(returns):
 p=inv([row['pier'],row['wallHit']]);ax.plot(p[:,0],p[:,1],c='#e69f00',lw=3,label='Existing inward returns'if i==0 else None)
cp=reg['controls'][0];ax.scatter(*cp['plan_px'],c='#0072b2',s=90,marker='+',lw=2,label='Arch registration control');ax.annotate('arch control (923,185)',cp['plan_px'],xytext=(775,235),arrowprops={'arrowstyle':'->','color':'#0072b2'},color='#0072b2');ax.set_xlim(740,1090);ax.set_ylim(285,110);ax.set_title('Original supplied plan, with stored geometry overlaid');ax.legend(loc='lower left',fontsize=8)
worldax.plot(wall[48:58,0],wall[48:58,1],'-o',c='#dc322f',lw=2,ms=3,label='Generated wall');worldax.scatter(*arch,c='#0072b2',marker='+',s=120,lw=2,label='Standing arch anchor')
for i,row in enumerate(returns):
 p=np.array([row['pier'],row['wallHit']]);worldax.plot(p[:,0],p[:,1],c='#e69f00',lw=3,label='Existing inward returns'if i==0 else None)
worldax.plot([arch[0],nearest[0]],[arch[1],nearest[1]],'--',c='#0072b2');worldax.text(arch[0]-10,arch[1]+8,f'{distance:.2f} m mismatch',ha='center',color='#0072b2');worldax.set_xlim(300,500);worldax.set_ylim(-180,-285);worldax.set_aspect('equal');worldax.grid(alpha=.2);worldax.set_xlabel('World x (east), metres');worldax.set_ylabel('World z (south), metres');worldax.set_title('The built U-shaped connection is not a map feature');worldax.legend(fontsize=8)
fig.savefig(out/'registration-overlay.png',dpi=160);plt.close(fig);print(json.dumps(report,indent=2))
