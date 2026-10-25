import json, numpy as np, cv2
from scipy.ndimage import map_coordinates, gaussian_filter
from shapely.geometry import LineString, Polygon
exec(open('streetfit.py').read().split("B0 = np.load")[0])  # cost, MODERN, o, r
B0 = np.load('ref_px2world.npy')
town = Polygon(r['outline']).buffer(-15)
pts = []
for h in o['highways']:
    if h['name'] in MODERN or not h['name']: continue
    if h['k'] not in ('residential', 'pedestrian', 'living_street', 'unclassified', 'tertiary', 'secondary', 'primary', 'footway', 'steps'): continue
    c = LineString(h['pts']).intersection(town)
    for gg in (c.geoms if hasattr(c, 'geoms') else [c]):
        if gg.geom_type != 'LineString' or gg.length < 15: continue
        n = int(gg.length / 2)
        for i in range(n + 1):
            p = gg.interpolate(i / n, normalized=True); pts.append((p.x, p.y))
pts = np.array(pts)
# world -> px via current fit, then search similarity perturbations about the town centre in px space
A = B0[:2]; t = B0[2]; Ai = np.linalg.inv(A)
px0 = (pts - t) @ Ai
cx, cy = 700, 380
best = []
for rot in np.radians(np.arange(-20, 20.1, 1.0)):
    c, s = np.cos(rot), np.sin(rot)
    for sc in np.arange(0.85, 1.16, 0.03):
        q = (px0 - [cx, cy]) @ np.array([[c, s], [-s, c]]) * sc + [cx, cy]
        for dx in range(-60, 61, 4):
            for dy in range(-60, 61, 4):
                v = map_coordinates(cost, [q[:, 1] + dy, q[:, 0] + dx], order=1, mode='constant', cval=0.3).mean()
                best.append((v, np.degrees(rot), sc, dx, dy))
best.sort()
for b in best[:10]: print([round(x, 3) for x in b])
print('worst', best[-1][0], 'median', best[len(best) // 2][0])
