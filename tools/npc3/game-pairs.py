"""
Main-versus-fix sheets from two game-capture.mjs runs (same place, same people).

    python3 tools/npc3/game-pairs.py <main_dir> <fix_dir> <out_dir>

One webp per person: front and side, main then fix, labelled. Brightness is
stretched (autocontrast) so the dusk scene can be read. Needs Pillow.
"""
import sys, glob, os
from PIL import Image, ImageOps, ImageDraw

main, fix, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
fs = sorted(os.path.basename(f) for f in glob.glob(os.path.join(fix, '*.png')))
for k in sorted({f[:2] for f in fs}):
    pair = [f for f in fs if f.startswith(k)]
    ims, labels = [], []
    for f in pair:
        for name, d in (('main', main), ('fix', fix)):
            p = os.path.join(d, f)
            if os.path.exists(p):
                ims.append(ImageOps.autocontrast(Image.open(p).convert('RGB'), cutoff=1))
                labels.append(f'{name}  {f[3:-4]}')
    if not ims:
        continue
    w, h = ims[0].size
    s = Image.new('RGB', (w * len(ims), h + 24), (20, 20, 20))
    dr = ImageDraw.Draw(s)
    for i, (im, lab) in enumerate(zip(ims, labels)):
        s.paste(im, (i * w, 24))
        dr.text((i * w + 6, 6), lab, fill=(230, 230, 230))
    path = os.path.join(out, f'{k}-{pair[0][3:].rsplit("-", 1)[0]}.webp')
    s.save(path, quality=80)
    print(path, os.path.getsize(path))
