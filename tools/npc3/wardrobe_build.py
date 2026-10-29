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
STRAIN_P99 = 0.03
STRAIN_MAX = 0.20
PERIMETER_MAX = 0.01
ALPHAS = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6]
VERSION = 2

# Per body garment: which belts are made for it, and the default.
BELTS = {
    'shirt':    {'default': 'belt', 'styles': {'leather': 'belt'}},
    'tunic':    {'default': 'belt_tunic', 'styles': {'leather': 'belt_tunic', 'cord': 'cord_tunic'}},
    'longrobe': {'default': 'belt_robe', 'styles': {'leather': 'belt_robe', 'cord': 'cord_robe', 'sash': 'sash_robe'}},
    'robe':     {'default': 'rope', 'styles': {'cord': 'rope'}},
    # The gown's bodice is cut fitted to the waist: the girdle is tied over it, nothing drawn in.
    'gown':     {'default': 'girdle', 'styles': {'sash': 'girdle'}, 'fitted': True},
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
        # A strap under tension spans the hollows (the small of the back): the
        # section's convex hull, as a radius per angle.
        from scipy.spatial import ConvexHull
        X = np.stack([Q[:, 0] - c[0], Q[:, 2] - c[1]], 1)
        H = X[ConvexHull(X).vertices]
        H = np.vstack([H, H[:1]])
        ang = np.arange(bins) / bins * 2 * np.pi
        d = np.stack([np.sin(ang), np.cos(ang)], 1)
        for i, u in enumerate(d):
            best = 0
            for p0, p1 in zip(H[:-1], H[1:]):
                # Ray from the centre along u against the hull edge p0-p1.
                e = p1 - p0
                den = u[0] * (-e[1]) - u[1] * (-e[0])
                if abs(den) < 1e-12:
                    continue
                t = (p0[0] * (-e[1]) - p0[1] * (-e[0])) / den
                sgm = (u[0] * p0[1] - u[1] * p0[0]) / den
                if t > 0 and -1e-9 <= sgm <= 1 + 1e-9:
                    best = max(best, t)
            R[i] = max(R[i], best)
        return R


def polar(R, a):
    bins = len(R)
    f = (a / (2 * np.pi) * bins) % bins
    i = np.floor(f).astype(int) % bins
    j = (i + 1) % bins
    return R[i] * (1 - (f - i % bins)) + R[j] * (f - i % bins)


def cinch(m, body, B, yb, h, trunk, arm_w, iters=1500, gap=0.015, alpha=0.0, fitted=False, log=print):
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
    near = (np.abs(U[:, 1] - yb) < max(h * 0.5, 0.03)) & (r0 < 0.4) & (arm < 0.3)
    # The cloth's own radius in the band, per angle (its outer surface).
    bins = len(Rb)
    Rg = np.zeros(bins)
    kk = ((a0[near] / (2 * np.pi) * bins).round().astype(int)) % bins
    np.maximum.at(Rg, kk, r0[near])
    # Angles with no cloth vertex nearby: interpolated round the circle.
    have = np.nonzero(Rg > 0)[0]
    Rg = np.interp(np.arange(bins), np.concatenate([have - bins, have, have + bins]), np.tile(Rg[have], 3))
    # How far in the belt is drawn: to the body plus the gathered cloth (alpha 0), or less.
    Rt = Rb + gap + alpha * np.maximum(0, Rg - Rb - gap)
    # At the back the cloth hangs straight from the shoulder blades: drawing it
    # into the small of the back would need more length than it has (the
    # garment would have to ride up). The belt bridges the hollow there.
    ang = np.arange(bins) / bins * 2 * np.pi
    draw = 0.012 + 0.03 * (0.5 + 0.5 * np.cos(ang))
    Rt = np.maximum(Rt, Rg - draw)
    # Fixed: the shoulders and everything that hangs from the arms (sleeves).
    # A garment already fitted at the waist (a gown's bodice) is not drawn in: the girdle lies on it.
    fitted = fitted or float(np.mean(Rg - (Rb + gap) > 0.01)) < 0.25
    if fitted:
        Rt = np.maximum(Rg, Rb + gap)
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
    A0u = np.cross(U[F[:, 1]] - U[F[:, 0]], U[F[:, 2]] - U[F[:, 0]])
    for it in range(0 if fitted else iters):
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
        # No triangle may be turned over by the gathering: where one turns
        # past ~80 degrees, its corners are eased back towards the authored
        # shape and the solve goes on.
        if it % 5 == 0:
            A1 = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
            bad = np.einsum('ij,ij->i', A0u, A1) < 0.2 * np.einsum('ij,ij->i', A0u, A0u)
            if bad.any():
                v = np.unique(F[bad])
                P[v] = 0.7 * P[v] + 0.3 * U[v]
    if fitted:
        P = U.copy()
    else:
        P = untangle(P, U, F, E, L0, cnt, free, pin)
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
    stats = dict(fitted=fitted, edges=int(len(E)), perimeter_max=float(max(per) if per else 0), strain_p50=float(np.percentile(np.abs(strain), 50)), strain_p99=float(np.percentile(np.abs(strain), 99)),
                 strain_max=float(np.abs(strain).max()), area_p99=float(np.percentile(np.abs(da), 99)), flips=flips,
                 moved_max_cm=float(disp.max() * 100), drawn_in_cm=float(max(0.0, narrow) * 100),
                 band_radius_after_cm=float(np.hypot(P[np.abs(P[:, 1] - yb) < h * 0.4, 0] - c[0], P[np.abs(P[:, 1] - yb) < h * 0.4, 2] - c[1]).max() * 100) if (np.abs(P[:, 1] - yb) < h * 0.4).any() else 0)
    return rep, P, F, stats, Rt, c


def untangle(P, U, F, E, L0, cnt, free, pin, rounds=400):
    """No triangle may end the solve turned over: a back-facing triangle is
    culled at run time and leaves a hole in the cloth. Each round, the
    vertices of every triangle that is turned over, or turned past ~84
    degrees from its authored normal, and their neighbours, are eased back
    towards the authored shape, then the edge lengths are projected again.
    Stops when none is left (or after `rounds`)."""
    A0 = np.cross(U[F[:, 1]] - U[F[:, 0]], U[F[:, 2]] - U[F[:, 0]])
    a0 = np.einsum('ij,ij->i', A0, A0)
    nb = [[] for _ in range(len(U))]
    for a, b in E:
        nb[a].append(b); nb[b].append(a)
    for _ in range(rounds):
        A1 = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
        bad = np.einsum('ij,ij->i', A0, A1) < 0.1 * a0 ** 0.5 * np.linalg.norm(A1, axis=1)
        if not bad.any():
            break
        v = set(np.unique(F[bad]).tolist())
        for x in list(v):
            v.update(nb[x])
        v = np.array(sorted(v))
        P[v] = 0.6 * P[v] + 0.4 * U[v]
        for _ in range(3):
            corr = np.zeros_like(P)
            dv = P[E[:, 1]] - P[E[:, 0]]
            l = np.linalg.norm(dv, axis=1)
            k = ((l - L0) / np.maximum(l, 1e-9))[:, None] * dv * 0.5
            np.add.at(corr, E[:, 0], k); np.add.at(corr, E[:, 1], -k)
            P += corr / cnt[:, None] * free[:, None]
        P[pin] = U[pin]
    return P


def tube_ring(path, radius, h, t, round_, segs):
    """A closed band round `path` (n x 3, closed loop), outward normals in xz."""
    n = len(path)
    V, Fs, UV = [], [], []
    prof = ([(np.cos(a) * t / 2, np.sin(a) * h / 2) for a in np.linspace(0, 2 * np.pi, 6, endpoint=False)] if round_
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
    prof = ([(np.cos(a) * width / 2, np.sin(a) * width / 2) for a in np.linspace(0, 2 * np.pi, 5, endpoint=False)] if round_
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


REACH, EDGE, CAPE_GAP = 0.30, 0.10, 0.06


def ray_hits(O, Dn, V, F, reach):
    """For each ray (origin O, unit dir Dn), whether it meets a triangle of (V, F) within reach (Moller-Trumbore)."""
    hit = np.zeros(len(O), bool)
    v0, e1, e2 = V[F[:, 0]], V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]
    for s0 in range(0, len(O), 64):
        o, d = O[s0:s0 + 64, None, :], Dn[s0:s0 + 64, None, :]
        pv = np.cross(d, e2[None])
        det = np.einsum('ijk,jk->ij', pv, e1)
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
        tv = o - v0[None]
        u = np.einsum('ijk,ijk->ij', tv, pv) * inv
        qv = np.cross(tv, e1[None])
        v = np.einsum('ijk,ijk->ij', d, qv) * inv
        t = np.einsum('ijk,jk->ij', qv, e2) * inv
        h = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0.002) & (t < reach)
        hit[s0:s0 + 64] = h.any(1)
    return hit


def add_hidden(g, meta, names, B):
    bnode = [n['name'] for n in g.j['nodes'] if n['name'].endswith('.body')][0]
    b = g.mesh(bnode, 0)
    rep_b, Ub = weld(b['P'])
    N = vertex_normals(Ub, rep_b[b['F']])[rep_b]
    neck_y = B['Neck'][1] - 0.06
    H = b['HIDE'].astype(np.int64)
    added = {}
    # Shins under a long skirt are shown again (tools/npc2/hide.py hid them):
    # when the skirt swings up in the stride, a hidden shin leaves the shoe
    # standing empty with slivers of skin. The skirt is kept off the shins at
    # run time by the leg capsules of src/npc2/push.ts instead. Skin inside
    # the shoe (below its top, less 1 cm) stays hidden.
    J = b['J'].astype(int); W = b['W']
    main = J[np.arange(len(J)), W.argmax(1)]
    shin_ids = [i for i, n in enumerate(names) if n.endswith('Leg') and not n.endswith('UpLeg')]
    shin = np.isin(main, shin_ids)
    shown = {}
    for oid, o in meta['outfits'].items():
        if not any(x in ('gown', 'robe', 'longrobe') for x in o['garments']):
            continue
        tops = [g.mesh('G_' + x)['P'][:, 1].max() for x in o['garments'] if x in ('shoes', 'boots')]
        top = (min(tops) if tops else 0.0) - 0.01
        sel = shin & (b['P'][:, 1] > top) & ((H >> o['bit']) & 1 == 1)
        H[sel] &= ~(1 << o['bit'])
        shown[oid] = int(sel.sum())
    added['shins_shown'] = shown
    for oid, o in meta['outfits'].items():
        bit = o['bit']
        long_skirt = any(x in ('gown', 'robe', 'longrobe') for x in o['garments'])
        gl = [x for x in o['garments'] if meta['garments'][x]['layer'] in ('tunic', 'over')]
        if not gl:
            continue
        Vs, Fs, edge_pts, off = [], [], [], 0
        for x in gl:
            m = g.mesh('G_' + x)
            rep, U = weld(m['P'])
            F = rep[m['F']]
            Vs.append(U); Fs.append(F + off); off += len(U)
            for loop in boundary_loops(F):
                edge_pts.append(U[loop])
        V = np.concatenate(Vs); F = np.concatenate(Fs)
        edge = cKDTree(np.concatenate(edge_pts)) if edge_pts else None
        cand = np.nonzero(((H >> bit) & 1 == 0) & (b['P'][:, 1] < neck_y) & ~(shin & long_skirt))[0]
        if edge is not None:
            d, _ = edge.query(b['P'][cand])
            cand = cand[d > EDGE]
        if not len(cand):
            continue
        hit = ray_hits(b['P'][cand], N[cand], V, F, REACH)
        new = cand[hit]
        H[new] |= (1 << bit)
        added[oid] = int(len(new))
    g.set_attr(bnode, 0, '_HIDE', H.astype(np.float32), 5126, 'SCALAR')
    # Under a hood's shoulder cape or a cowl (skinned to the trunk, no spring
    # bones, so it never swings open), the tunic's shoulders are covered for
    # good: hidden there, as hide.py does for skin, so the tunic cannot poke
    # through the cape when the shoulders move. Only well inside the cape
    # (EDGE from its edges) and close under it (CAPE_GAP).
    for oid, o in meta['outfits'].items():
        bit = o['bit']
        capes = [x for x in o['garments'] if x in ('hood', 'cowl') and not meta['garments'][x].get('chains')]
        if not capes:
            continue
        Vs, Fs, edge_pts, off = [], [], [], 0
        for x in capes:
            m = g.mesh('G_' + x)
            rep, U = weld(m['P']); F = rep[m['F']]
            Vs.append(U); Fs.append(F + off); off += len(U)
            for loop in boundary_loops(F):
                edge_pts.append(U[loop])
        V = np.concatenate(Vs); F = np.concatenate(Fs)
        edge = cKDTree(np.concatenate(edge_pts)) if edge_pts else None
        for x in o['garments']:
            if meta['garments'][x]['layer'] != 'tunic':
                continue
            m = g.mesh('G_' + x)
            rep, U = weld(m['P'])
            Nw = vertex_normals(U, rep[m['F']])[rep]
            Hm = m['HIDE'].astype(np.int64)
            cand = np.nonzero(((Hm >> bit) & 1 == 0) & (m['P'][:, 1] > B['Spine1'][1]))[0]
            if edge is not None and len(cand):
                dd, _ = edge.query(m['P'][cand])
                cand = cand[dd > EDGE * 0.8]
            if not len(cand):
                continue
            hit = ray_hits(m['P'][cand], Nw[cand], V, F, CAPE_GAP)
            Hm[cand[hit]] |= (1 << bit)
            added[f'{oid}:{x}'] = int(hit.sum())
            g.set_attr('G_' + x, 0, '_HIDE', Hm.astype(np.float32), 5126, 'SCALAR')
    return added


def garment_hide_fix(g, meta, B, min_tris=6):
    """Garment triangles that an outfit hides (tools/npc2/hide.py): those under
    a cloak are shown again below the shoulder blades, because the cloak
    swings open there in the walk and a hidden robe leaves the legs bare; and
    isolated specks of hidden triangles (fewer than `min_tris` connected), which are holes
    in plain view, are shown again."""
    done = {}
    for x, gm in meta['garments'].items():
        node = 'G_' + x
        if not any(n['name'] == node for n in g.j['nodes']):
            continue
        m = g.mesh(node)
        H = m['HIDE'].astype(np.int64)
        H0 = H.copy()
        F = m['F']
        for oid, o in meta['outfits'].items():
            if x not in o['garments']:
                continue
            bit = 1 << o['bit']
            if 'cloak' in o['garments'] and gm['layer'] == 'tunic':
                H[(m['P'][:, 1] < B['Spine1'][1])] &= ~bit
            hidden = np.nonzero(((H[F] & bit) != 0).all(1))[0]
            if not len(hidden):
                continue
            # Connected groups of hidden triangles (through shared corners, welded by position).
            rep, _ = weld(m['P'])
            parent = {int(t): int(t) for t in hidden}
            def find(a):
                while parent[a] != a:
                    parent[a] = parent[parent[a]]; a = parent[a]
                return a
            first = {}
            for t in hidden:
                for v in rep[F[t]]:
                    v = int(v)
                    if v in first:
                        ra, rb = find(int(t)), find(first[v])
                        if ra != rb:
                            parent[ra] = rb
                    else:
                        first[v] = int(t)
            groups = {}
            for t in hidden:
                groups.setdefault(find(int(t)), []).append(int(t))
            for ts in groups.values():
                if len(ts) < min_tris:
                    H[np.unique(F[ts])] &= ~bit
        changed = int((H != H0).sum())
        if changed:
            g.set_attr(node, 0, '_HIDE', H.astype(np.float32), 5126, 'SCALAR')
            done[x] = changed
    return done


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
    report = {'body': body_id, 'garments': {}, 'seams': {}}
    # Seams closed: a garment's vertices split along a texture seam (same
    # place, different UVs) must move together, or the cloth opens along the
    # seam when the joints bend (the gown's front split in the walk). Each
    # such group gets one skin, the mean of its members'.
    for gid in meta['garments']:
        node = 'G_' + gid
        if not any(n['name'] == node for n in g.j['nodes']):
            continue
        m = g.mesh(node)
        rep, U = weld(m['P'])
        D = dense_weights(m['J'], m['W'], nj)
        S = np.zeros((len(U), nj)); cnt = np.zeros(len(U))
        np.add.at(S, rep, D); np.add.at(cnt, rep, 1)
        Dm = S[rep] / cnt[rep][:, None]
        differ = int((np.abs(Dm - D).max(1) > 1e-3).sum())
        if differ:
            J, W = top4(Dm)
            g.put_mesh(node, dict(m, J=J, W=W))
        report['seams'][gid] = differ
    log(f'{body_id}: seam vertices re-skinned', json.dumps(report['seams']))
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
            rep, P, F, st, Rt, c = cinch(m, body, B, yb, widest + 0.006, trunk, arm_w, alpha=alpha, fitted=spec.get('fitted', False))
            st['alpha'] = alpha
            log(f'{body_id} {gid}: cinch at y={yb:.3f}', json.dumps({k: round(v, 4) if isinstance(v, float) else v for k, v in st.items()}))
            if st['strain_p99'] <= STRAIN_P99 and st['strain_max'] <= STRAIN_MAX and st['perimeter_max'] <= PERIMETER_MAX and st['flips'] == 0:
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
        a = np.linspace(0, 2 * np.pi, 40, endpoint=False)
        # The belt's inner face on the cinched cloth (its outer surface in the band).
        Rc = np.zeros(bins)
        ang = np.arctan2(P[:, 0] - c[0], P[:, 2] - c[1])
        rr = np.hypot(P[:, 0] - c[0], P[:, 2] - c[1])
        armU = np.zeros(len(P)); armU[rep] = arm_w
        band = (np.abs(P[:, 1] - yb) < widest * 0.5) & (rr < 0.45) & (armU < 0.3)
        np.maximum.at(Rc, ((ang[band] / (2 * np.pi) * bins).round().astype(int)) % bins, rr[band])
        Rc = np.where(Rc > 0, Rc, Rt)
        Rc = np.array([Rc[[(i - 1) % bins, i, (i + 1) % bins]].max() for i in range(bins)])
        trunk_cloth = arm_w < 0.3  # not the sleeves (in the bind pose the hands hang at belt height)
        cloth_tree = cKDTree(Pv[trunk_cloth])
        Dg_trunk_index = np.nonzero(trunk_cloth)[0]
        Dg = dense_weights(m2['J'], m2['W'], nj)
        band_idx = np.nonzero((np.abs(Pv[:, 1] - yb) < widest * 0.5 + 0.01) & trunk_cloth)[0]
        band_tree = cKDTree(Pv[band_idx])
        for style, bid in spec['styles'].items():
            S = STYLE[style]
            r = polar(Rc, a) + 0.003
            path = np.stack([c[0] + np.sin(a) * r, np.full(len(a), yb), c[1] + np.cos(a) * r], 1)
            V, Fb, UV = tube_ring(path, r, S['h'], S['t'], S["round"], 40)
            parts = [(V, Fb, UV, 'ring')]
            # Hanging ends from the knot/buckle, down the front of the skirt.
            for (length, width, ang0) in S['ends']:
                k = 9
                ys = yb - np.linspace(0, length, k)
                pts, outs = [], []
                for y in ys:
                    # On the cloth: the outermost cloth point at that height and angle, plus a little.
                    sel = (np.abs(Pv[:, 1] - y) < 0.02) & trunk_cloth
                    aa = np.arctan2(Pv[sel, 0] - c[0], Pv[sel, 2] - c[1])
                    rs = np.hypot(Pv[sel, 0] - c[0], Pv[sel, 2] - c[1])
                    near_a = np.abs((aa - ang0 + np.pi) % (2 * np.pi) - np.pi) < 0.12
                    rad = (rs[near_a].max() if near_a.any() else polar(Rc, np.array([ang0]))[0]) + S['t'] + 0.002
                    if y == ys[0]:
                        rad = polar(Rc, np.array([ang0]))[0] + S['t'] + 0.002
                    o = np.array([np.sin(ang0), 0, np.cos(ang0)])
                    pts.append(rad); outs.append(o)
                # It hangs: never in nearer than the knot, over the folds it
                # meets (the max of each point and its neighbours), smoothed,
                # so it does not zigzag in and out of the pleats.
                rad = np.maximum(np.array(pts), pts[0])
                rad = np.maximum.reduce([rad, np.r_[rad[1:], rad[-1]], np.r_[rad[0], rad[:-1]]])
                rad = np.maximum(rad, np.convolve(np.r_[rad[0], rad, rad[-1]], [0.25, 0.5, 0.25], 'valid'))
                pts = [np.array([c[0], y, c[1]]) + o * r_ for y, o, r_ in zip(ys, outs, rad)]
                Vs, Fs_, UVs = strip(np.array(pts), outs, width, S['t'], S['round'])
                parts.append((Vs, Fs_, UVs, ('end', np.array(pts), len(Vs) // len(pts))))
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
                    # The skin of the cloth it lies on (the band, itself skinned
                    # like the body there), so belt and cloth move as one and
                    # the gathered cloth cannot come out over the strap.
                    _, nn = band_tree.query(V, k=4)
                    Dv = Dg[band_idx[nn]].mean(1)
                else:
                    # One skin per cross-section (the cloth under the path
                    # point, averaged over its six nearest cloth vertices), so
                    # the strap keeps its section as it swings.
                    _, path_pts, per = kind
                    _, nn = cloth_tree.query(path_pts, k=6)
                    Dr = Dg[Dg_trunk_index[nn]].mean(1)
                    Dv = np.repeat(Dr, per, axis=0)
                    kind = 'end'
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
    # Hidden skin: body vertices well under a long garment that tools/npc2/hide.py
    # left visible (a strip down the front of the shin under a gown pokes
    # through the skirt as the leg strides). A vertex is added to an outfit's
    # hidden set when the ray out along its normal meets one of the outfit's
    # body garments within REACH and it lies more than EDGE from every open
    # edge (hem, cuff, neckline) of those garments. Only ever adds; never the
    # head or the neck (the accepted face is untouched).
    hidden_added = add_hidden(g, meta, names, B)
    report['hidden_added'] = hidden_added
    log(f'{body_id}: body vertices newly hidden per outfit', json.dumps(hidden_added))
    shown = garment_hide_fix(g, meta, B)
    report['garment_vertices_shown'] = shown
    log(f'{body_id}: garment vertices shown again', json.dumps(shown))
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
