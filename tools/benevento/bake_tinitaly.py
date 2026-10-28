"""Bake the attributed INGV 10m crop onto the game's geographic frame.
Requires numpy, scipy, rasterio and pyproj. Existing river levels/channel shape
are reconstruction constraints; original terrain provides boundary continuity.
"""
import argparse,base64,json,math,os
from pathlib import Path
os.environ.setdefault('MPLCONFIGDIR','/tmp/medieval-wonder-matplotlib')
import numpy as np,rasterio
from pyproj import Transformer
from scipy.ndimage import map_coordinates
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
p=argparse.ArgumentParser();p.add_argument('--apply',action='store_true');args=p.parse_args()
root=Path(__file__).resolve().parents[2];out=root/'docs/benevento/terrain-audit';gp=root/'src/benevento/geo.json'
g=json.loads(gp.read_text());t=json.loads((out/'before-terrain.json').read_text())
old=np.frombuffer(base64.b64decode(t['dm']),dtype='<i2').reshape(t['nz'],t['nx'])/10
xs=t['x0']+np.arange(t['nx'])*t['step'];zs=t['z0']+np.arange(t['nz'])*t['step'];X,Z=np.meshgrid(xs,zs)
lon=14.7745+X/(111320*math.cos(math.radians(41.1305)));lat=41.1305-Z/110574
with rasterio.open(out/'tinitaly/benevento.tif')as dataset:
 assert dataset.crs.to_epsg()==32632 and dataset.res==(10.,10.)
 transform=Transformer.from_crs(4326,dataset.crs,always_xy=True);E,N=transform.transform(lon,lat);c,r=(~dataset.transform)*(E,N)
 assert r.min()>.5 and c.min()>.5 and r.max()<dataset.height-.5 and c.max()<dataset.width-.5
 a=dataset.read(1);assert np.isfinite(a).all() and (a!=dataset.nodata).all()
 raw=map_coordinates(a,[r-.5,c-.5],order=1).astype(float)
height=raw.ravel().copy();points=np.stack([X.ravel(),Z.ravel()],1)
# Retain intentional channels/levels and walkable banks from the prior baker.
for river in g['rivers']:
 q=np.array(river['pts']);levels=np.array(river['level']);hw=river['w']/2
 best=np.full(len(points),np.inf);water=np.zeros(len(points))
 for k in range(len(q)-1):
  a,b=q[k:k+2];ab=b-a;u=np.clip(((points-a)@ab)/(ab@ab),0,1);d=np.linalg.norm(points-(a+u[:,None]*ab),axis=1);m=d<best;best[m]=d[m];water[m]=levels[k]+(levels[k+1]-levels[k])*u[m]
 inside=best<hw;height[inside]=np.minimum(height[inside],water[inside]-.3-2.6*(1-(best[inside]/hw)**2))
 ring=(best>=hw)&(best<hw+26);s=(best[ring]-hw)/26;s=s*s*(3-2*s);low=water[ring]+.25;height[ring]=low+(np.maximum(height[ring],low+.6)-low)*s
 near=(best>=hw+26)&(best<hw+120);height[near]=np.maximum(height[near],water[near]+.9)
height=height.reshape(X.shape)
# Match the existing regional extension at the crop edge, without a cliff.
edge=np.minimum.reduce([X-xs[0],xs[-1]-X,Z-zs[0],zs[-1]-Z]);w=np.clip(edge/60,0,1);w=w*w*(3-2*w);height=old+(height-old)*w
assert np.isfinite(height).all() and height.min()>0 and height.max()<500
encoded=np.round(height*10).astype('<i2');terrain={**t,'dm':base64.b64encode(encoded.tobytes()).decode()}
(out/'tinitaly/candidate-terrain.json').write_text(json.dumps(terrain,separators=(',',':'))+'\n')
report={'source':'TINITALY 1.1, INGV (2023)','doi':'https://doi.org/10.13127/tinitaly/1.1','license':'CC BY 4.0','sourceCrs':'EPSG:32632','sourceCellSizeM':10,'gridUnchanged':True,'heightRangeM':[float(height.min()),float(height.max())],'meanChangeM':float((height-old).mean()),'maxAbsoluteChangeM':float(np.abs(height-old).max()),'boundaryMaxChangeM':float(np.abs((height-old)[edge==0]).max()),'riverLevelsChanged':False,'notes':'Reprojected bare-ground elevation; channel constraints and 60m boundary blend are authored adaptations. Modern terrain is not a survey of AD700 surfaces.'}
(out/'tinitaly/bake-report.json').write_text(json.dumps(report,indent=2)+'\n')
fig,ax=plt.subplots(1,3,figsize=(15,5),layout='constrained');extent=[xs[0],xs[-1],zs[-1],zs[0]]
for axis,title,data in zip(ax,['Before: smoothed EU-DEM','After: TINITALY + retained channels','Elevation change (m)'],[old,height,height-old]):
 im=axis.imshow(data,extent=extent,cmap='RdBu_r'if axis is ax[2]else'terrain',vmin=-30 if axis is ax[2]else 105,vmax=30 if axis is ax[2]else 210)
 axis.set(title=title,xlabel='East (m)',ylabel='South (m)');fig.colorbar(im,ax=axis,shrink=.7)
fig.savefig(out/'tinitaly/before-after.png',dpi=150);plt.close(fig)
if args.apply:g['terrain']=terrain;gp.write_text(json.dumps(g,separators=(',',':'))+'\n')
print(json.dumps(report,indent=2))
