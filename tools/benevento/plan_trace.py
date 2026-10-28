"""Trace the owner's urban plan (docs/benevento/urban-plan-reference.webp) cell by cell.

Every closed region between the drawn lines becomes one cell; the ink of each line is
shared between the cells on either side of it (nearest-cell rule), so neighbouring
footprints meet on the line's centre. Each cell is then classified as street, building,
courtyard or open space (rules and their uncertainty: docs/benevento/PLAN-TRACE.md).
Civitas Nova (the grey area labelled 1) is dropped; everything else drawn is kept.

Output, in plan pixels: plan_trace.json and debug images. gen_plan.py maps it to world
metres through the registration (tps.py).

Run from a scratch directory holding ref.png (the plan as PNG):
    python tools/benevento/plan_trace.py [ref.png]
"""
import json, sys
import cv2, numpy as np
from scipy import ndimage as ndi
from skimage.morphology import skeletonize

SRC = sys.argv[1] if len(sys.argv) > 1 else 'ref.png'
K = 3                        # work at 3x the plan's pixels
im = cv2.imread(SRC)
g1 = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
H1, W1 = g1.shape

# The two grey washes: Civitas Nova (~160) and the Lombard curtis circle 5 (~141).
# Grey pixels also fringe every line on white paper (anti-aliasing): a wash pixel is a
# grey one with no white paper within 2 px.
nowhite = cv2.erode((g1 < 228).astype(np.uint8), np.ones((5, 5), np.uint8))
def wash(lo, hi, min_area):
    w = ((g1 >= lo) & (g1 <= hi) & (nowhite > 0)).astype(np.uint8)
    w = cv2.morphologyEx(w, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    n, lab, st, _ = cv2.connectedComponentsWithStats(w, connectivity=4)
    out = np.zeros_like(w)
    for l in range(1, n):
        if st[l, 4] >= min_area: out[lab == l] = 1
    # the wash is broken by dense line work: bridge it over gaps of up to ~12 px
    out = cv2.morphologyEx(out, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25)))
    return ndi.binary_fill_holes(out).astype(np.uint8)
cn1 = wash(150, 172, 1500)       # Civitas Nova (all its pieces: the band runs east to x~665)
# Triangle 4 (Arch of Sacramento) hides where the edge of Civitas Nova runs. The visible
# grey edge enters it at (453,433) and leaves it at (492,461): below that straight line
# is Civitas Nova. (An inference: docs/benevento/PLAN-TRACE.md.)
SACRAMENTO_EDGE = ((453.0, 433.0), (492.0, 461.0))
cv2.fillPoly(cn1, [np.array([SACRAMENTO_EDGE[0], SACRAMENTO_EDGE[1], (505, 466), (505, 475), (436, 475), (436, 440)], np.int32)], 1)
circle1 = wash(128, 149, 1500)   # the curtis circle (5): real town, kept
# Ink: darker than ~72% of the local paper. Faint one-pixel lines on white have cores
# of 140-160, so a fixed threshold of 120 lost them and let blocks leak into the lanes.
reg = lambda a: cv2.dilate(a, np.ones((5, 5), np.uint8))
THR = np.full_like(g1, 184); THR[reg(circle1) > 0] = 101; THR[reg(cn1) > 0] = 115

# ---------------------------------------------------------------- ink, at 1x first
ink1 = (g1 < THR).astype(np.uint8)
# Annotations that are not part of the town. Legend text, the "3", the "<" at the far
# west: whole ink components that lie entirely inside these boxes are glyphs.
GLYPH_BOXES = [(655, 552, 1012, 770),   # legend: "1. Civitas nova" ... "5. Lombard curtis area"
               (938, 108, 982, 150),    # "3"
               (10, 445, 48, 485)]      # "<" mark west of Civitas Nova
n, lab, st, _ = cv2.connectedComponentsWithStats(ink1, connectivity=8)
glyph = np.zeros_like(ink1)
for l in range(1, n):
    x, y, w, h, a = st[l]
    for (x0, y0, x1, y1) in GLYPH_BOXES:
        if x >= x0 and y >= y0 and x + w <= x1 and y + h <= y1:
            glyph[lab == l] = 1
ink1[glyph > 0] = 0
# Triangle markers 3 (Arch of Trajan) and 4 (Arch of Sacramento) are drawn with a thicker
# stroke than the plan's lines: remove the thick parts only, inside their boxes.
TRIANGLES = {'3': (893, 143, 957, 205), '4': (437, 393, 503, 462)}
tri_mask = np.zeros_like(ink1)
dark = (g1 < 120).astype(np.uint8)
for name, (x0, y0, x1, y1) in TRIANGLES.items():
    sub = dark[y0:y1, x0:x1]
    thick = cv2.morphologyEx(sub, cv2.MORPH_OPEN, np.ones((4, 4), np.uint8))
    thick = cv2.dilate(thick, np.ones((3, 3), np.uint8))
    tri_mask[y0:y1, x0:x1] |= thick
ink1[tri_mask > 0] = 0
# A dead-end stroke continues the outer line of the north road eastwards past the point
# where the road turns in (x 595-647, row ~137): a road leaving the town, not its edge.
STUB = (597, 132, 648, 141)
ink1[STUB[1]:STUB[3], STUB[0]:STUB[2]] = 0
glyph[STUB[1]:STUB[3], STUB[0]:STUB[2]] = 1

# ---------------------------------------------------------------- the drawn town
# The drawn lines (and the Civitas Nova wash, which is dropped later anyway), closed,
# filled; thin appendages (the road stubs north of the town, loose dangling lines)
# removed by an opening. The curtis circle (5) is a translucent wash laid over the
# plan that bulges past the town's north line: it does not count as drawn town.
drawn = (ink1 | cn1).astype(np.uint8)
drawn[tri_mask > 0] = 1            # keep the triangle's area as part of the town
m = cv2.morphologyEx(drawn, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)), iterations=2)
cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
town1 = np.zeros_like(m)
cv2.drawContours(town1, [max(cs, key=cv2.contourArea)], -1, 1, -1)
town1 = cv2.morphologyEx(town1, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
n, lab, st, _ = cv2.connectedComponentsWithStats(town1, connectivity=4)
town1 = (lab == 1 + np.argmax(st[1:, 4])).astype(np.uint8)
# The opening rounds the town's outer edge inwards a little; the outer line itself must
# stay inside: add back the ink that touches the town.
town1 = cv2.morphologyEx(town1, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
# Triangle 3 is drawn over the north edge at the Arch of Trajan and hides it. The visible
# edge enters the triangle's left side at (912,161) and leaves its right side at (946,180):
# the edge is taken as the straight line between, and the triangle's apex above it is not
# town. (Recorded as an inference in docs/benevento/PLAN-TRACE.md.)
AUREA_EDGE = ((912.0, 161.0), (946.0, 180.0))
cut = np.array([(905, 140), (956, 140), (956, 183), AUREA_EDGE[1], AUREA_EDGE[0], (905, 158)], np.int32)
cv2.fillPoly(town1, [cut], 0)

# ---------------------------------------------------------------- at K x
up = lambda a: cv2.resize(a, (W1 * K, H1 * K), interpolation=cv2.INTER_NEAREST)
G = cv2.resize(g1, (W1 * K, H1 * K), interpolation=cv2.INTER_CUBIC)
ink = ((G < up(THR)) & (up(glyph) == 0) & (up(tri_mask) == 0)).astype(np.uint8)
# the edges hidden under the two triangles, drawn in as lines
for (a, b) in (AUREA_EDGE, SACRAMENTO_EDGE):
    cv2.line(ink, (int(a[0] * K), int(a[1] * K)), (int(b[0] * K), int(b[1] * K)), 1, K)
town = cv2.resize(town1, (W1 * K, H1 * K), interpolation=cv2.INTER_LINEAR)
town = (cv2.GaussianBlur(town.astype(np.float32), (0, 0), K * 0.7) > 0.5).astype(np.uint8)
cn = (cv2.GaussianBlur(up(cn1).astype(np.float32), (0, 0), K * 0.7) > 0.5).astype(np.uint8)
HH, WW = G.shape

# Small breaks in the drawn lines (a pixel or two where two strokes should meet) let a
# building cell leak into its neighbour or into the lanes. Bridge line ends that point at
# other ink within ~2.5 px of the plan, along the stroke's own direction.
sk = skeletonize(ink > 0).astype(np.uint8)
nb = cv2.filter2D(sk, -1, np.ones((3, 3), np.float32), borderType=cv2.BORDER_CONSTANT)
ends = np.argwhere((sk > 0) & (nb == 2))
skl, skn = ndi.label(sk, structure=np.ones((3, 3)))
bridged = 0
R_GAP = int(2.6 * K)
for (y, x) in ends:
    # direction of the stroke: from a point 4K back along the skeleton to the end
    y0, x0 = max(0, y - 4 * K), max(0, x - 4 * K)
    win = sk[y0:y + 4 * K + 1, x0:x + 4 * K + 1]
    lbl = ndi.label(win, structure=np.ones((3, 3)))[0]
    own = lbl == lbl[y - y0, x - x0]
    py, px = np.nonzero(own)
    d = np.array([x - (px + x0).mean(), y - (py + y0).mean()])
    if np.hypot(*d) < 1: continue
    d /= np.hypot(*d)
    if not town[y, x]: continue
    # the stroke's own ink nearby (its skeleton piece, grown by the line's half-width)
    owni = cv2.dilate(own.astype(np.uint8), np.ones((2 * K + 1, 2 * K + 1), np.uint8))
    # ink ahead, not part of this stroke's local piece
    best = None
    for s in range(K, R_GAP + 1):
        for off in (0, -1, 1):
            qx = int(round(x + d[0] * s - d[1] * off)); qy = int(round(y + d[1] * s + d[0] * off))
            if not (0 <= qx < WW and 0 <= qy < HH) or not ink[qy, qx]: continue
            ly, lx = qy - y0, qx - x0
            if 0 <= ly < owni.shape[0] and 0 <= lx < owni.shape[1] and owni[ly, lx]: continue
            best = (qx, qy); break
        if best: break
    if best:
        cv2.line(ink, (int(x), int(y)), best, 1, max(2, K - 1))
        bridged += 1
print('line breaks bridged', bridged)

paper = ((ink == 0) & (town > 0)).astype(np.uint8)
ncell, cell = cv2.connectedComponents(paper, connectivity=4)
print('closed regions', ncell - 1)

# ---------------------------------------------------------------- the street network
# The lanes are the one big connected white space (the drawing has no closed street
# blocks); wide parts of it are squares and yards opening on the lanes, unless they
# are a block whose outline is broken (then they are counted as open space, not built:
# no building is invented where the drawing does not close it).
areas = np.bincount(cell.ravel(), minlength=ncell)
areas[0] = 0
dist = cv2.distanceTransform(paper, cv2.DIST_L2, 5) / K       # plan px (~metres)
sk = skeletonize(paper > 0)
kind = np.zeros(ncell, np.uint8)  # 1 street, 2 building, 3 open, 4 courtyard, 9 dropped
inner_r = ndi.maximum(dist, cell, index=np.arange(ncell))
sk_len = ndi.sum(sk, cell, index=np.arange(ncell)) / K
# mean half-width along the skeleton
sk_hw = ndi.mean(dist, cell * sk, index=np.arange(ncell))
objs0 = ndi.find_objects(cell)
for l in range(1, ncell):
    a = areas[l] / (K * K)
    if a < 3: kind[l] = 9; continue
    w = 2 * (sk_hw[l] if sk_hw[l] > 0 else inner_r[l])
    elong = sk_len[l] / max(w, 0.5)
    if (w < 7.5 and elong > 6) or (w < 11 and elong > 12) or a > 25000:
        # ...unless it is a ring round other cells: a range of buildings round a court.
        sl = objs0[l - 1]
        mm = cell[sl] == l
        filled = ndi.binary_fill_holes(mm)
        kind[l] = 2 if (filled.sum() - mm.sum()) > 0.25 * mm.sum() and a < 4000 else 1
    elif a <= 520:
        kind[l] = 2
    else:
        kind[l] = 3
street_ids = [l for l in range(ncell) if kind[l] == 1]
print('street comps', len(street_ids), 'largest', max(areas[street_ids]) / K / K)
# Split the wide parts off the street components.
RW = 5.2   # a lane is at most ~10 px wide on this plan
st_mask = np.isin(cell, street_ids)
core = (dist >= RW) & st_mask
wide = cv2.dilate(core.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (int(2 * RW * K) + 1,) * 2)) & st_mask
wn, wlab = cv2.connectedComponents(wide.astype(np.uint8), connectivity=4)
nxt = ncell
first_split = ncell
extra_kind = []
squares = set()
for l in range(1, wn):
    mm = wlab == l
    a = mm.sum() / (K * K)
    if a < 150: continue
    cell[mm] = nxt
    # A small widening is a square of the lanes; a large one is most likely a block whose
    # outline is broken in the drawing: it is kept open (a garden), never built over.
    if a < 300: squares.add(nxt)
    nxt += 1
    extra_kind.append(3)
kind = np.concatenate([kind, np.array(extra_kind, np.uint8)])
ncell = nxt
print('squares/leaks split from the lanes', len(extra_kind))

# ---------------------------------------------------------------- share the ink
lab_full = cell.copy()
lab_full[(ink > 0) | (town == 0)] = 0
# no cell takes the ink inside Civitas Nova (the edge of the grey is the edge of the town of 700)

lab_full[np.isin(lab_full, np.nonzero(kind == 9)[0])] = 0
_, (iy, ix) = ndi.distance_transform_edt(lab_full == 0, return_indices=True)
full = lab_full[iy, ix]
full[town == 0] = 0
full[(cn > 0) & (ink > 0)] = 0

# ---------------------------------------------------------------- Civitas Nova
tot = np.bincount(full.ravel(), minlength=ncell)
in_cn = np.bincount(full.ravel(), weights=cn.ravel().astype(np.float64), minlength=ncell)
dropped_cn = 0
for l in range(1, ncell):
    if tot[l] and in_cn[l] > 0.5 * tot[l]:
        if kind[l] != 1: dropped_cn += 1; kind[l] = 9
        else:
            # A lane running along the edge of Civitas Nova: keep only its part outside.
            full[(full == l) & (cn > 0)] = 0
# A street component may run into Civitas Nova: cut it at the grey edge.
for l in np.nonzero(kind == 1)[0]:
    full[(full == l) & (cn > 0)] = 0
full[np.isin(full, np.nonzero(kind == 9)[0])] = 0
print('cells dropped in Civitas Nova', dropped_cn)
keep = full > 0
# Largest connected piece only (fragments cut off by the grey edge go).
nk, kl = cv2.connectedComponents(keep.astype(np.uint8), connectivity=4)
cnt = np.bincount(kl.ravel()); cnt[0] = 0
town700 = kl == np.argmax(cnt)
full[~town700] = 0

# ---------------------------------------------------------------- courtyards
# A non-street cell that touches no lane and is enclosed by buildings is a courtyard when
# it is large, or when it is drawn as the middle of a ring (a cloister, a court house).
ker = np.ones((3, 3), np.uint8)
def neighbours(l, bbox):
    x0, y0, x1, y1 = bbox
    sub = full[y0:y1, x0:x1]
    mm = (sub == l).astype(np.uint8)
    ring = cv2.dilate(mm, ker, iterations=2) & (1 - mm)
    nb = sub[ring > 0]
    return np.bincount(nb, minlength=ncell)
objs = ndi.find_objects(full)
touch_street = np.zeros(ncell, bool)
nbr_cache = {}
for l in range(1, ncell):
    if l > len(objs) or objs[l - 1] is None or kind[l] in (1, 9): continue
    sl = objs[l - 1]
    y0, y1 = max(0, sl[0].start - 3), min(HH, sl[0].stop + 3)
    x0, x1 = max(0, sl[1].start - 3), min(WW, sl[1].stop + 3)
    nb = neighbours(l, (x0, y0, x1, y1))
    nbr_cache[l] = nb
    lanes = sum(nb[q] for q in np.nonzero(nb)[0] if q and kind[q] == 1)
    outside = nb[0]
    touch_street[l] = lanes > 2 * K
    if kind[l] in (2, 3) and lanes <= 2 * K and outside <= 2 * K:
        # enclosed: courtyard if large; or if it is the hole of one single ring cell
        others = [q for q in np.nonzero(nb)[0] if q]
        a = tot[l] / (K * K)
        if kind[l] == 3: kind[l] = 4
        elif len(others) == 1 and a >= 40 and a > 0.15 * tot[others[0]] / (K * K): kind[l] = 4
        # an inner cell of a block, reached by no lane and ringed by buildings, large
        # enough to be a yard rather than a back room
        elif a >= 100 and all(kind[q] == 2 for q in others): kind[l] = 4

# ---------------------------------------------------------------- polygons
def ring_pts(mask, x0, y0):
    cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if not cs: return None, []
    i = max(range(len(cs)), key=lambda i: cv2.contourArea(cs[i]) if hier[0][i][3] < 0 else -1)
    outer = cv2.approxPolyDP(cs[i], 0.55 * K, True)[:, 0, :].astype(float)
    holes = [cv2.approxPolyDP(cs[j], 0.55 * K, True)[:, 0, :].astype(float) for j in range(len(cs)) if hier[0][j][3] == i and cv2.contourArea(cs[j]) > 9 * K * K]
    sh = np.array([x0, y0], float)
    # pixel centres -> plan px
    f = lambda c: ((c + sh + 0.5) / K).round(3).tolist()
    return f(outer), [f(h) for h in holes if len(h) >= 3]
KN = {1: 'street', 2: 'house', 3: 'open', 4: 'court'}
cells_out = []
objs = ndi.find_objects(full)
for l in range(1, ncell):
    if l > len(objs) or objs[l - 1] is None or kind[l] == 9: continue
    sl = objs[l - 1]
    y0, y1 = max(0, sl[0].start - 2), min(HH, sl[0].stop + 2)
    x0, x1 = max(0, sl[1].start - 2), min(WW, sl[1].stop + 2)
    mm = (full[y0:y1, x0:x1] == l).astype(np.uint8)
    a = mm.sum() / (K * K)
    if a < 3: continue
    if kind[l] == 1: continue   # lanes go out as areas and centre lines below
    outer, holes = ring_pts(mm, x0, y0)
    if outer is None or len(outer) < 3: continue
    cells_out.append({'id': int(l), 'k': KN[int(kind[l])], 'a_px': round(float(a), 1), 'street': bool(touch_street[l]), 'sq': bool(l in squares),
                      'r_in': round(float(inner_r[l]) if l < len(inner_r) else 0, 2), 'pts': outer, 'holes': holes})
print('cells', len(cells_out), {k: sum(c['k'] == k for c in cells_out) for k in ('house', 'open', 'court')})

# Lanes: area rings and centre lines (skeleton), in plan px.
st_full = np.isin(full, np.nonzero(kind == 1)[0]).astype(np.uint8)
cs, hier = cv2.findContours(st_full, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
street_areas = []
for i, c in enumerate(cs):
    if cv2.contourArea(c) < 20 * K * K: continue
    c = cv2.approxPolyDP(c, 0.6 * K, True)[:, 0, :]
    if len(c) < 3: continue
    street_areas.append({'hole': bool(hier[0][i][3] >= 0), 'pts': ((c + 0.5) / K).round(2).tolist()})
# Centre lines over the paper part of the lanes (not their ink share), widths from it.
lane_paper = st_full & paper
lane_paper = cv2.morphologyEx(lane_paper, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
ldist = cv2.distanceTransform(lane_paper, cv2.DIST_L2, 5)
skel = skeletonize(lane_paper > 0).astype(np.uint8)
ys, xs = np.nonzero(skel)
PS = set(zip(xs.tolist(), ys.tolist()))
def neigh(p):
    x, y = p
    return [(x + dx, y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx or dy) and (x + dx, y + dy) in PS]
deg = {p: len(neigh(p)) for p in PS}
nodes = {p for p, d in deg.items() if d != 2}
seen = set(); polys = []
for s in nodes:
    for q in neigh(s):
        if (s, q) in seen: continue
        path = [s, q]; seen.add((s, q)); seen.add((q, s))
        prev, cur = s, q
        while cur not in nodes:
            nx_ = [r for r in neigh(cur) if r != prev and (cur, r) not in seen]
            if not nx_: break
            r = nx_[0]; seen.add((cur, r)); seen.add((r, cur)); path.append(r); prev, cur = cur, r
        if len(path) >= 4: polys.append(path)
lanes = []
for pth in polys:
    a = np.array(pth, float)
    L = np.sum(np.linalg.norm(np.diff(a, axis=0), axis=1)) / K
    if L < 3: continue
    simp = cv2.approxPolyDP(a.astype(np.float32).reshape(-1, 1, 2), 0.5 * K, False)[:, 0, :]
    # drawn width: lane paper plus one line width (the ink shared to each side)
    wd = np.array([ldist[int(y), int(x)] for x, y in a]) * 2 / K + 1.6
    lanes.append({'w_px': round(float(np.clip(np.median(wd), 1.6, 9)), 2), 'pts': ((simp + 0.5) / K).round(2).tolist()})
print('lane centre lines', len(lanes), 'length px', round(sum(np.sum(np.linalg.norm(np.diff(np.array(s['pts']), axis=0), axis=1)) for s in lanes)))

# ---------------------------------------------------------------- the circuit of 700
t700 = (full > 0).astype(np.uint8)
t700 = cv2.morphologyEx(t700, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
t700 = ndi.binary_fill_holes(t700).astype(np.uint8)
cs, _ = cv2.findContours(t700, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
c = max(cs, key=cv2.contourArea)
# the curtain stands on the centre of the outer line: ~1 plan px inside the ink's outer edge
er = cv2.erode(t700, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * K + 1, 2 * K + 1)))
cs2, _ = cv2.findContours(er, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
c2 = max(cs2, key=cv2.contourArea)
wall = ((cv2.approxPolyDP(c2, 0.45 * K, True)[:, 0, :] + 0.5) / K).round(2)
print('curtain vertices', len(wall))
# Civitas Nova outline (for the map), and the whole drawn outline
cs, _ = cv2.findContours(cn, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
cnc = max(cs, key=cv2.contourArea)
cn_pts = ((cv2.approxPolyDP(cnc, 1.5 * K, True)[:, 0, :] + 0.5) / K).round(2)
cs, _ = cv2.findContours(town, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
tc = max(cs, key=cv2.contourArea)
town_pts = ((cv2.approxPolyDP(tc, 1.5 * K, True)[:, 0, :] + 0.5) / K).round(2)

# ---------------------------------------------------------------- perimeter projections
# Towers on this plan are small bumps on the outer line: parts of the circuit that an
# opening with a ~9 px disc removes, compact and 15-160 px^2 in area.
op = cv2.morphologyEx(t700, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9 * K + 1,) * 2))
bump = (t700 & (1 - op)).astype(np.uint8)
# only bumps on the outside edge: within 4 px of the exterior
ext = cv2.dilate((1 - t700).astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * K + 1,) * 2))
nb_, bl, bs, bc = cv2.connectedComponentsWithStats(bump, connectivity=4)
proj = []
for l in range(1, nb_):
    x, y, w, h, a = bs[l]
    a1 = a / (K * K)
    if a1 < 12 or a1 > 200: continue
    mm = bl == l
    if not (mm & (ext > 0)).any(): continue
    # depth out from the opened outline
    d_in = cv2.distanceTransform((1 - op).astype(np.uint8), cv2.DIST_L2, 3)[mm].max() / K
    if d_in < 2.2: continue
    elong = max(w, h) / max(1, min(w, h))
    proj.append({'px': (bc[l] / K).round(2).tolist(), 'area_px': round(float(a1), 1), 'depth_px': round(float(d_in), 2),
                 'bbox': [round(x / K, 1), round(y / K, 1), round(w / K, 1), round(h / K, 1)], 'elong': round(float(elong), 2)})
print('perimeter projections', len(proj))

json.dump({'K': K, 'cells': cells_out, 'streetAreas': street_areas, 'lanes': lanes, 'wall': wall.tolist(),
           'civitasNova': cn_pts.tolist(), 'drawnOutline': town_pts.tolist(), 'projections': proj,
           'triangles': {k: v for k, v in TRIANGLES.items()}}, open('plan_trace.json', 'w'))

# ---------------------------------------------------------------- debug image
vis = np.full((HH, WW, 3), 255, np.uint8)
col = {1: (90, 90, 235), 2: (170, 170, 170), 3: (130, 210, 130), 4: (90, 190, 230)}
for k, cc in col.items():
    vis[np.isin(full, np.nonzero(kind == k)[0])] = cc
vis[(cn > 0) & (full == 0) & (town > 0)] = (235, 215, 200)
vis[ink > 0] = (vis[ink > 0] * 0.35).astype(np.uint8)
cv2.polylines(vis, [(wall * K).astype(np.int32)], True, (0, 0, 200), 2)
for p in proj:
    cv2.circle(vis, (int(p['px'][0] * K), int(p['px'][1] * K)), 5 * K, (200, 0, 200), 2)
cv2.imwrite('plan_trace.png', vis)
np.save('plan_full.npy', full); np.save('plan_kind.npy', kind)
