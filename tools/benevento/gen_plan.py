"""Map the traced plan (plan_trace.json, plan pixels) to world metres through the
registration (registration.json / tps.py) and prepare it for the game.
Output: plan.json (world metres), read by gen_geo.py.

- cells: every traced footprint (house) and open cell (open, court), ring cells split
  into pieces without holes, buildings clipped 1.6 m inside the curtain line;
- streets: lane centre lines with their drawn widths; streetAreas: the lane spaces;
- wall: the circuit of 700 (the drawn outer line, less Civitas Nova);
- towers: the perimeter projections accepted as towers (TOWERS below).
Run from the scratch directory that holds plan_trace.json and registration.json."""
import json, os, sys
import numpy as np
from shapely.geometry import Polygon, LineString, MultiPolygon, box
from shapely.ops import split, unary_union
from shapely import affinity
exec(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'tps.py')).read())  # px2world, world2px_fast

T = json.load(open('plan_trace.json'))
W = lambda pts: px2world(np.asarray(pts, float))

def poly(pts, holes=()):
    p = Polygon(W(pts), [W(h) for h in holes]).buffer(0)
    return p

wall = Polygon(W(T['wall'])).buffer(0)
if wall.geom_type != 'Polygon': wall = max(wall.geoms, key=lambda g: g.area)
wall = wall.simplify(0.6)
inner = wall.buffer(-1.6, join_style=2)
print('circuit', round(wall.length), 'm,', round(wall.area / 1e4, 2), 'ha')

def pieces(g):
    if g.is_empty: return []
    if g.geom_type == 'Polygon': return [g]
    return [q for q in getattr(g, 'geoms', []) if q.geom_type == 'Polygon']

def split_ring(p):
    """A cell drawn round a court (it has holes): cut it into ranges through each hole's
    centre along both of the cell's principal axes, so every piece is a simple polygon."""
    out = [p]
    for h in p.interiors:
        hc = Polygon(h).centroid
        r = max(p.bounds[2] - p.bounds[0], p.bounds[3] - p.bounds[1]) * 2
        # principal axis from the minimum rotated rectangle
        mrr = p.minimum_rotated_rectangle
        c = np.array(mrr.exterior.coords)[:4]
        e = c[1] - c[0]; ang = np.arctan2(e[1], e[0])
        for a in (ang, ang + np.pi / 2):
            line = LineString([(hc.x - np.cos(a) * r, hc.y - np.sin(a) * r), (hc.x + np.cos(a) * r, hc.y + np.sin(a) * r)])
            nxt = []
            for q in out:
                try: nxt.extend(pieces(split(q, line)))
                except Exception: nxt.append(q)
            out = nxt
    return [q for q in out if not q.interiors] + [Polygon(q.exterior) for q in out if q.interiors]

def ring_out(p, tol):
    p = p.simplify(tol, preserve_topology=True)
    if p.is_empty or p.geom_type != 'Polygon': return None
    pts = np.array(p.exterior.coords)[:-1]
    return pts.round(2).tolist() if len(pts) >= 3 else None

cells = []
for c in T['cells']:
    p = poly(c['pts'], c['holes'])
    if p.is_empty: continue
    base = {'k': c['k'], 'src': c['id'], 'street': c['street'], 'sq': c.get('sq', False)}
    parts = []
    for q in pieces(p):
        if c['k'] == 'house':
            q = q.intersection(inner)
            for r in pieces(q):
                parts.extend(split_ring(r) if r.interiors else [r])
        else:
            q = q.intersection(wall)
            parts.extend(Polygon(r.exterior) for r in pieces(q))
    for q in parts:
        if q.area < (6 if c['k'] == 'house' else 12): continue
        pts = ring_out(q, 0.3)
        if pts is None: continue
        cells.append({**base, 'a': round(q.area, 1), 'pts': pts})
print('cells', len(cells), {k: sum(c['k'] == k for c in cells) for k in ('house', 'open', 'court')},
      'house area', round(sum(c['a'] for c in cells if c['k'] == 'house')), 'open', round(sum(c['a'] for c in cells if c['k'] != 'house')))

areas = []
for a in T['streetAreas']:
    pts = W(a['pts'])
    if len(pts) >= 3: areas.append({'hole': a['hole'], 'pts': pts.round(2).tolist()})
streets = []
for s in T['lanes']:
    pts = W(s['pts'])
    L = np.sum(np.linalg.norm(np.diff(pts, axis=0), axis=1))
    if L < 3: continue
    streets.append({'w': round(float(s['w_px']) * 0.98, 2), 'pts': pts.round(2).tolist()})
print('lanes', len(streets), 'length', round(sum(LineString(s['pts']).length for s in streets)), 'm')

# ---------------------------------------------------------------- towers
# Perimeter projections drawn on the plan's outer line and accepted as towers (review:
# docs/benevento/TOWERS.md). px: the projection's centre on the plan; osm: a surviving
# tower mapped in OSM that it corresponds to (then registered to it, see registration.json).
TOWERS = [
    {'id': 'biffa', 'name': 'Torre della Biffa', 'px': (240.65, 132.1), 'osm': 1015674808, 'shape': 'square'},
    {'id': 'N02', 'px': (336.0, 166.8), 'shape': 'square'},
    {'id': 'N04', 'px': (653.0, 154.0), 'shape': 'square'},
    {'id': 'N05', 'px': (767.0, 145.0), 'shape': 'round'},
    {'id': 'N06', 'px': (843.85, 134.4), 'osm': 1016982302, 'shape': 'square'},
    {'id': 'N07', 'px': (1047.85, 172.4), 'osm': 480303640, 'shape': 'square'},
    {'id': 'panaro', 'name': 'Torre del Santo Panaro', 'px': (1205.0, 216.0), 'osm': 248001579, 'shape': 'round'},
    {'id': 'E01', 'px': (1209.45, 358.95), 'osm': 1015674809, 'shape': 'square'},
]
inv = {int(t['id']): t for t in json.load(open(os.environ.get('OSM_TOWERS', 'osm-inventory.json')))}
towers = []
ext = wall.exterior
for t in TOWERS:
    w = W([t['px']])[0]
    if 'osm' in t: w = np.array(inv[t['osm']]['world'])
    d = ext.project(Polygon(ext).centroid) if False else None
    s = ext.project(__import__('shapely.geometry', fromlist=['Point']).Point(*w))
    on = np.array(ext.interpolate(s).coords[0])
    out = w - on
    off = float(np.linalg.norm(out))
    towers.append({'id': t['id'], 'name': t.get('name'), 'x': round(float(w[0]), 2), 'z': round(float(w[1]), 2),
                   'wall': on.round(2).tolist(), 'offset': round(off, 2), 'shape': t['shape'], 'osm': t.get('osm')})
    print('tower', t['id'], 'world', w.round(1), 'from the traced curtain', round(off, 1), 'm')

json.dump({'cells': cells, 'streetAreas': areas, 'streets': streets,
           'wall': np.array(wall.exterior.coords)[:-1].round(2).tolist(),
           'civitasNova': W(T['civitasNova']).round(1).tolist(),
           'drawnOutline': W(T['drawnOutline']).round(1).tolist(),
           'towers': towers}, open('plan.json', 'w'))
