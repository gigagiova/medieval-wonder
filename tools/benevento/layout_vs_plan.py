import json, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
from PIL import Image, ImageDraw, ImageFont
D = os.environ.get('SCRATCH', '/tmp/benevento').rstrip('/') + '/'
g = json.load(open(os.path.join(ROOT, 'src/benevento/geo.json')))
m = json.load(open(D + 'layout_meta.json'))
lay = Image.open(D + 'layout.ppm').convert('RGB')
X0, Z0, S = -560, -420, 1.4
Wd, Hd = int(1300 * S), int(680 * S)
P = lambda q: ((q[0] - X0) * S, (q[1] - Z0) * S)
def plan_panel():
    im = Image.new('RGB', (Wd, Hd), (250, 248, 240)); dr = ImageDraw.Draw(im)
    for a in g['streetAreas']:
        dr.polygon([P(q) for q in a['pts']], fill=(250, 248, 240) if a['hole'] else (235, 160, 150))
    for q in g['parcels']:
        dr.polygon([P(v) for v in q['pts']], fill=(205, 205, 205) if q['k'] == 'parcel' else (170, 210, 160), outline=(90, 90, 90))
    return im, dr
f = ImageFont.load_default(size=26)
def finish(im, dr, title):
    dr.line([P(q) for q in g['medievalOutline'] + [g['medievalOutline'][0]]], fill=(120, 120, 120), width=1)
    dr.line([P(q) for q in g['civitasNova'] + [g['civitasNova'][0]]], fill=(0, 0, 255), width=2)
    dr.line([P(q) for q in g['wall'] + [g['wall'][0]]], fill=(220, 0, 0), width=3)
    dr.line([P(q) for q in g['decumanus']], fill=(230, 140, 0), width=2)
    dr.text((14, 10), title, fill=(0, 0, 0), font=f)
    for gx in range(-500, 701, 100): dr.text(P((gx, -412)), str(gx), fill=(0, 0, 255))
a, da = plan_panel(); finish(a, da, 'A. The plan (vectorised, registered): blocks grey, open green, streets red')
b = Image.new('RGB', (Wd, Hd), (60, 70, 60))
sc = lay.resize((int(lay.width * S), int(lay.height * S)), Image.NEAREST)
b.paste(sc, (int((m['x0'] - X0) * S), int((m['z0'] - Z0) * S)))
db = ImageDraw.Draw(b); finish(b, db, 'B. Generated town of AD 700: houses brown, lanes white, gardens green, sites pink')
c = b.copy(); dc = ImageDraw.Draw(c)
for q in g['parcels']:
    if q['in']: dc.polygon([P(v) for v in q['pts']], outline=(0, 200, 255))
finish(c, dc, 'C. Overlay: plan block outlines (cyan) on the generated town')
out = Image.new('RGB', (Wd, Hd * 3), (255, 255, 255))
out.paste(a, (0, 0)); out.paste(b, (0, Hd)); out.paste(c, (0, 2 * Hd))
out.save(os.path.join(ROOT, 'docs/benevento/layout-vs-plan.png'), optimize=True)
c.crop((int(250 * S), int(150 * S), int(800 * S), int(500 * S))).save(D + 'cmp_zoom.png')
print(out.size)
