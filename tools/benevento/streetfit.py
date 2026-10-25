import json, numpy as np, cv2
from scipy.optimize import minimize
from scipy.ndimage import map_coordinates, gaussian_filter
from shapely.geometry import LineString, Polygon
o = json.load(open('osm.json'))
r = json.load(open('ref_outline.json'))
g = cv2.cvtColor(cv2.imread('ref.png'), cv2.COLOR_BGR2GRAY).astype(float)
black = (g < 110).astype(float)
black[540:, 640:1100] = 0
# soft cost field: high on lines, decaying over ~1.5 px
cost = gaussian_filter(black, 1.2)
cost = cost / cost.max()
MODERN = {'Corso Vittorio Emanuele III', 'Via del Pomerio', 'Via Nuova Calore', 'Viale dei Rettori', 'Via Carlo Torre', "Via Port'Arsa",
          'Viale San Lorenzo', 'Via Posillipo', 'Via Torre della Catena', 'Via Vittime di Nassiriya', 'Via Sandro Pertini', 'Piazza Arechi II',
          'Via Francesco Pepicelli', 'Via Michele Mattei', 'Via Giuseppe Capilongo', 'Via Ennio Goduti', 'Via Giuseppe Pasquali', 'Via Rampone'}
B0 = np.load('ref_px2world.npy')
town = Polygon(r['outline']).buffer(-15)
pts = []
for h in o['highways']:
    if h['name'] in MODERN or not h['name']: continue
    if h['k'] not in ('residential', 'pedestrian', 'living_street', 'unclassified', 'tertiary', 'secondary', 'primary', 'footway', 'steps'): continue
    L = LineString(h['pts'])
    c = L.intersection(town)
    for gg in (c.geoms if hasattr(c, 'geoms') else [c]):
        if gg.geom_type != 'LineString' or gg.length < 15: continue
        n = int(gg.length / 2)
        for i in range(n + 1):
            p = gg.interpolate(i / n, normalized=True); pts.append((p.x, p.y))
pts = np.array(pts)
print('street samples', len(pts))
lm_w = np.array([[389, -224], [-232, -16], [-76, -61]], float)
lm_p = np.array([[922, 176], [322, 497], [468, 418]], float)
def unpack(v):
    return np.array([[v[0], v[1]], [v[2], v[3]], [v[4], v[5]]])
def score(v, verbose=False):
    B = unpack(v); A = B[:2]; t = B[2]
    Ai = np.linalg.inv(A)
    px = (pts - t) @ Ai
    c = map_coordinates(cost, [px[:, 1], px[:, 0]], order=1, mode='constant', cval=0.3)
    lm = np.hstack([lm_p, np.ones((3, 1))]) @ B - lm_w
    lpen = (np.linalg.norm(lm, axis=1) / 25.0) ** 2
    s = c.mean() + 0.02 * lpen.sum()
    if verbose: print('line cost', round(c.mean(), 4), 'landmark res m', np.linalg.norm(lm, axis=1).round(1))
    return s
v0 = B0.ravel()
score(v0, True)
best = None
for trial in range(12):
    start = v0 + (np.random.default_rng(trial).normal(0, 1, 6) * np.array([0.01, 0.01, 0.01, 0.01, 6, 6]) if trial else 0)
    res = minimize(score, start, method='Nelder-Mead', options={'maxiter': 6000, 'xatol': 1e-5, 'fatol': 1e-6})
    if best is None or res.fun < best.fun: best = res
    print(trial, round(res.fun, 4))
B = unpack(best.x)
score(best.x, True)
print(B)
np.save('ref_px2world_streets.npy', B)
