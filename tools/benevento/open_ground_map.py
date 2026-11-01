"""Top-down map of the open ground's plans, in world metres (x east, z south).

Usage: python tools/benevento/open_ground_map.py open_ground.json out.png [x0 z0 x1 z1 px_per_m] [cam x z yaw ...]
Houses grey; walled cells by kind (wall lines dark); unwalled cells paler; street ground white, lane centre lines and paths light grey;
huts, sheds, ruin walls, kilns and stacks black; trees green dots; beds brown; vines purple;
pens orange; graves white; threshing floors yellow; wells blue. Cameras: red wedges."""
import json, sys, math
import numpy as np, cv2

D = json.load(open(sys.argv[1]))
out = sys.argv[2]
a = [float(v) for v in sys.argv[3:8]] if len(sys.argv) >= 8 else [-470, -340, 760, 260, 1.4]
x0, z0, x1, z1, S = a
cams = [float(v) for v in sys.argv[8:]]
W, H = int((x1 - x0) * S), int((z1 - z0) * S)
img = np.full((H, W, 3), 236, np.uint8)
def P(pts):
    q = (np.asarray(pts, float) - [x0, z0]) * S
    return q.round().astype(np.int32)
KIND = {  # BGR
    'orto': (110, 170, 120), 'vinea': (140, 90, 140), 'pomarium': (80, 140, 70), 'pratum': (150, 190, 160),
    'stabulum': (90, 150, 190), 'casalinum': (100, 130, 170), 'ruina': (150, 150, 160), 'calcaria': (205, 205, 200),
    'coemeterium': (170, 160, 150), 'area': (120, 200, 210), 'cortis': (90, 170, 230), 'hortulus': (110, 170, 120)}
cv2.fillPoly(img, [P(D['wall'])], (250, 250, 250))
for p in D['plots']:
    col = KIND.get(p['kind'], (150, 190, 160))
    if p['open']:
        # unwalled: the same colour, a little paler, no wall line
        cv2.fillPoly(img, [P(p['pts'])], tuple(int(c * 0.8 + 255 * 0.2) for c in col))
    else:
        cv2.fillPoly(img, [P(p['pts'])], col)
        n = len(p['pts'])
        for k in p['walls']:
            cv2.line(img, tuple(P([p['pts'][k]])[0]), tuple(P([p['pts'][(k + 1) % n]])[0]), (60, 60, 80), 2)
for s in D['streets']:
    cv2.polylines(img, [P(s['pts'])], False, (215, 215, 215), 1)
for l in D['lots']: cv2.fillPoly(img, [P(l)], (125, 125, 125)); cv2.polylines(img, [P(l)], True, (80, 80, 80), 1)
for p in D['plots']:
    for b in p['beds']: cv2.line(img, tuple(P([b[0]])[0]), tuple(P([b[1]])[0]), (50, 80, 120), 1)
    for b in p['vines']: cv2.line(img, tuple(P([b[0]])[0]), tuple(P([b[1]])[0]), (120, 40, 120), 1)
    for q in p['pens']: cv2.polylines(img, [P(q)], True, (0, 120, 230), 1)
    for g in p['graves']: cv2.circle(img, tuple(P([g])[0]), max(1, int(S * 0.6)), (255, 255, 255), -1)
    if p['floor']: cv2.circle(img, tuple(P([[p['floor']['x'], p['floor']['z']]])[0]), int(p['floor']['r'] * S), (80, 220, 240), -1)
    for s in p['solids']: cv2.fillPoly(img, [P(s)], (30, 30, 30))
    for t in p['trees']: cv2.circle(img, tuple(P([t])[0]), max(2, int(S * 1.6)), (40, 110, 30), -1)
for w in D['wells']: cv2.circle(img, tuple(P([w])[0]), max(2, int(S)), (200, 120, 0), -1)
cv2.polylines(img, [P(D['wall'])], True, (40, 40, 160), 2)
for i in range(0, len(cams), 3):
    cx, cz, yaw = cams[i:i + 3]
    # forward is (-sin yaw, -cos yaw) in x, z
    f = math.atan2(-math.cos(yaw), -math.sin(yaw))
    pts = [[cx, cz]] + [[cx + math.cos(f + d) * 90, cz + math.sin(f + d) * 90] for d in (-0.45, 0.45)]
    cv2.polylines(img, [P(pts)], True, (0, 0, 220), 2)
cv2.imwrite(out, img)
print(out, W, H)
