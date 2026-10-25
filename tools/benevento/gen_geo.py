"""Bake Benevento c. AD 700 geography for the game: terrain, rivers, the 700 circuit, streets.
World frame: metres, x east, z south, origin at lat 41.1305 N, lon 14.7745 E (equirectangular)."""
import json, base64, math, numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates
from shapely.geometry import Polygon, LineString, MultiLineString, Point
from shapely.ops import linemerge, unary_union
OUT = '/home/user/medieval-wonder/.claude/worktrees/agent-a6d696e568780419c/src/benevento/geo.json'
X0, Z0, X1, Z1, ST = -1450, -800, 900, 560, 10
o = json.load(open('osm.json'))
dem = json.load(open('dem.json'))
H = np.array(dem['h'], float).reshape(dem['nz'], dem['nx'])
def demAt(x, z):
    j = (np.asarray(x) - dem['x0']) / dem['step']; i = (np.asarray(z) - (-900)) / dem['step']
    return map_coordinates(H, [np.atleast_1d(i), np.atleast_1d(j)], order=1, mode='nearest')
xs = np.arange(X0, X1 + 0.1, ST); zs = np.arange(Z0, Z1 + 0.1, ST)
GX, GZ = np.meshgrid(xs, zs)
T = demAt(GX.ravel(), GZ.ravel()).reshape(GX.shape)
T = gaussian_filter(T, 1.2)

# ---------------------------------------------------------------- the 700 circuit
r = json.load(open('ref_outline.json'))
outline = Polygon(r['outline']).buffer(0).buffer(25).buffer(-25)
cn = Polygon(r['shades'][0]).buffer(0)
town = outline.difference(cn.buffer(22)).buffer(-8).buffer(8)
if town.geom_type != 'Polygon': town = max(town.geoms, key=lambda g: g.area)
# The circuit of c. 600 stopped short of the later (by 926) Porta Somma / Rocca annex.
cut = Polygon([(900, -40), (604, 26), (574, 170), (560, 420), (900, 420)])
town = town.difference(cut)
if town.geom_type != 'Polygon': town = max(town.geoms, key=lambda g: g.area)
town = town.simplify(2.5)
if not town.exterior.is_ccw: pass
wall = [[round(x, 1), round(z, 1)] for x, z in list(town.exterior.coords)[:-1]]
print('circuit perimeter', round(town.length), 'm, area', round(town.area / 1e4, 1), 'ha, vertices', len(wall))

# ---------------------------------------------------------------- rivers
def river(name_id, w, lo_hi):
    pts = None
    for wv in o['waterways']:
        if wv['id'] == name_id and wv.get('k') == 'river': pts = wv['pts']
    P = [p for p in pts if X0 - 200 < p[0] < X1 + 200 and Z0 - 200 < p[1] < Z1 + 200]
    L = LineString(P).simplify(4)
    # resample every 12 m and smooth
    n = int(L.length / 12)
    Q = np.array([L.interpolate(i / n, normalized=True).coords[0] for i in range(n + 1)])
    for _ in range(3): Q[1:-1] = (Q[:-2] + 2 * Q[1:-1] + Q[2:]) / 4
    # water level: min DEM in a band, then monotone downstream (the list runs downstream)
    lv = []
    for (x, z) in Q:
        ring = [demAt(x + dx, z + dz)[0] for dx in (-20, 0, 20) for dz in (-20, 0, 20)]
        lv.append(min(ring))
    lv = np.array(lv)
    lv = np.minimum.accumulate(lv)
    lv = gaussian_filter(lv, 4)
    lv = np.minimum.accumulate(lv) - 0.8
    return {'pts': Q.round(1).tolist(), 'w': w, 'level': lv.round(2).tolist()}
calore = river('838750109', 32, None)
sabato = river('59431408', 21, None)
# Calore list runs upstream->downstream (east to west) already; Sabato runs south->north (downstream). good.
for rv, nm in ((calore, 'Calor'), (sabato, 'Sabbatus')):
    rv['name'] = nm
    print(nm, len(rv['pts']), 'level', rv['level'][0], '->', rv['level'][-1])

# carve channels into the terrain
gpts = np.stack([GX.ravel(), GZ.ravel()], 1)
Tf = T.ravel().copy()
for rv in (calore, sabato):
    Q = np.array(rv['pts']); lv = np.array(rv['level']); hw = rv['w'] / 2
    # nearest segment per grid point (brute force over chunks)
    best_d = np.full(len(gpts), 1e9); best_l = np.zeros(len(gpts))
    for k in range(len(Q) - 1):
        a, b = Q[k], Q[k + 1]; ab = b - a; L2 = (ab ** 2).sum()
        t = np.clip(((gpts - a) @ ab) / L2, 0, 1)
        d = np.linalg.norm(gpts - (a + t[:, None] * ab), axis=1)
        m = d < best_d
        best_d[m] = d[m]; best_l[m] = lv[k] + (lv[k + 1] - lv[k]) * t[m]
    bank = 26.0
    inn = best_d < hw
    bed = best_l - 0.3 - 2.6 * (1 - (best_d / hw) ** 2)
    Tf[inn] = np.minimum(Tf[inn], bed[inn])
    ring = (best_d >= hw) & (best_d < hw + bank)
    s = (best_d[ring] - hw) / bank
    s = s * s * (3 - 2 * s)
    lowbank = best_l[ring] + 0.25
    Tf[ring] = lowbank + (np.maximum(Tf[ring], lowbank + 0.6) - lowbank) * s
    near = (best_d >= hw + bank) & (best_d < hw + 120)
    Tf[near] = np.maximum(Tf[near], best_l[near] + 0.9)
T2 = Tf.reshape(T.shape)
print('terrain', T2.shape, round(T2.min(), 1), round(T2.max(), 1))
dm = np.round(T2 * 10).astype('<i2')

# ---------------------------------------------------------------- the plan: parcels, open spaces, streets
pl = json.load(open('plan.json'))
corso = []
for h in o['highways']:
    if h['name'] in ('Corso Giuseppe Garibaldi', 'Corso Dante'): corso.append(LineString(h['pts']))
corso = unary_union(corso)
town_b = town.buffer(4)
streets = []
for st in pl['streets']:
    L = LineString(st['pts'])
    if not L.intersects(town_b.buffer(60)): continue
    mid = L.interpolate(0.5, normalized=True)
    main = L.length > 6 and max(corso.distance(Point(p)) for p in L.coords) < 12 and st['w'] < 12
    ins = town.contains(mid)
    streets.append({'w': st['w'], 'main': bool(main), 'in': bool(ins), 'pts': st['pts']})
parcels = []
for q in pl['parcels']:
    Pq = Polygon(q['pts']).buffer(0)
    if Pq.is_empty: continue
    c = Pq.representative_point()
    parcels.append({'k': q['k'], 'a': q['a'], 'in': bool(town.contains(c)), 'pts': q['pts']})
areas = pl['streetAreas']
# The decumanus (platea publica maior) as one continuous lane: the cheapest path
# through the plan's lane graph between Porta S. Lorenzo and the east gate,
# kept close to the line of the later Via Magistrale (Corso Dante/Garibaldi).
import heapq
ends = []
for i, st in enumerate(streets):
    ends.append((tuple(st['pts'][0]), i, 0)); ends.append((tuple(st['pts'][-1]), i, 1))
pts_all = np.array([e[0] for e in ends])
from scipy.spatial import cKDTree
tree = cKDTree(pts_all)
node_of = {}
nid = 0
for k, p in enumerate(pts_all):
    if k in node_of: continue
    for j in tree.query_ball_point(p, 6.0):
        if j not in node_of: node_of[j] = nid
    nid += 1
adj = {}
for i, st in enumerate(streets):
    a, b = node_of[2 * i], node_of[2 * i + 1]
    L = LineString(st['pts'])
    dc = np.mean([corso.distance(Point(p)) for p in st['pts']])
    w = L.length * (1 + (dc / 5.0) ** 2) + 1.0
    adj.setdefault(a, []).append((b, w, i)); adj.setdefault(b, []).append((a, w, i))
# Bridge small gaps between lane pieces (the plan's lines cut some lanes).
npos = {}
for k, p in enumerate(pts_all): npos.setdefault(node_of[k], p)
nkeys = list(npos.keys()); narr = np.array([npos[k] for k in nkeys]); ntree = cKDTree(narr)
for a_i, a in enumerate(nkeys):
    for b_i in ntree.query_ball_point(narr[a_i], 30.0):
        b = nkeys[b_i]
        if b == a: continue
        d = float(np.linalg.norm(narr[a_i] - narr[b_i]))
        dc = corso.distance(Point(*(narr[a_i] + narr[b_i]) / 2))
        w = d * 1.6 * (1 + (dc / 5.0) ** 2) + 3
        adj.setdefault(a, []).append((b, w, -1))
def nearest_node(x, z):
    d, k = tree.query([x, z]); return node_of[k]
src, dst = nearest_node(-392, -332), nearest_node(590, 80)
dist = {src: 0}; prev = {}; pq = [(0, src)]
while pq:
    d, u = heapq.heappop(pq)
    if u == dst: break
    if d > dist.get(u, 1e18): continue
    for v, w, i in adj.get(u, []):
        nd = d + w
        if nd < dist.get(v, 1e18): dist[v] = nd; prev[v] = (u, i); heapq.heappush(pq, (nd, v))
path_edges = []
u = dst
while u in prev:
    p, i = prev[u]; path_edges.append((p, u, i)); u = p
path_edges.reverse()
dec = []
for p, u, i in path_edges:
    if i < 0:
        dec.append(list(npos[u])); continue
    seg = streets[i]['pts']
    if node_of[2 * i] != p: seg = seg[::-1]
    dec.extend(seg if not dec else seg[1:])
for s2 in streets: s2['main'] = False
decL = LineString(dec).simplify(1.0)
decumanus = [[round(x, 1), round(z, 1)] for x, z in decL.coords]
print('decumanus', len(path_edges), 'segments', round(LineString(dec).length), 'm, reached', u == src)

print('plan streets', len(streets), 'main', sum(s['main'] for s in streets), 'parcels', len(parcels), 'inside', sum(p['in'] for p in parcels))
geo = {
    'frame': {'lat0': 41.1305, 'lon0': 14.7745, 'note': 'x east, z south, metres; equirectangular'},
    'bounds': [X0, Z0, X1, Z1],
    'terrain': {'x0': X0, 'z0': Z0, 'step': ST, 'nx': len(xs), 'nz': len(zs), 'dm': base64.b64encode(dm.tobytes()).decode()},
    'rivers': [calore, sabato],
    'wall': wall,
    'civitasNova': [[round(x, 1), round(z, 1)] for x, z in list(cn.exterior.coords)[:-1]],
    'medievalOutline': [[round(x, 1), round(z, 1)] for x, z in list(outline.simplify(3).exterior.coords)[:-1]],
    'streets': streets,
    'parcels': parcels,
    'decumanus': decumanus,
    'streetAreas': areas,
}
json.dump(geo, open(OUT, 'w'), separators=(',', ':'))
import os
print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')
