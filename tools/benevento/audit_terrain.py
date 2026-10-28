"""Compare the baked terrain against fresh, coordinate-matched EU-DEM samples.
The baked grid includes river carving; this is an audit, not a terrain replacement.
Run from any directory. Existing source responses are cached for reproducibility.
"""
import base64,json,math,os,urllib.request
from pathlib import Path
os.environ.setdefault('MPLCONFIGDIR','/tmp/medieval-wonder-matplotlib')
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from scipy.ndimage import map_coordinates
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'docs/benevento/terrain-audit';OUT.mkdir(parents=True,exist_ok=True)
LAT0,LON0=41.1305,14.7745
KX=111320*math.cos(math.radians(LAT0));KZ=110574
xs=np.linspace(-550,700,11);zs=np.linspace(-400,200,9)
X,Z=np.meshgrid(xs,zs);locations=[(LAT0-z/KZ,LON0+x/KX) for x,z in zip(X.ravel(),Z.ravel())]
url='https://api.opentopodata.org/v1/eudem25m?locations='+'|'.join(f'{lat:.7f},{lon:.7f}'for lat,lon in locations)
cache=OUT/'source-response.json'
if not cache.exists():
 response=json.load(urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'MedievalWonder terrain audit'}),timeout=30))
 if response.get('status')!='OK' or len(response.get('results',[]))!=len(locations):raise RuntimeError(response)
 cache.write_text(json.dumps(response,indent=2)+'\n')
response=json.loads(cache.read_text())
for expected,actual in zip(locations,response['results']):
 if actual['elevation'] is None:raise ValueError('Missing elevation')
 assert abs(expected[0]-actual['location']['lat'])<1e-6 and abs(expected[1]-actual['location']['lng'])<1e-6
source=np.array([r['elevation']for r in response['results']]).reshape(X.shape)
g=json.loads((ROOT/'src/benevento/geo.json').read_text());t=g['terrain']
baked=np.frombuffer(base64.b64decode(t['dm']),dtype='<i2').reshape(t['nz'],t['nx'])/10
sample=map_coordinates(baked,[(Z-t['z0'])/t['step'],(X-t['x0'])/t['step']],order=1,mode='nearest')
delta=sample-source
rows=[{'worldXZ':[float(x),float(z)],'latitude':lat,'longitude':lon,'sourceAslM':float(src),'bakedAslM':float(game),'differenceM':float(d)}for x,z,(lat,lon),src,game,d in zip(X.ravel(),Z.ravel(),locations,source.ravel(),sample.ravel(),delta.ravel())]
report={'source':'Copernicus EU-DEM v1.1 through OpenTopoData','documentation':'https://www.opentopodata.org/datasets/eudem/','request':url,'horizontalResolutionM':25,'verticalDatum':'EVRS2000','sourceStatedVerticalRmseM':7,'bakedGridSpacingM':t['step'],'samples':len(rows),'meanAbsoluteDifferenceM':float(np.abs(delta).mean()),'maxAbsoluteDifferenceM':float(np.abs(delta).max()),'note':'Comparison to baked base terrain only; runtime landmark terraces excluded. Source and game are not independent datasets. The finer baked spacing does not increase source resolution. River carving intentionally changes elevations.','points':rows}
(OUT/'report.json').write_text(json.dumps(report,indent=2)+'\n')
fig,axes=plt.subplots(1,3,figsize=(15,5),layout='constrained');extent=[xs[0],xs[-1],zs[-1],zs[0]]
lo=min(source.min(),sample.min());hi=max(source.max(),sample.max())
for ax,title,data in zip(axes,['Fresh EU-DEM samples','Game baked base terrain','Game minus source (m)'],[source,sample,delta]):
 im=ax.imshow(data,extent=extent,interpolation='nearest',cmap='RdBu_r' if ax is axes[2] else 'terrain',vmin=-max(abs(delta.min()),abs(delta.max())) if ax is axes[2] else lo,vmax=max(abs(delta.min()),abs(delta.max())) if ax is axes[2] else hi)
 wall=np.array(g['wall']+[g['wall'][0]]);ax.plot(wall[:,0],wall[:,1],color='black',lw=.7,label='baked source outline')
 ax.set(xlim=(xs[0],xs[-1]),ylim=(zs[-1],zs[0]),xlabel='East (m)',ylabel='South (m)',title=title);fig.colorbar(im,ax=ax,shrink=.65)
fig.suptitle('Benevento: 99 coordinate-matched elevation samples; heights above sea level')
fig.savefig(OUT/'comparison.png',dpi=150);plt.close(fig)
print(json.dumps({k:v for k,v in report.items() if k not in ('points','request')},indent=2))
