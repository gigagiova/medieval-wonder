"""Experimental photo + inferred depth relief. Not a measured 3D scan.
Requires onnxruntime; model/source caches outside repository, published derivatives CC0.
"""
import sys,json
from pathlib import Path
sys.path.insert(0,'/workspace/npc-audit/python-libs')
import numpy as np
from PIL import Image,ImageFilter
from scipy.ndimage import gaussian_filter,zoom
import onnxruntime as ort
ROOT=Path(__file__).resolve().parents[1]
SRC=Path('/workspace/npc-audit/trajan-relief-assets/Arch of Trajan (Benevento) 03.jpg')
OUT=ROOT/'public/models/trajan-candidate';OUT.mkdir(exist_ok=True)
# Exact narrative field, excluding bordering capitals and the victory strip.
im=Image.open(SRC).convert('RGB').crop((1090,340,3090,1960))
im.save(SRC.parent/'candidate-source-crop.webp',quality=92)
opts=ort.SessionOptions();opts.intra_op_num_threads=2;opts.inter_op_num_threads=1
session=ort.InferenceSession('/workspace/npc-audit/research/trajan/depth-model/model.onnx',opts,providers=['CPUExecutionProvider'])
print([(x.name,x.shape) for x in session.get_inputs()],flush=True)
a=np.asarray(im.resize((518,518)),dtype=np.float32)/255
a=(a-[.485,.456,.406])/[.229,.224,.225]
out=session.run(None,{session.get_inputs()[0].name:a.transpose(2,0,1)[None].astype('float32')})[0].squeeze()
lo,hi=np.percentile(out,[3,97]);depth=np.clip((out-lo)/(hi-lo),0,1)
Image.fromarray(np.uint8(depth*255)).save(OUT/'inferred-depth.png')
# Keep topology modest: 80x64 cells /10,240tris. Coarse model shape, not photo brightness.
d=zoom(gaussian_filter(depth,1.1),(65/depth.shape[0],81/depth.shape[1]),order=1)
(OUT/'depth.json').write_text(json.dumps({'width':81,'height':65,'depth':[round(float(x),4) for x in d.flat]},separators=(',',':')))
# Remove large illumination gradient, reduce baked shadow contrast. This cannot
# remove all captured sunlight or recover occluded details: compare raking-light views.
photo=np.asarray(im.resize((1024,830)),dtype=np.float32)/255
lum=photo.mean(2);low=gaussian_filter(lum,30)
ratio=np.clip(lum/np.maximum(low,.06),.35,1.5)
linear=.55*ratio**.48
alb=np.stack([linear*1.04,linear,linear*.94],2)
Image.fromarray(np.uint8(np.clip(alb,0,1)*255)).save(OUT/'relief-albedo.webp',quality=91)
print('baked',d.shape,flush=True)
