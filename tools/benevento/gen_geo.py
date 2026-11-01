"""Write the traced plan into src/benevento/geo.json.

Only the plan-derived keys are replaced (wall, civitasNova, medievalOutline, streets,
parcels, streetAreas, decumanus, towers). Terrain and rivers are left exactly as baked
by bake_tinitaly.py (docs/benevento/TERRAIN.md).

Usage, from the scratch directory holding plan.json and osm.json:
    python tools/benevento/gen_geo.py path/to/src/benevento/geo.json
World frame: metres, x east, z south, origin lat 41.1305 N, lon 14.7745 E."""
import json, sys, heapq, os
import numpy as np
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union
from scipy.spatial import cKDTree

OUT = sys.argv[1]
geo = json.load(open(OUT))
pl = json.load(open('plan.json'))
o = json.load(open('osm.json'))

town = Polygon(pl['wall']).buffer(0)
print('circuit perimeter', round(town.length), 'm, area', round(town.area / 1e4, 1), 'ha, vertices', len(pl['wall']))

corso = unary_union([LineString(h['pts']) for h in o['highways'] if h['name'] in ('Corso Giuseppe Garibaldi', 'Corso Dante')])
streets = []
for st in pl['streets']:
    L = LineString(st['pts'])
    mid = L.interpolate(0.5, normalized=True)
    streets.append({'w': st['w'], 'main': False, 'in': bool(town.buffer(1.0).contains(mid)), 'pts': st['pts']})
parcels = []
for q in pl['cells']:
    P = Polygon(q['pts']).buffer(0)
    if P.is_empty: continue
    parcels.append({'k': q['k'], 'a': q['a'], 'in': bool(town.contains(P.representative_point())), 'src': q['src'], **({'sq': True} if q.get('sq') else {}), 'pts': q['pts']})

# The decumanus (platea publica maior): the cheapest path through the traced lane graph
# between Porta S. Lorenzo and Porta Summa, kept close to the line of the later Via
# Magistrale (Corso Dante / Corso Garibaldi).
ends = []
for i, st in enumerate(streets):
    ends.append(tuple(st['pts'][0])); ends.append(tuple(st['pts'][-1]))
pts_all = np.array(ends)
tree = cKDTree(pts_all)
node_of = {}
nid = 0
for k, p in enumerate(pts_all):
    if k in node_of: continue
    for j in tree.query_ball_point(p, 3.0):
        if j not in node_of: node_of[j] = nid
    nid += 1
adj = {}
for i, st in enumerate(streets):
    a, b = node_of[2 * i], node_of[2 * i + 1]
    L = LineString(st['pts'])
    dc = np.mean([corso.distance(Point(p)) for p in st['pts']])
    w = L.length * (1 + (dc / 5.0) ** 2) + 1.0
    adj.setdefault(a, []).append((b, w, i)); adj.setdefault(b, []).append((a, w, i))
npos = {}
for k, p in enumerate(pts_all): npos.setdefault(node_of[k], p)
nkeys = list(npos.keys()); narr = np.array([npos[k] for k in nkeys]); ntree = cKDTree(narr)
for a_i, a in enumerate(nkeys):
    for b_i in ntree.query_ball_point(narr[a_i], 25.0):
        b = nkeys[b_i]
        if b == a: continue
        d = float(np.linalg.norm(narr[a_i] - narr[b_i]))
        dc = corso.distance(Point(*(narr[a_i] + narr[b_i]) / 2))
        adj.setdefault(a, []).append((b, d * 1.6 * (1 + (dc / 5.0) ** 2) + 3, -1))
def nearest_node(x, z):
    d, k = tree.query([x, z]); return node_of[k]
# the gates on the traced curtain nearest the old positions
ext = town.exterior
gate = lambda x, z: np.array(ext.interpolate(ext.project(Point(x, z))).coords[0])
# The lanes that form one connected network as drawn (ends meeting within 3 m, no bridging):
# gates and the decumanus's ends are put where these reach the curtain.
par = {}
def find(a):
    while par.setdefault(a, a) != a: par[a] = par[par[a]]; a = par[a]
    return a
for i in range(len(streets)): par[find(node_of[2 * i])] = find(node_of[2 * i + 1])
roots = [find(node_of[2 * i]) for i in range(len(streets))]
cnt = {}
for i, rt in enumerate(roots): cnt[rt] = cnt.get(rt, 0) + LineString(streets[i]['pts']).length
main_root = max(cnt, key=cnt.get)
for i, st in enumerate(streets): st['net'] = roots[i] == main_root
print('connected lane network', round(cnt[main_root]), 'm of', round(sum(cnt.values())), 'm')
def gate_on_net(x, z):
    best, bd = None, 80
    for st in streets:
        if not st['net']: continue
        for e in (st['pts'][0], st['pts'][-1]):
            if ext.distance(Point(*e)) > 3.5: continue
            d = np.hypot(e[0] - x, e[1] - z)
            if d < bd: bd, best = d, e
    return gate(*best) if best is not None else gate(x, z)
gl, gs = gate_on_net(-392, -332), gate(647.7, 116.7)  # Summa: the opening drawn in the east line (plan_trace.py SUMMA_GAP)
print('decumanus ends: S. Lorenzo', gl.round(1), 'Summa', gs.round(1))
# start and end on the lane ends nearest the gates that belong to the main lane network
seen_c = {}
def comp(n0):
    if n0 in seen_c: return seen_c[n0]
    st_, c = [n0], {n0}
    while st_:
        u_ = st_.pop()
        for v_, _, _ in adj.get(u_, []):
            if v_ not in c: c.add(v_); st_.append(v_)
    for v_ in c: seen_c[v_] = c
    return c
big = max((comp(n) for n in npos), key=len)
print('lane graph nodes', len(npos), 'main component', len(big))
def nearest_node(x, z):
    return min(big, key=lambda n: np.hypot(npos[n][0] - x, npos[n][1] - z))
src, dst = nearest_node(*gl), nearest_node(*gs)
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
dec = [list(gl)]
for p, u, i in path_edges:
    if i < 0: dec.append(list(npos[u])); continue
    seg = streets[i]['pts']
    if node_of[2 * i] != p: seg = seg[::-1]
    dec.extend(seg if not dec else seg[1:])
dec.append(list(gs))
decL = LineString(dec).simplify(1.0)
decumanus = [[round(x, 1), round(z, 1)] for x, z in decL.coords]
print('decumanus', len(path_edges), 'segments', round(decL.length), 'm, reached', u == src)
print('plan streets', len(streets), 'parcels', len(parcels), 'inside', sum(p['in'] for p in parcels))

geo['wall'] = [[round(x, 2), round(z, 2)] for x, z in pl['wall']]
geo['civitasNova'] = pl['civitasNova']
geo['medievalOutline'] = pl['drawnOutline']
geo['streets'] = streets
geo['parcels'] = parcels
geo['streetAreas'] = pl['streetAreas']
geo['decumanus'] = decumanus
geo['towers'] = pl['towers']
json.dump(geo, open(OUT, 'w'), separators=(',', ':'))
print('wrote', OUT, os.path.getsize(OUT) // 1024, 'KB')
