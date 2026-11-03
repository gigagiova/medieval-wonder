"""
Main-versus-fix sheets from two game-capture.mjs runs (same places).

    python3 tools/npc3/game-pairs.py <main_dir> <fix_dir> <out_dir>

People are matched by name (people.json), not by capture order: walkers
reach the camera in a different order in two builds. One webp per person
captured in both: front and side, main then fix, labelled. Brightness is
stretched (autocontrast) so the dusk scene can be read. Needs Pillow.
"""
import sys, os, json
from PIL import Image, ImageOps, ImageDraw

main, fix, out = sys.argv[1:4]
os.makedirs(out, exist_ok=True)
M = {(m['key'], m['view']): m for m in json.load(open(os.path.join(main, 'people.json')))}
F = json.load(open(os.path.join(fix, 'people.json')))
keys = []
for f in F:
    if f['key'] not in keys:
        keys.append(f['key'])
n = 0
for key in keys:
    ims, labels = [], []
    for view in os.environ.get('VIEWS', 'front,side').split(','):
        f = next((x for x in F if x['key'] == key and x['view'] == view), None)
        m = M.get((key, view))
        if not f or not m:
            continue
        for name, d, e in (('main', main, m), ('fix', fix, f)):
            ims.append(ImageOps.autocontrast(Image.open(os.path.join(d, e['file'])).convert('RGB'), cutoff=1))
            walk = e['w'].get('walk', 0)
            labels.append(f"{name}  {e['title']} ({e['outfit']}) {view}  walk {walk:.2f}")
    if not ims:
        continue
    w, h = ims[0].size
    s = Image.new('RGB', (w * len(ims), h + 24), (20, 20, 20))
    dr = ImageDraw.Draw(s)
    for i, (im, lab) in enumerate(zip(ims, labels)):
        s.paste(im, (i * w, 24))
        dr.text((i * w + 6, 6), lab, fill=(230, 230, 230))
    path = os.path.join(out, f"{n:02d}-{key.replace(' ', '_')}.webp")
    n += 1
    s.save(path, quality=80)
    print(path, os.path.getsize(path))
