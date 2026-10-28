"""
Belts, girdles and finished necklines for the v2 townsfolk, worked on the
shipped JSON glTF bodies without re-baking them (so the accepted heads and
faces stay bit-identical: see gltfio.body_digest).

    python3 tools/npc3/wardrobe_build.py <src_dir> <out_dir> [body ...]

<src_dir> holds the pristine bodies as baked by tools/npc2 (the files of
public/models/npc2 at commit df5b806); the results go to <out_dir>.
Requirements per role: tools/npc3/wardrobe.json and docs/npc/WARDROBE.md.

For each body-length garment (shirt, tunic, long robe, monk's robe, gown):

1. Cinch. A belt is tightened round the cloth at the waist in a small
   position-based cloth solve (Jacobi projection of edge-length constraints,
   Mueller et al. "Position Based Dynamics", 2007; XPBD's compliant form,
   Macklin et al. 2016, for the bending pairs): every edge keeps its
   authored length (the panels' dimensions do not change), the band under the
   belt is drawn in to the body's waist plus the cloth's thickness, the cloth
   may not enter the body, and the shoulders stay where they are. The excess
   width has nowhere to go but into gathers and a blouse above and below the
   belt, as cloth does. The per-edge strain is reported; a garment whose
   edges change length by more than STRAIN_MAX is refused.
2. The belt itself, by style, laid round the cinched band: a leather strap
   (3.2 cm) with its tongue hanging from the buckle, a round cord (a monk's
   rope or a priest's cingulum) knotted with two hanging ends, or a woven
   sash (girdle) tied with two ends. The ring follows the body's skinning; the
   hanging ends copy the skinning of the cloth they lie on (its spring
   bones), offset outward, so they swing with the skirt and cannot pass
   through it. Metal fittings (buckles, plates, strap ends) are props placed
   at run time (src/npc/props.ts).
3. Necklines (and sleeve cuffs): the single raw edge is given a turned-in
   facing, a rim 4 mm thick and a 2.5 cm band on the inside facing the body,
   so a neckline is never a paper-thin or see-through edge.
"""
import json, os, sys
import numpy as np
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.dirname(__file__))
from gltfio import Gltf, body_digest
from meshops import weld, edges_of, boundary_loops, vertex_normals, dense_weights, top4

# Acceptance of a cinch (the garment's dimensions unchanged): per-edge length
# change |l - l0| / max(l0, 1 cm) at the 99th percentile and at worst, and the perimeters of
# the hem, neck and cuffs (each boundary loop's length).
STRAIN_P99 = 0.02
STRAIN_MAX = 0.10
PERIMETER_MAX = 0.01
ALPHAS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
VERSION = 1

# Per body garment: which belts are made for it, and the default.
BELTS = {
    'shirt':    {'default': 'belt', 'styles': {'leather': 'belt'}},
    'tunic':    {'default': 'belt_tunic', 'styles': {'leather': 'belt_tunic', 'cord': 'cord_tunic'}},
    'longrobe': {'default': 'belt_robe', 'styles': {'leather': 'belt_robe', 'cord': 'cord_robe', 'sash': 'sash_robe'}},
    'robe':     {'default': 'rope', 'styles': {'cord': 'rope'}},
    'gown':     {'default': 'girdle', 'styles': {'sash': 'girdle'}},
}
STYLE = {  # band height (m), thickness, hanging ends (length, width), kind
    'leather': dict(h=0.032, t=0.004, ends=[(0.11, 0.028, -0.05)], round=False, fabric='leather'),
    'cord':    dict(h=0.012, t=0.012, ends=[(0.42, 0.012, -0.32), (0.36, 0.012, -0.20)], round=True, fabric='rope'),
    'sash':    dict(h=0.042, t=0.003, ends=[(0.34, 0.040, -0.34), (0.28, 0.036, -0.18)], round=False, fabric='tabby'),
}


def bind_bones(g):
    I = g.acc(g.j['skins'][0]['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    return {n: np.linalg.inv(M)[:3, 3] for n, M in zip(g.joints(), I)}


def smooth(x, a, b):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


class Body:
    """The body's skin (bind pose), for collision and for skin weights."""
    def __init__(self, g, nj):
        b = g.mesh([n['name'] for n in g.j['nodes'] if n['name'].endswith('.body')][0], 0)
        rep, U = weld(b['P'])
        F = rep[b['F']]
        self.P = U
        self.N = vertex_normals(U, F)
        D = np.zeros((len(U), nj))
        Dv = dense_weights(b['J'], b['W'], nj)
        for i, r in enumerate(rep):
            D[r] = Dv[i]
        self.D = D
        self.tree = cKDTree(U)

    def radius(self, y, c, half=0.012, bins=72, trunk=None):
        """Max radius of the trunk's section at height y, per angle (0 = +z, front)."""
        P = self.P
        sel = (np.abs(P[:, 1] - y) < half)
        if trunk is not None:
            sel &= trunk
        Q = P[sel]
        a = np.arctan2(Q[:, 0] - c[0], Q[:, 2] - c[1])
        r = np.hypot(Q[:, 0] - c[0], Q[:, 2] - c[1])
        k = ((a / (2 * np.pi) * bins).round().astype(int)) % bins
        R = np.zeros(bins)
        np.maximum.at(R, k, r)
        # Fill empty bins and smooth (circular).
        for i in range(bins):
            if R[i] == 0:
                R[i] = max(R[(i - 1) % bins], R[(i + 1) % bins])
        return np.array([R[[(i - 1) % bins, i, (i + 1) % bins]].max() for i in range(bins)])


def polar(R, a):
    bins = len(R)
    f = (a / (2 * np.pi) * bins) % bins
    i = np.floor(f).astype(int) % bins
    j = (i + 1) % bins
    return R[i] * (1 - (f - i % bins)) + R[j] * (f - i % bins)


def cinch(m, body, B, yb, h, trunk, arm_w, iters=1500, gap=0.015, alpha=0.0, log=print):
    """Draw the cloth in under a belt at height yb (band height h), lengths preserved."""
    rep, U = weld(m['P'])
    F = rep[m['F']]
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    E, _ = edges_of(F)
    arm = np.zeros(len(U))
    arm[rep] = arm_w
    L0 = np.linalg.norm(U[E[:, 0]] - U[E[:, 1]], axis=1)
    # Bending pairs: the two vertices opposite each interior edge.
    opp = {}
    for f in F:
        for k in range(3):
            a, b, c = f[k], f[(k + 1) % 3], f[(k + 2) % 3]
            opp.setdefault((min(a, b), max(a, b)), []).append(c)
    bend = np.array([v for v in opp.values() if len(v) == 2])
    Lb = np.linalg.norm(U[bend[:, 0]] - U[bend[:, 1]], axis=1) if len(bend) else np.zeros(0)
    c = np.array([B['Hips'][0], B['Hips'][2]])
    Rb = body.radius(yb, c, trunk=trunk)
    a0 = np.arctan2(U[:, 0] - c[0], U[:, 2] - c[1])
    r0 = np.hypot(U[:, 0] - c[0], U[:, 2] - c[1])
    near = (np.abs(U[:, 1] - yb) < h * 0.5) & (r0 < 0.4)
    # The cloth's own radius in the band, per angle (its outer surface).
    bins = len(Rb)
    Rg = np.zeros(bins)
    kk = ((a0[near] / (2 * np.pi) * bins).round().astype(int)) % bins
    np.maximum.at(Rg, kk, r0[near])
    Rg = np.where(Rg > 0, Rg, Rb + gap)
    # How far in the belt is drawn: to the body plus the gathered cloth (alpha 0), or less.
    Rt = Rb + gap + alpha * np.maximum(0, Rg - Rb - gap)
    # Fixed: the shoulders and everything that hangs from the arms (sleeves).
    pin = (U[:, 1] > B['Spine2'][1] - 0.02) | (arm > 0.3)
    free = (~pin).astype(float)
    cnt = np.zeros(len(U))
    np.add.at(cnt, E[:, 0], 1); np.add.at(cnt, E[:, 1], 1)
    cnt = np.maximum(cnt, 1)
    # Far from the belt, the authored drape is kept by a weak pull to it.
    dist = np.abs(U[:, 1] - yb)
    keep = 0.02 * smooth(dist, 0.10, 0.30)
    # Body: nearest skin vertex, its normal; legs and trunk only.
    P = U.copy()
    # A little irregularity, so the band can gather into pleats rather than shrink evenly.
    rng = np.random.default_rng(7)
    jit = (np.abs(U[:, 1] - yb) < h) & (r0 < 0.45)
    P[jit] += rng.normal(0, 0.002, (jit.sum(), 3))
    narrow = Rg.max() - Rt.max()
    stats = {}
    for it in range(iters):
        t = min(1.0, it / (0.6 * iters))
        if it % 10 == 0:
            d, j = body.tree.query(P)
            q, n = body.P[j], body.N[j]
        # Edge lengths (Jacobi, averaged), a few passes per contact pass.
        for _ in range(4):
            corr = np.zeros_like(P)
            dv = P[E[:, 1]] - P[E[:, 0]]
            l = np.linalg.norm(dv, axis=1)
            k = ((l - L0) / np.maximum(l, 1e-9))[:, None] * dv * 0.5
            np.add.at(corr, E[:, 0], k); np.add.at(corr, E[:, 1], -k)
            if len(bend):
                dv = P[bend[:, 1]] - P[bend[:, 0]]
                l = np.linalg.norm(dv, axis=1)
                k = ((l - Lb) / np.maximum(l, 1e-9))[:, None] * dv * 0.5 * 0.08
                np.add.at(corr, bend[:, 0], k); np.add.at(corr, bend[:, 1], -k)
            P += corr / cnt[:, None] * free[:, None]
        P += (U - P) * keep[:, None]
        # Outward bias near the belt early on, so gathers buckle out, not in.
        if t < 0.8:
            out = np.stack([np.sin(np.arctan2(P[:, 0] - c[0], P[:, 2] - c[1])), np.zeros(len(P)), np.cos(np.arctan2(P[:, 0] - c[0], P[:, 2] - c[1]))], 1)
            P += out * (0.0004 * (1 - smooth(np.abs(P[:, 1] - yb), h * 0.5, 0.12)))[:, None]
        # The belt: the band drawn in, gradually.
        a = np.arctan2(P[:, 0] - c[0], P[:, 2] - c[1])
        r = np.hypot(P[:, 0] - c[0], P[:, 2] - c[1])
        # The cloth that lies under the belt stays under it (held between belt and body).
        band = (np.abs(U[:, 1] - yb) < h * 0.5) & (r0 < 0.45) & ~pin
        P[band, 1] = np.clip(P[band, 1], yb - h * 0.5, yb + h * 0.5)
        lim = polar(Rg, a) * (1 - t) + polar(Rt, a) * t
        over = band & (r > lim)
        s = np.where(over, lim / np.maximum(r, 1e-9), 1.0)
        P[:, 0] = c[0] + (P[:, 0] - c[0]) * s
        P[:, 2] = c[1] + (P[:, 2] - c[1]) * s
        # Out of the body (3 mm of clearance), only where the skin is the closest thing.
        pen = np.einsum('ij,ij->i', P - q, n) - 0.003
        # (Only about the belt: elsewhere the authored drape is left as it was fitted.)
        hit = (pen < 0) & (np.linalg.norm(P - q, axis=1) < 0.05) & (dist < 0.2)
        P[hit] -= n[hit] * pen[hit][:, None]
        P[pin] = U[pin]
    l = np.linalg.norm(P[E[:, 0]] - P[E[:, 1]], axis=1)
    # Relative change, judged in absolute terms (per cm) on sub-centimetre edges.
    strain = (l - L0) / np.maximum(L0, 0.01)
    disp = np.linalg.norm(P - U, axis=1)
    # Triangle area change and flips (against the original normals).
    def areas(X):
        return np.cross(X[F[:, 1]] - X[F[:, 0]], X[F[:, 2]] - X[F[:, 0]])
    A0, A1 = areas(U), areas(P)
    flips = int((np.einsum('ij,ij->i', A0, A1) < 0).sum())
    da = np.linalg.norm(A1, axis=1) / np.maximum(np.linalg.norm(A0, axis=1), 1e-12) - 1
    per = []
    for loop in boundary_loops(F):
        if len(loop) > 5:
            L = np.array(loop + [loop[0]])
            p0 = np.linalg.norm(np.diff(U[L], axis=0), axis=1).sum()
            p1 = np.linalg.norm(np.diff(P[L], axis=0), axis=1).sum()
            per.append(abs(p1 / p0 - 1))
    stats = dict(edges=int(len(E)), perimeter_max=float(max(per) if per else 0), strain_p50=float(np.percentile(np.abs(strain), 50)), strain_p99=float(np.percentile(np.abs(strain), 99)),
                 strain_max=float(np.abs(strain).max()), area_p99=float(np.percentile(np.abs(da), 99)), flips=flips,
                 moved_max_cm=float(disp.max() * 100), drawn_in_cm=float(max(0.0, narrow) * 100),
                 band_radius_after_cm=float(np.hypot(P[np.abs(P[:, 1] - yb) < h * 0.4, 0] - c[0], P[np.abs(P[:, 1] - yb) < h * 0.4, 2] - c[1]).max() * 100) if (np.abs(P[:, 1] - yb) < h * 0.4).any() else 0)
    return rep, P, F, stats, Rt, c


def tube_ring(path, radius, h, t, round_, segs):
    """A closed band round `path` (n x 3, closed loop), outward normals in xz."""
    n = len(path)
    V, Fs, UV = [], [], []
    prof = ([(np.cos(a) * t / 2, np.sin(a) * h / 2) for a in np.linspace(0, 2 * np.pi, 8, endpoint=False)] if round_
            else [(-t / 2, -h / 2), (t / 2, -h / 2), (t / 2, h / 2), (-t / 2, h / 2)])
    m = len(prof)
    for i in range(n):
        p = path[i]
        tang = path[(i + 1) % n] - path[i - 1]
        out = np.cross(tang, [0, 1, 0]); out[1] = 0
        out /= np.linalg.norm(out) + 1e-12
        for j, (o, y) in enumerate(prof):
            V.append(p + out * (o + t / 2) + np.array([0, y, 0]))
            UV.append((i / n * 8, j / m))
    for i in range(n):
        for j in range(m):
            a, b = i * m + j, i * m + (j + 1) % m
            c, d = ((i + 1) % n) * m + j, ((i + 1) % n) * m + (j + 1) % m
            Fs += [(a, c, b), (b, c, d)]
    return np.array(V), np.array(Fs), np.array(UV, float)


def strip(points, outs, width, t, round_):
    """A hanging end: a flat strap (or a round cord) down a polyline, offset outward."""
    V, Fs, UV = [], [], []
    k = len(points)
    prof = ([(np.cos(a) * width / 2, np.sin(a) * width / 2) for a in np.linspace(0, 2 * np.pi, 6, endpoint=False)] if round_
            else [(-width / 2, 0), (width / 2, 0), (width / 2, t), (-width / 2, t)])
    m = len(prof)
    for i in range(k):
        down = points[min(i + 1, k - 1)] - points[max(i - 1, 0)]
        down /= np.linalg.norm(down) + 1e-12
        o = outs[i]
        side = np.cross(down, o); side /= np.linalg.norm(side) + 1e-12
        for (x, z) in prof:
            V.append(points[i] + side * x + o * (z + (width / 2 if round_ else 0)))
            UV.append((i / k * 3, x))
    for i in range(k - 1):
        for j in range(m):
            a, b = i * m + j, i * m + (j + 1) % m
            c, d = (i + 1) * m + j, (i + 1) * m + (j + 1) % m
            Fs += [(a, c, b), (b, c, d)]
    # Close the end.
    base = (k - 1) * m
    for j in range(1, m - 1):
        Fs.append((base, base + j, base + j + 1))
    return np.array(V), np.array(Fs), np.array(UV, float)


def outward(V, F, center_xz):
    """Wind each triangle so its normal points away from the vertical axis through center."""
    n = np.cross(V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]])
    mid = V[F].mean(1)
    r = mid - np.array([center_xz[0], mid[:, 1].mean() * 0, center_xz[1]])
    r[:, 1] = 0
    bad = np.einsum('ij,ij->i', n, r) < 0
    F = F.copy()
    F[bad] = F[bad][:, [0, 2, 1]]
    return F


def facing(m, rep, U, F, loops, t=0.004, w=0.025):
    """Turned-in facings for the given boundary loops of a garment (welded ids)."""
    N = vertex_normals(U, F)
    nb = {}
    for f in F:
        for k in range(3):
            nb.setdefault(f[k], set()).update(f)
    first = {}
    for i, r in enumerate(rep):
        first.setdefault(r, i)
    V, Fs, UV, src = [], [], [], []
    for loop in loops:
        L = list(loop)
        n = len(L)
        if n < 6:
            continue
        closed = np.linalg.norm(U[L[0]] - U[L[-1]]) < 0.03
        base = len(V)
        bset = set(L)
        for v in L:
            p, nv = U[v], N[v]
            inner = [u for u in nb[v] if u not in bset]
            d = (U[inner].mean(0) - p) if inner else -nv
            d -= nv * d.dot(nv)
            d /= np.linalg.norm(d) + 1e-12
            for q in (p - nv * 0.0005, p - nv * t, p - nv * t + d * w):
                V.append(q); UV.append(m['UV'][first[v]]); src.append(first[v])
        segs = n if closed else n - 1
        for i in range(segs):
            j = (i + 1) % n
            for s in range(2):
                a, b = base + i * 3 + s, base + i * 3 + s + 1
                c, d = base + j * 3 + s, base + j * 3 + s + 1
                Fs += [(a, c, b), (b, c, d)]
    if not V:
        return None
    V = np.array(V); Fs = np.array(Fs)
    # Rim faces turned up and out (away from the cloth), the facing towards the body (against the cloth's normal).
    src = np.array(src)
    Nsrc = vertex_normals(U, F)[rep[src]]
    fn = np.cross(V[Fs[:, 1]] - V[Fs[:, 0]], V[Fs[:, 2]] - V[Fs[:, 0]])
    want = -Nsrc[Fs[:, 0]]
    bad = np.einsum('ij,ij->i', fn, want) < 0
    # (The rim strip, between the first two rings, is judged the same way: it is seen from inside the opening.)
    Fs[bad] = Fs[bad][:, [0, 2, 1]]
    return dict(P=V, F=Fs, UV=np.array(UV), src=src)


def build(src, out, body_id, log=print):
    g = Gltf(os.path.join(src, body_id + '.json'))
    meta = g.meta()
    if meta.get('npc3'):
        raise SystemExit(f'{body_id}: already processed (npc3 v{meta["npc3"]["version"]}); give the pristine source')
    names = g.joints()
    nj = len(names)
    B = bind_bones(g)
    body = Body(g, nj)
    trunk_bones = [names.index(n) for n in ('Hips', 'Spine', 'Spine1', 'Spine2', 'LeftUpLeg', 'RightUpLeg') if n in names]
    trunk = body.D[:, trunk_bones].sum(1) > 0.5
    report = {'body': body_id, 'garments': {}}
    belts_meta = {}
    yb_default = B['Hips'][1] + 0.55 * (B['Spine1'][1] - B['Hips'][1])
    for gid, spec in BELTS.items():
        if gid not in meta['garments']:
            continue
        m = g.mesh('G_' + gid)
        yb = yb_default
        if gid == 'shirt' and 'belt' in meta['garments']:
            # Where the authored belt was fitted (its densest band).
            bp = g.mesh('G_belt')['P']
            hist, edges_ = np.histogram(bp[:, 1], bins=np.arange(yb - 0.2, yb + 0.2, 0.01))
            yb = edges_[hist.argmax()] + 0.005
        widest = max(STYLE[s]['h'] for s in spec['styles'])
        arm_ids = [i for i, n in enumerate(names) if any(k in n for k in ('Arm', 'Hand', 'Shoulder'))]
        arm_w = dense_weights(m['J'], m['W'], nj)[:, arm_ids].sum(1)
        # The belt drawn in as far as the cloth allows without changing its dimensions:
        # the tightest of a few settings whose strain passes.
        for alpha in ALPHAS:
            rep, P, F, st, Rt, c = cinch(m, body, B, yb, widest + 0.006, trunk, arm_w, alpha=alpha)
            st['alpha'] = alpha
            log(f'{body_id} {gid}: cinch at y={yb:.3f}', json.dumps({k: round(v, 4) if isinstance(v, float) else v for k, v in st.items()}))
            if st['strain_p99'] <= STRAIN_P99 and st['strain_max'] <= STRAIN_MAX and st['perimeter_max'] <= PERIMETER_MAX:
                break
        else:
            raise SystemExit(f'{body_id} {gid}: no cinch within the strain limits')
        # Skin: cloth under and next to the belt follows the body's skin there.
        D = dense_weights(m['J'], m['W'], nj)
        Pv = P[rep]
        _, nearest = body.tree.query(Pv)
        s = (1 - smooth(np.abs(Pv[:, 1] - yb), widest * 0.5 + 0.01, 0.09))[:, None]
        D = D * (1 - s) + body.D[nearest] * s
        J, W = top4(D)
        Nw = vertex_normals(P, F)[rep]
        m2 = dict(m, P=Pv, N=Nw, J=J, W=W)
        # Necklines and cuffs: loops above the waist.
        loops = boundary_loops(F)
        top = [l for l in loops if P[l][:, 1].max() > B['Spine2'][1]]
        fc = facing(m2, rep, P, F, top)
        if fc is not None:
            base = len(m2['P'])
            Dsrc = dense_weights(m2['J'], m2['W'], nj)[fc['src']]
            Jf, Wf = top4(Dsrc)
            m2 = dict(m2,
                      P=np.concatenate([m2['P'], fc['P']]), N=np.concatenate([m2['N'], vertex_normals(fc['P'], fc['F'])]),
                      UV=np.concatenate([m2['UV'], fc['UV']]), J=np.concatenate([m2['J'], Jf]), W=np.concatenate([m2['W'], Wf]),
                      HIDE=np.concatenate([m2['HIDE'], m2['HIDE'][fc['src']]]), F=np.concatenate([m2['F'], fc['F'] + base]))
            st['facing_loops'] = len(top); st['facing_tris'] = int(len(fc['F']))
        g.put_mesh('G_' + gid, m2)
        report['garments'][gid] = dict(st, belt_y=yb)
        # Belts for this garment.
        bins = len(Rt)
        a = np.linspace(0, 2 * np.pi, 64, endpoint=False)
        # The belt's inner face on the cinched cloth (its outer surface in the band).
        Rc = np.zeros(bins)
        ang = np.arctan2(P[:, 0] - c[0], P[:, 2] - c[1])
        rr = np.hypot(P[:, 0] - c[0], P[:, 2] - c[1])
        band = (np.abs(P[:, 1] - yb) < widest * 0.5) & (rr < 0.45)
        np.maximum.at(Rc, ((ang[band] / (2 * np.pi) * bins).round().astype(int)) % bins, rr[band])
        Rc = np.where(Rc > 0, Rc, Rt)
        Rc = np.array([Rc[[(i - 1) % bins, i, (i + 1) % bins]].max() for i in range(bins)])
        cloth_tree = cKDTree(Pv)
        Dg = dense_weights(m2['J'], m2['W'], nj)
        for style, bid in spec['styles'].items():
            S = STYLE[style]
            r = polar(Rc, a) + 0.0015
            path = np.stack([c[0] + np.sin(a) * r, np.full(len(a), yb), c[1] + np.cos(a) * r], 1)
            V, Fb, UV = tube_ring(path, r, S['h'], S['t'], S['round'], 64)
            parts = [(V, Fb, UV, 'ring')]
            # Hanging ends from the knot/buckle, down the front of the skirt.
            for (length, width, ang0) in S['ends']:
                k = 9
                ys = yb - np.linspace(0, length, k)
                pts, outs = [], []
                for y in ys:
                    # On the cloth: the outermost cloth point at that height and angle, plus a little.
                    sel = (np.abs(Pv[:, 1] - y) < 0.02)
                    aa = np.arctan2(Pv[sel, 0] - c[0], Pv[sel, 2] - c[1])
                    rs = np.hypot(Pv[sel, 0] - c[0], Pv[sel, 2] - c[1])
                    near_a = np.abs((aa - ang0 + np.pi) % (2 * np.pi) - np.pi) < 0.12
                    rad = (rs[near_a].max() if near_a.any() else polar(Rc, np.array([ang0]))[0]) + S['t'] + 0.002
                    if y == ys[0]:
                        rad = polar(Rc, np.array([ang0]))[0] + S['t'] + 0.002
                    o = np.array([np.sin(ang0), 0, np.cos(ang0)])
                    pts.append(np.array([c[0], y, c[1]]) + o * rad); outs.append(o)
                Vs, Fs_, UVs = strip(np.array(pts), outs, width, S['t'], S['round'])
                parts.append((Vs, Fs_, UVs, 'end'))
            if style in ('cord', 'sash'):
                # The knot: a small lump where the ends start.
                ang0 = S['ends'][0][2] * 0.5 + S['ends'][-1][2] * 0.5
                o = np.array([np.sin(ang0), 0, np.cos(ang0)])
                rad = polar(Rc, np.array([ang0]))[0] + S['t'] * 1.5
                ctr = np.array([c[0], yb, c[1]]) + o * rad
                kn = np.array([[np.cos(u) * np.cos(v), np.sin(v), np.sin(u) * np.cos(v)] for v in np.linspace(-1.2, 1.2, 4) for u in np.linspace(0, 2 * np.pi, 7, endpoint=False)])
                rad3 = np.array([S['h'] * 1.1 + 0.006, S['h'] * 0.9 + 0.006, S['t'] * 1.2 + 0.004])
                Vk = ctr + kn * rad3
                Fk = []
                for i in range(3):
                    for j in range(7):
                        a1, b1, c1, d1 = i * 7 + j, i * 7 + (j + 1) % 7, (i + 1) * 7 + j, (i + 1) * 7 + (j + 1) % 7
                        Fk += [(a1, c1, b1), (b1, c1, d1)]
                parts.append((Vk, np.array(Fk), np.zeros((len(Vk), 2)), 'knot'))
            Vall, Fall, UVall, Jall, Wall = [], [], [], [], []
            off = 0
            for (V, Fp, UV, kind) in parts:
                if kind == 'ring' or kind == 'knot':
                    _, nn = body.tree.query(V)
                    Dv = body.D[nn]
                else:
                    _, nn = cloth_tree.query(V)
                    Dv = Dg[nn]
                Jv, Wv = top4(Dv)
                Fp = outward(V, Fp, c) if kind != 'end' else Fp
                Vall.append(V); Fall.append(Fp + off); UVall.append(UV); Jall.append(Jv); Wall.append(Wv)
                off += len(V)
            V = np.concatenate(Vall); Fb = np.concatenate(Fall)
            # Strap ends: wound so that their faces look away from the cloth.
            bm = dict(P=V, F=Fb, UV=np.concatenate(UVall), J=np.concatenate(Jall), W=np.concatenate(Wall), HIDE=np.zeros(len(V)))
            bm['N'] = vertex_normals(V, Fb)
            node = 'G_' + bid
            if any(n['name'] == node for n in g.j['nodes']):
                g.put_mesh(node, bm)
            else:
                g.add_garment(bid, bm, like='G_' + gid)
            depth = meta['garments'].get('belt', {}).get('depth', 66)
            meta['garments'][bid] = {'fabric': S['fabric'], 'layer': 'belt', 'depth': depth, 'style': style}
            report['garments'][gid].setdefault('belts', {})[bid] = dict(style=style, tris=int(len(Fb)))
        belts_meta[gid] = {'default': spec['default'], 'styles': spec['styles']}
    # Outfits: every body garment now wears its default belt.
    for oid, o in meta['outfits'].items():
        gl = [x for x in o['garments'] if meta['garments'][x]['layer'] != 'belt']
        for x in list(gl):
            if x in belts_meta:
                gl.insert(gl.index(x) + 1, belts_meta[x]['default'])
        o['garments'] = gl
    meta['belts'] = belts_meta
    meta['npc3'] = {'version': VERSION}
    g.set_meta(meta)
    path = os.path.join(out, body_id + '.json')
    g.save(path)
    same = body_digest(os.path.join(src, body_id + '.json')) == body_digest(path)
    report['body_unchanged'] = same
    log(f'{body_id}: body, head and skin bit-identical: {same}; outfits', json.dumps({k: v['garments'] for k, v in meta['outfits'].items()}))
    if not same:
        raise SystemExit('body changed')
    return report


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    ids = sys.argv[3:] or ['m_young', 'm_mid', 'm_old', 'm_elder', 'w_young', 'w_mid']
    os.makedirs(out, exist_ok=True)
    reports = [build(src, out, b) for b in ids]
    json.dump(reports, open(os.path.join(out, 'wardrobe-build-report.json'), 'w'), indent=1)
