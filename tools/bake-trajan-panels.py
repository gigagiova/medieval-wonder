"""Bake licensed exact-monument photographs to a single1024atlas + shallow inferred depth.
Offline only. See docs/benevento/TRAJAN-RELIEF-CANDIDATE.md for limitations.
"""
import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,'/workspace/npc-audit/python-libs')
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter,zoom
import onnxruntime as ort
ROOT=Path(__file__).resolve().parents[1];SRC=Path('/workspace/npc-audit/trajan-relief-assets');OUT=ROOT/'public/models/trajan';OUT.mkdir(exist_ok=True)
manifest=json.loads((SRC/'field-manifest.json').read_text())
fields=manifest if isinstance(manifest,list) else manifest['fields']
fields=[f for f in fields if f.get('recommended',True)]
fields.sort(key=lambda f:f.get('slot','').startswith('passage'))
opts=ort.SessionOptions();opts.intra_op_num_threads=2;opts.inter_op_num_threads=1
session=ort.InferenceSession('/workspace/npc-audit/research/trajan/depth-model/model.onnx',opts,providers=['CPUExecutionProvider'])
atlas=Image.new('RGB',(1024,1024),(185,180,172));result=[]
for i,f in enumerate(fields[:16]):
 path=Path(f['file']);path=path if path.is_absolute() else SRC/path
 original=Image.open(path).convert('RGB')
 if f.get('quad'):
  # PIL QUAD order: upper-left,lower-left,lower-right,upper-right.
  q=f['quad'];q=[q[0],q[3],q[2],q[1]];im=original.transform((768,768),Image.Transform.QUAD,tuple(v for xy in q for v in xy),Image.Resampling.BICUBIC)
 else:im=original.crop(tuple(f['crop']))
 a=np.asarray(im.resize((518,518)),dtype=np.float32)/255;a=(a-[.485,.456,.406])/[.229,.224,.225]
 cache=SRC/(f"inference-{i}-"+hashlib.sha1(str(f).encode()).hexdigest()[:10]+'.npy')
 alternates=list(SRC.glob('inference-*-'+hashlib.sha1(str(f).encode()).hexdigest()[:10]+'.npy'))
 if alternates:depth=np.load(alternates[0])
 else:
  output=session.run(None,{session.get_inputs()[0].name:a.transpose(2,0,1)[None].astype('float32')})[0].squeeze();lo,hi=np.percentile(output,[3,97]);depth=np.clip((output-lo)/(hi-lo),0,1);np.save(cache,depth)
 # 32x32cells:2048triangles per field, no model loaded in browser.
 d=zoom(gaussian_filter(depth,1.1),(33/depth.shape[0],33/depth.shape[1]),order=1)
 wide=f.get('slot','').startswith('passage');tw=504 if wide else 248
 photo=np.asarray(im.resize((tw,248)),dtype=np.float32)/255;lum=photo.mean(2);low=gaussian_filter(lum,9)
 ratio=np.clip(lum/np.maximum(low,.06),.32,1.6)
 # Store sRGB, targeting approximately.46linear marble; retain modest cavity
 # shading but remove low-frequency sunlight. Unrecoverable shadows remain.
 linear=.46*ratio**.58
 alb=np.stack([linear*1.04,linear,linear*.94],2);srgb=np.where(alb<=.0031308,alb*12.92,1.055*np.maximum(alb,0)**(1/2.4)-.055)
 tile=Image.fromarray(np.uint8(np.clip(srgb,0,1)*255))
 x=(i-12)*512 if wide else (i%4)*256;y=768 if wide else (i//4)*256
 #4px gutters prevent mipmap bleed, by nearest edge extension.
 padded=np.pad(np.asarray(tile),((4,4),(4,4),(0,0)),mode='edge');atlas.paste(Image.fromarray(padded),(x,y))
 result.append({'id':f.get('id',path.stem),'tile':i,'rect':[x+4,y+4,tw,248],'slot':f.get('slot',''),'grid':33,'depth':[round(float(v),4) for v in d.flat],'source':f.get('source',''),'title':f.get('title','')})
 print(i,f.get('id',path.name),'done',flush=True)
atlas.save(OUT/'reliefs.webp',quality=93)
(OUT/'panels.json').write_text(json.dumps(result,separators=(',',':')))
(OUT/'sources.json').write_text(json.dumps([{**f,'file':Path(f['file']).name} for f in fields[:16]],indent=2))
print('Complete',len(result),'fields',flush=True)
