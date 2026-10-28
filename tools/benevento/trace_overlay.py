"""Evidence: the generated town drawn back over the owner's plan, in plan pixels.

Usage (from a scratch dir with ref.png, registration.json, tps.py):
    npx tsx tools/benevento/dump_layout.ts layout.json
    python tools/benevento/trace_overlay.py layout.json out.png [x0 y0 x1 y1 scale]
Houses: red outlines (explorable: magenta fill); courtyards blue; gardens green;
squares/lanes untouched; curtain thick red; towers yellow; gates cyan."""
import json, sys, os
import numpy as np, cv2
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tps.py')).read())
L = json.load(open(sys.argv[1]))
out = sys.argv[2]
crop = [float(v) for v in sys.argv[3:8]] if len(sys.argv) >= 8 else [0, 0, 1376, 770, 2]
x0, y0, x1, y1, S = crop
img = cv2.imread('ref.png')
img = cv2.cvtColor(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
img = (255 - (255 - img.astype(np.float32)) * 0.55).astype(np.uint8)  # fade the plan
big = cv2.resize(img[int(y0):int(y1), int(x0):int(x1)], None, fx=S, fy=S, interpolation=cv2.INTER_CUBIC)
over = big.copy()
def PX(pts):
    q = world2px_fast(np.asarray(pts, float))
    q = (q - [x0, y0]) * S
    return np.nan_to_num(q).round().astype(np.int32)
for p in L['parcels']:
    if p['sq']: cv2.fillPoly(over, [PX(p['pts'])], (150, 225, 240))   # squares: pale sand
for p in L['plots']:
    col = {'cortis': (230, 170, 90)}.get(p['kind'], (120, 200, 120))
    cv2.fillPoly(over, [PX(p['pts'])], col)
for l in L['lots']:
    cv2.fillPoly(over, [PX(l['c'])], (210, 80, 230) if l['explore'] else (110, 110, 235))
big = cv2.addWeighted(over, 0.45, big, 0.55, 0)
for l in L['lots']:
    cv2.polylines(big, [PX(l['c'])], True, (0, 0, 170), 1, cv2.LINE_AA)
for p in L['plots']:
    q = PX(p['pts']); n = len(q)
    for k in p['walls']:
        cv2.line(big, tuple(q[k]), tuple(q[(k + 1) % n]), (20, 90, 20), 2, cv2.LINE_AA)
cv2.polylines(big, [PX(L['wall'])], True, (0, 0, 200), max(2, int(S * 1.5)), cv2.LINE_AA)
for t in L['towers']:
    c = PX([[t['x'], t['z']]])[0]
    cv2.circle(big, tuple(c), max(4, int(S * 3)), (0, 200, 255), -1)
    cv2.circle(big, tuple(c), max(4, int(S * 3)), (0, 0, 0), 1)
for g in L['gates']:
    c = PX([g['at']])[0]
    cv2.rectangle(big, tuple(c - 5), tuple(c + 5), (255, 200, 0), 2)
cv2.imwrite(out, big)
print('wrote', out, big.shape)
