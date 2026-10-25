"""Scratch map: the user's plan with the reconstruction of AD 700 drawn over it, in
plan pixels (world features mapped through the inverse registration).
Writes docs/benevento/scratch-map.svg and .png.
Run from tools/benevento/ with registration.json, plan.json, sites.json, geo.json at hand."""
import json, base64, sys, numpy as np, os
exec(open(os.path.join(os.path.dirname(__file__), 'tps.py')).read())
ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'docs/benevento'
geo = json.load(open(os.path.join(ROOT, 'geo.json')))
sites = json.load(open(os.path.join(ROOT, 'sites.json')))
reg = json.load(open(os.path.join(ROOT, 'registration.json')))
dem = json.load(open(os.path.join(ROOT, 'dem.json')))
plan_png = os.path.join(ROOT, 'ref.png')
X0, Y0, X1, Y1 = -560, -330, 1560, 1020  # svg viewBox in plan px
def px(pts):
    q = world2px_fast(np.asarray(pts, float))
    return q
def path(pts, close=False):
    q = px(pts)
    q = q[~np.isnan(q).any(1)]
    if len(q) < 2: return ''
    d = 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in q)
    return d + (' Z' if close else '')
out = []
W, H = X1 - X0, Y1 - Y0
out.append(f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="{X0} {Y0} {W} {H}" width="{W}" height="{H}" font-family="Georgia, serif">')
out.append(f'<rect x="{X0}" y="{Y0}" width="{W}" height="{H}" fill="#f4efe3"/>')
# DEM contours (5 m) as faint lines, computed in world and mapped.
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
h = np.array(dem['h'], float).reshape(dem['nz'], dem['nx'])
xs = dem['x0'] + np.arange(dem['nx']) * dem['step']; zs = -900 + np.arange(dem['nz']) * dem['step']
cs = plt.contour(xs, zs, h, levels=np.arange(105, 200, 5))
for lev, segs in zip(cs.levels, cs.allsegs):
    for sg in segs:
        if len(sg) < 4: continue
        d = path(sg)
        if d: out.append(f'<path d="{d}" fill="none" stroke="#b59a6a" stroke-width="{1.2 if lev % 25 == 0 else 0.6}" opacity="0.6"/>')
plt.close('all')
b64 = base64.b64encode(open(plan_png, 'rb').read()).decode()
out.append(f'<image x="0" y="0" width="1376" height="770" opacity="0.55" xlink:href="data:image/png;base64,{b64}"/>')
# Rivers
for r in geo['rivers']:
    out.append(f'<path d="{path(r["pts"])}" fill="none" stroke="#5f8fa8" stroke-width="{r["w"]}" stroke-linecap="round" opacity="0.55"/>')
    q = px([r['pts'][len(r['pts']) // 3]])[0]
    out.append(f'<text x="{q[0]:.0f}" y="{q[1]:.0f}" font-size="18" fill="#2f5d75" font-style="italic">{"Calor" if r["name"] == "Calor" else "Sabbatus"}</text>')
# Civitas nova (Arechis II, after 758: not yet built in 700) and the later outline
out.append(f'<path d="{path(geo["civitasNova"], True)}" fill="#6a7fbf" fill-opacity="0.12" stroke="#4a5fa0" stroke-dasharray="6 4" stroke-width="1.5"/>')
out.append(f'<path d="{path(geo["medievalOutline"], True)}" fill="none" stroke="#777" stroke-dasharray="3 3" stroke-width="1"/>')
# The circuit of c. 600 (in use in 700)
out.append(f'<path d="{path(geo["wall"], True)}" fill="none" stroke="#b01e1e" stroke-width="4" opacity="0.85"/>')
# Roads outside, main streets inside
for rd in sites['roads']:
    out.append(f'<path d="{path(rd["pts"])}" fill="none" stroke="#a0763c" stroke-width="{rd["w"] * 1.2:.1f}" opacity="0.7"/>')
out.append(f'<path d="{path(geo["decumanus"])}" fill="none" stroke="#d48a1c" stroke-width="3.5" opacity="0.9"/>')
# Gates
for g in sites['gates']:
    q = px([g['at']])[0]
    out.append(f'<rect x="{q[0]-6:.1f}" y="{q[1]-6:.1f}" width="12" height="12" fill="#fff" stroke="#b01e1e" stroke-width="2.5"/>')
    out.append(f'<text x="{q[0]+9:.0f}" y="{q[1]-8:.0f}" font-size="14" fill="#7a1010">{g["name"]}</text>')
# Sites
for s in sites['sites']:
    q = px([[s['x'], s['z']]])[0]
    r = (s.get('flat') or [10, 0])[0] if s.get('flat') else 8
    rr = float(np.linalg.norm(px([[s['x'] + r, s['z']]])[0] - q))
    out.append(f'<circle cx="{q[0]:.1f}" cy="{q[1]:.1f}" r="{max(5, rr):.1f}" fill="#1f6b3a" fill-opacity="0.15" stroke="#1f6b3a" stroke-width="2"/>')
    out.append(f'<circle cx="{q[0]:.1f}" cy="{q[1]:.1f}" r="3.5" fill="#1f6b3a"/>')
    out.append(f'<text x="{q[0]+8:.0f}" y="{q[1]+5:.0f}" font-size="15" fill="#0f3d20" font-weight="bold">{s["name"]}</text>')
# Explorable houses
for e in sites['explore']:
    q = px([[e['x'], e['z']]])[0]
    out.append(f'<circle cx="{q[0]:.1f}" cy="{q[1]:.1f}" r="4" fill="#d4a017" stroke="#5a3a00"/>')
# Registration control points with residuals
for c in reg['controls']:
    x, y = c['plan_px']
    out.append(f'<path d="M{x-8},{y} L{x+8},{y} M{x},{y-8} L{x},{y+8}" stroke="#000" stroke-width="2"/>')
    out.append(f'<text x="{x+6}" y="{y+18}" font-size="11" fill="#000">{c["name"].split(" (")[0]} ({c["affine_residual_m"]} m)</text>')
# Legend
lg = [('#b01e1e', 'Circuit of c. 600, in use in AD 700 (2.83 km)'), ('#4a5fa0', 'Civitas nova of Arechis II (after 758): outside in 700'),
      ('#777', 'Later medieval outline (the plan)'), ('#d48a1c', 'Decumanus (platea publica maior)'), ('#a0763c', 'Roads outside the walls'),
      ('#1f6b3a', 'Landmark sites (terraces)'), ('#d4a017', 'Houses to enter'), ('#5f8fa8', 'Rivers (OSM)'), ('#b59a6a', 'Contours, 5 m (EU-DEM)')]
for i, (c, t) in enumerate(lg):
    y = Y1 - 230 + i * 24
    out.append(f'<rect x="{X0+20}" y="{y-12}" width="26" height="12" fill="{c}"/><text x="{X0+54}" y="{y}" font-size="16">{t}</text>')
out.append(f'<text x="{X0+20}" y="{Y0+40}" font-size="30" fill="#3b2a1a">Benevento, AD 700: scratch map over the reference plan</text>')
out.append(f'<text x="{X0+20}" y="{Y0+66}" font-size="15" fill="#3b2a1a">Plan pixels ~0.98 m; registration: 7 control points, affine RMS {reg["affine_rms_m"]} m, thin-plate spline exact at the points. North up.</text>')
out.append('</svg>')
os.makedirs(OUT, exist_ok=True)
svg = '\n'.join(out)
open(os.path.join(OUT, 'scratch-map.svg'), 'w').write(svg)
import cairosvg
cairosvg.svg2png(bytestring=svg.encode(), write_to=os.path.join(OUT, 'scratch-map.png'), output_width=2100)
print('wrote', OUT)
