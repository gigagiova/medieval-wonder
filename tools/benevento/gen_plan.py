"""Vectorise the user's urban plan (docs/benevento/urban-plan-reference.webp) into
world-space parcels, open spaces and streets, through the control-point
registration (thin-plate spline). Output: plan.json (world metres)."""
import cv2, numpy as np, json
from skimage.morphology import skeletonize
exec(open('tps.py').read())  # px2world
K = 3
lab = np.load('plan_lab.npy'); kind = np.load('plan_kind.npy')
H, W = lab.shape
def tow(c):  # contour points at K scale -> world
    return px2world(np.asarray(c, float) / K)
# ---------------------------------------------------------------- parcels and open spaces
parcels = []
n = lab.max() + 1
stats = cv2.connectedComponentsWithStats((lab > 0).astype(np.uint8))[2]
ids = np.unique(lab)
for l in ids:
    if l == 0 or kind[l] not in (2, 3): continue
    ys, xs = np.nonzero(lab == l)
    if len(xs) < 9 * K * K: continue  # < ~9 m2
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    m = (lab[y0:y1, x0:x1] == l).astype(np.uint8)
    # grow by the line half-width so parcels meet their neighbours along shared walls
    m = cv2.dilate(np.pad(m, 4), np.ones((3, 3), np.uint8), iterations=2)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)
    c = cv2.approxPolyDP(c, 1.6, True)[:, 0, :].astype(float) + [x0 - 4, y0 - 4]
    if len(c) < 3: continue
    w = tow(c)
    a = 0.5 * abs(np.dot(w[:, 0], np.roll(w[:, 1], 1)) - np.dot(w[:, 1], np.roll(w[:, 0], 1)))
    parcels.append({'k': 'open' if kind[l] == 3 else 'parcel', 'a': round(float(a), 1), 'pts': w.round(1).tolist()})
print('parcels', len(parcels), 'area total m2', round(sum(p['a'] for p in parcels)))
# ---------------------------------------------------------------- streets
st = (kind[lab] == 1).astype(np.uint8)
# The plan's lines cross some lanes where blocks meet: close those 1-3 px breaks.
st = cv2.morphologyEx(st, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
dist = cv2.distanceTransform(st, cv2.DIST_L2, 5)
# street area as polygons (outer contours + holes), for painting
cs, hier = cv2.findContours(st, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
areas = []
for i, c in enumerate(cs):
    if cv2.contourArea(c) < 20 * K * K: continue
    c = cv2.approxPolyDP(c, 1.2, True)[:, 0, :]
    if len(c) < 3: continue
    areas.append({'hole': bool(hier[0][i][3] >= 0), 'pts': tow(c).round(1).tolist()})
print('street area rings', len(areas))
# centre lines: skeleton traced into polylines
sk = skeletonize(st > 0).astype(np.uint8)
nb = cv2.filter2D(sk, -1, np.ones((3, 3), np.float32)) * sk  # self + neighbours
ys, xs = np.nonzero(sk)
PS = set(zip(xs.tolist(), ys.tolist()))
def neigh(p):
    x, y = p
    return [(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx or dy) and (x + dx, y + dy) in PS]
deg = {p: len(neigh(p)) for p in PS}
nodes = {p for p, d in deg.items() if d != 2}
seen_edges = set()
polys = []
for s in nodes:
    for q in neigh(s):
        e = (s, q)
        if e in seen_edges: continue
        path = [s, q]; seen_edges.add((s, q)); seen_edges.add((q, s))
        prev, cur = s, q
        while cur not in nodes:
            nx = [r for r in neigh(cur) if r != prev and (cur, r) not in seen_edges]
            if not nx: break
            r = nx[0]
            seen_edges.add((cur, r)); seen_edges.add((r, cur))
            path.append(r); prev, cur = cur, r
        if len(path) >= 4: polys.append(path)
# loops without nodes
print('raw skeleton polylines', len(polys))
streets = []
for pth in polys:
    a = np.array(pth, float)
    L = np.sum(np.linalg.norm(np.diff(a, axis=0), axis=1)) / K
    if L < 3.5: continue
    simp = cv2.approxPolyDP(a.astype(np.float32).reshape(-1, 1, 2), 1.5, False)[:, 0, :]
    wd = np.array([dist[int(y), int(x)] for x, y in a]) * 2 / K * 0.98
    streets.append({'w': round(float(np.clip(np.median(wd), 1.2, 9)), 2), 'pts': tow(simp).round(1).tolist()})
print('streets', len(streets), 'total length m', round(sum(np.sum(np.linalg.norm(np.diff(np.array(s['pts']), axis=0), axis=1)) for s in streets)))
json.dump({'parcels': parcels, 'streetAreas': areas, 'streets': streets}, open('plan.json', 'w'))
