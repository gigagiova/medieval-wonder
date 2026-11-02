"""
Track B townsfolk (`?npc=b`): every outfit baked offline into one closed
surface with one skin-weight field, so nothing is fitted, hidden or pushed at
run time (no spring bones, no capsule pushes, no hide masks).

    python3 tools/npcb/bake.py <src_dir> <out_dir> [body ...]

<src_dir> is public/models/npc2 (the shipped v2 bodies, with their belts and
facings from tools/npc3/wardrobe_build.py); the results go to
<out_dir>/<body>.json with the same webp images (copied by the caller, or
referenced by the same names). For each body and each outfit (each set of
garments the population can wear; cloaks are left off, see the README):

1. Outward. Every connected piece of every garment is wound and shaded to
   face away from the body (judged against the normal of the nearest body
   point, area-weighted over the piece).
2. One weight field. Each garment vertex takes the body's skin weights:
   where the cloth lies on the body (within 2 cm, fading out by 8 cm) from
   the nearest body points; elsewhere the weights are inpainted, harmonic
   over the cloth with the near points fixed ("Robust Skin Weights Transfer
   via Weight Inpainting", Abdrashitov et al., SIGGRAPH Asia 2023). A skirt
   below the crotch is shared between the two legs by its distance to each
   (a point on the left of the skirt follows the left leg, the middle both
   halves), then smoothed over the cloth. Cloth bones and fingers are not
   used. The body's own weights are never changed (the faces stay exact).
3. Visible surface only. A vertex of the skin or of an inner garment is
   covered when five rays from it (its normal and four 35 degrees round it)
   all meet a garment worn over it within 30 cm; a triangle is dropped when
   its three corners are covered. Rays escape through every opening, so the
   skin and inner cloth near necklines, cuffs and hems stay (they move with
   the same weights as the cloth over them). Specks of fewer than six
   dropped triangles are kept.
4. Thick hems. Every open edge of a garment (hem, cuff, neckline, the inner
   edge of a facing) gets a turned-in band: the cloth within 6 cm of the
   edge copied 4 mm inward, wound inward, joined to the edge by a rim, so the
   garment is a closed shell there and no edge is paper-thin or see-through
   when drawn single-sided.

The skin, head and eye vertex data is copied byte for byte (only the skin's
triangle list differs per outfit). Each outfit is written as its own nodes
`body|<outfit>` and `G_<garment>|<outfit>`, sharing the vertex data; the
outfit name is its garments, sorted, joined by '+'.
"""
import json, os, sys, time
import numpy as np
from scipy import sparse
from scipy.spatial import cKDTree
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'npc3'))
from gltfio import Gltf
from meshops import weld, vertex_normals, dense_weights, top4

NEAR, FAR = 0.02, 0.08         # weight transfer: trusted within NEAR, inpainted beyond FAR
REACH, TILT = 0.30, np.radians(35)
BAND, THICK = 0.06, 0.004      # turned-in band at open edges
LEG_SIGMA = 0.05               # (unused since v2 of the skirt field)
SKIRT_SIGMA = 0.09             # skirt shared between the legs: softness (m)
LEG_AT_HEM = 0.7               # how much the hem follows the legs (the rest: the pelvis)
LAYER_NEAR = 0.025             # cloth within this of other cloth takes its weights
MIN_SPECK = 6


def sub_bones(names):
    """Allowed bones and where the others go: fingers to the hand, ends to their parent, no cloth bones."""
    m = {}
    for i, n in enumerate(names):
        if n.startswith('cb_'):
            m[i] = None
        elif 'Hand' in n and n not in ('LeftHand', 'RightHand'):
            m[i] = names.index('LeftHand' if n.startswith('Left') else 'RightHand')
        elif n == 'HeadTop_End':
            m[i] = names.index('Head')
        elif n.endswith('Toe_End'):
            m[i] = names.index(n.replace('Toe_End', 'ToeBase'))
        else:
            m[i] = i
    return m


def remap_dense(D, m):
    out = np.zeros_like(D)
    for i, j in m.items():
        if j is not None:
            out[:, j] += D[:, i]
    s = out.sum(1, keepdims=True)
    return out / np.maximum(s, 1e-12)


def adjacency(F, n):
    E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    A = sparse.coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(n, n)).tocsr()
    A = ((A + A.T) > 0).astype(float)
    deg = np.asarray(A.sum(1)).ravel()
    return sparse.diags(1 / np.maximum(deg, 1)) @ A


def components(F, n):
    E = np.concatenate([F[:, [0, 1]], F[:, [1, 2]]])
    A = sparse.coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(n, n))
    from scipy.sparse.csgraph import connected_components
    return connected_components(A, directed=False)[1]


def ray_hits(O, Dn, V, F, reach):
    """Whether each ray meets a triangle of (V, F) within reach (Moller-Trumbore), by triangle chunks."""
    hit = np.zeros(len(O), bool)
    if not len(F):
        return hit
    v0, e1, e2 = V[F[:, 0]], V[F[:, 1]] - V[F[:, 0]], V[F[:, 2]] - V[F[:, 0]]
    # Only triangles near the rays' reach of the origins' box.
    for s0 in range(0, len(O), 96):
        o, d = O[s0:s0 + 96], Dn[s0:s0 + 96]
        lo, hi = o.min(0) - reach, o.max(0) + reach
        sel = np.nonzero(((V[F].max(1) >= lo) & (V[F].min(1) <= hi)).all(1))[0]
        if not len(sel):
            continue
        a0, a1, a2 = v0[sel][None], e1[sel][None], e2[sel][None]
        oo, dd = o[:, None, :], d[:, None, :]
        pv = np.cross(dd, a2)
        det = np.einsum('ijk,ijk->ij', pv, np.broadcast_to(a1, pv.shape))
        ok = np.abs(det) > 1e-12
        inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
        tv = oo - a0
        u = np.einsum('ijk,ijk->ij', tv, pv) * inv
        qv = np.cross(tv, np.broadcast_to(a1, tv.shape))
        v = np.einsum('ijk,ijk->ij', np.broadcast_to(dd, qv.shape), qv) * inv
        t = np.einsum('ijk,ijk->ij', qv, np.broadcast_to(a2, qv.shape)) * inv
        h = ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0.001) & (t < reach)
        hit[s0:s0 + 96] = h.any(1)
    return hit


def cone(N):
    """The normal and four directions TILT round it."""
    a = np.where(np.abs(N[:, 1:2]) < 0.9, np.array([[0, 1, 0]]), np.array([[1, 0, 0]]))
    t1 = np.cross(N, a); t1 /= np.linalg.norm(t1, axis=1, keepdims=True) + 1e-12
    t2 = np.cross(N, t1)
    c, s = np.cos(TILT), np.sin(TILT)
    return [N, c * N + s * t1, c * N - s * t1, c * N + s * t2, c * N - s * t2]


def covered(P, N, V, F):
    """Vertices whose every cone ray meets (V, F)."""
    out = np.ones(len(P), bool)
    for d in cone(N):
        idx = np.nonzero(out)[0]
        if not len(idx):
            break
        out[idx] = ray_hits(P[idx] + d[idx] * 0.001, d[idx], V, F, REACH)
    return out


POKE = 0.025


def poking(P, N, V, F, reach=POKE):
    """Vertices lying outside a surface they should be under: a ray inward meets it within reach."""
    return ray_hits(P - N * 0.0005, -N, V, F, reach)


def keep_specks(F, drop, rep):
    """Dropped triangles in groups smaller than MIN_SPECK are kept (holes in plain view)."""
    idx = np.nonzero(drop)[0]
    if not len(idx):
        return drop
    Fw = rep[F[idx]]
    n = len(idx)
    # Triangles linked through shared (welded) corners.
    rows, cols = [], []
    first = {}
    for t, f in enumerate(Fw):
        for v in f:
            v = int(v)
            if v in first:
                rows.append(t); cols.append(first[v])
            else:
                first[v] = t
    from scipy.sparse.csgraph import connected_components
    A = sparse.coo_matrix((np.ones(len(rows)), (rows, cols)), shape=(n, n))
    k, lab = connected_components(A, directed=False)
    size = np.bincount(lab, minlength=k)
    drop = drop.copy()
    drop[idx[size[lab] < MIN_SPECK]] = False
    return drop


class Piece:
    """One garment, baked: outward, one weight field, thick edges."""

    def __init__(self, name, m, body, names, bmap, legs, crotch_y, layer):
        self.name = name
        self.layer = layer
        P0, F0 = m['P'], m['F'].copy()
        rep, U = weld(P0, 1e-5)
        Fw = rep[F0]
        # 0. Straight edges: a hem or rim cut through the mesh (a knee tunic cut from a robe, a
        # hood's lower edge) is a saw of single triangles, each with two open edges, that show
        # as shards in the stride. Those ears are peeled off, a few rows, on large shells only.
        comp0 = components(Fw, len(U))
        big = np.bincount(comp0[Fw[:, 0]], minlength=comp0.max() + 1) > 200
        self.ears = 0
        for _ in range(3):
            E = np.sort(np.stack([Fw[:, [0, 1]], Fw[:, [1, 2]], Fw[:, [2, 0]]], 1), 2)
            key = E[..., 0] * len(U) + E[..., 1]
            uk, cnt = np.unique(key, return_counts=True)
            openE = np.isin(key, uk[cnt == 1]).sum(1)
            ear = (openE >= 2) & big[comp0[Fw[:, 0]]]
            if not ear.any():
                break
            self.ears += int(ear.sum())
            F0, Fw = F0[~ear], Fw[~ear]
        # 1. Outward, per connected piece.
        comp = components(Fw, len(U))
        fn = np.cross(U[Fw[:, 1]] - U[Fw[:, 0]], U[Fw[:, 2]] - U[Fw[:, 0]])
        cen = U[Fw].mean(1)
        _, near = body.tree.query(cen)
        s = np.einsum('ij,ij->i', fn, body.N[near])
        flipped = 0
        N0 = m['N'].copy()
        for c in np.unique(comp):
            tri = comp[Fw[:, 0]] == c
            if s[tri].sum() < 0:
                F0[tri] = F0[tri][:, [0, 2, 1]]
                verts = np.unique(F0[tri])
                N0[verts] = -N0[verts]
                flipped += 1
        Fw = rep[F0]
        # Linings and facings: a shell lying wholly just inside another shell of the same
        # garment (a hem lining, a collar facing) is dropped. Every open edge gets its own
        # turned-in band below, and these inner shells came out under the hem in the stride.
        bd = body.tree.query(U)[0]
        lined = 0
        sizes = np.bincount(comp, minlength=comp.max() + 1)
        for c in np.unique(comp):
            vs = np.nonzero(comp == c)[0]
            others = np.nonzero((comp != c) & (sizes[comp] > sizes[c]))[0]
            if not len(others) or len(vs) < 3:
                continue
            d, k = cKDTree(U[others]).query(U[vs])
            if (d < 0.035).mean() >= 0.9 and np.median(bd[vs]) < np.median(bd[others[k]]):
                tri = comp[Fw[:, 0]] == c
                F0, Fw = F0[~tri], Fw[~tri]
                lined += int(tri.sum())
        # An inner shell (an under-skirt tube inside a knee tunic) that the garment's other
        # shells cover for the most part goes whole: its rim came out below the hem in the stride.
        Nw = vertex_normals(U, Fw)
        sizes = np.bincount(comp[Fw[:, 0]], minlength=comp.max() + 1)
        for c in np.unique(comp[Fw[:, 0]]):
            tri = comp[Fw[:, 0]] == c
            if sizes[c] >= sizes.max() or sizes[c] < 20:
                continue
            vs = np.unique(Fw[tri])
            others = Fw[~tri]
            # (Straight out along the normal, within 12 cm: a short tube lets slanted rays out.)
            if ray_hits(U[vs] + Nw[vs] * 0.001, Nw[vs], U, others, 0.12).mean() >= 0.8:
                F0, Fw = F0[~tri], Fw[~tri]
                lined += int(tri.sum())
        self.lined = lined
        Nw = vertex_normals(U, Fw)
        # Authored normals agree with the winding.
        bad = np.einsum('ij,ij->i', N0, Nw[rep]) < 0
        N0[bad] = -N0[bad]
        self.flipped = flipped
        self.m, self.P0, self.F0, self.N0, self.rep, self.U, self.Fw, self.comp = m, P0, F0, N0, rep, U, Fw, comp
        self.body, self.names, self.bmap, self.legs, self.crotch_y = body, names, bmap, legs, crotch_y
        self.bodyd = body.tree.query(U)[0]
        self.knee_y = body.knee_y
        self.Nw = Nw
        self.push = np.zeros(len(U))

    def weights(self):
        """First pass: the body's weights over the cloth (section 2 of the docstring)."""
        U, Fw = self.U, self.Fw
        body, bmap, legs, crotch_y = self.body, self.bmap, self.legs, self.crotch_y
        n = len(U)
        L = adjacency(Fw, n)
        self.L = L
        # Which part of the body each bit of cloth belongs to (left arm, right arm, the rest),
        # by distance along the cloth from where it touches the body: a bell sleeve hanging
        # by the hip is the forearm's, not the hip's.
        d1, k1 = body.tree.query(U)
        lab = body.label[k1].copy()
        seeds = np.nonzero(d1 < NEAR)[0]
        if len(seeds):
            from scipy.sparse.csgraph import dijkstra
            E = np.concatenate([Fw[:, [0, 1]], Fw[:, [1, 2]], Fw[:, [2, 0]]])
            el = np.linalg.norm(U[E[:, 0]] - U[E[:, 1]], axis=1) + 1e-9
            G = sparse.coo_matrix((el, (E[:, 0], E[:, 1])), shape=(n, n)).tocsr()
            # (With min_only, scipy also returns each vertex's nearest seed.)
            dist, _, src = dijkstra(G, directed=False, indices=seeds, min_only=True, return_predecessors=True)
            src = np.where(src < 0, 0, src)
            ok = np.isfinite(dist) & (d1[src] < NEAR)
            lab[ok] = body.label[k1[src[ok]]]
        W0 = np.zeros((n, body.D.shape[1])); dist = np.zeros(n)
        for l in np.unique(lab):
            sel = np.nonzero(lab == l)[0]
            tree, ids = body.label_trees[l]
            d, k = tree.query(U[sel], 4)
            w = 1 / np.maximum(d, 1e-4); w /= w.sum(1, keepdims=True)
            W0[sel] = np.einsum('ik,ikj->ij', w, body.D[ids[k]])
            dist[sel] = d[:, 0]
        conf = np.clip((FAR - dist) / (FAR - NEAR), 0, 1)
        # A skirt below the crotch: from the pelvis at the top towards the legs at the hem,
        # each half following its own leg there, softly shared across the middle.
        if legs is not None and lab.max() >= 0:
            hem = U[:, 1].min()
            span = max(crotch_y - hem, 0.05)
            t = np.clip((crotch_y - U[:, 1]) / span, 0, 1)
            skirt = (lab == 0) & (t > 0) & (conf < 1)
            if skirt.any():
                dl, kl = legs[0].query(U * [1, 3, 1])
                dr, kr = legs[1].query(U * [1, 3, 1])
                a = np.exp(-(dl - np.minimum(dl, dr)) / SKIRT_SIGMA)
                b = np.exp(-(dr - np.minimum(dl, dr)) / SKIRT_SIGMA)
                Wleg = (a[:, None] * body.D[legs[2][kl]] + b[:, None] * body.D[legs[3][kr]]) / (a + b)[:, None]
                Wpel = np.zeros_like(W0); Wpel[:, self.names.index('Hips')] = 1
                # (Short skirts, above the knee, follow the thighs as before: the pelvis blend is for long ones.)
                long_ = hem < self.knee_y
                f = ((LEG_AT_HEM * t ** 1.5) if long_ else np.clip(t / 0.3, 0, 1))[:, None]
                Wsk = Wpel * (1 - f) + Wleg * f
                g = (np.clip(t / 0.15, 0, 1) * (1 - conf))[:, None] * skirt[:, None]
                W0 = W0 * (1 - g) + Wsk * g
                conf = np.maximum(conf, g[:, 0])
        self.W0 = remap_dense(W0, bmap)
        self.conf = conf
        self.lab = lab
        self.solve()

    def solve(self):
        L, W0, conf = self.L, self.W0, self.conf
        W = W0.copy()
        for _ in range(400):
            W = conf[:, None] * W0 + (1 - conf[:, None]) * (L @ W)
        # A light smoothing everywhere, so seams between trusted and inpainted cloth do not crease.
        for _ in range(4):
            W = 0.6 * W + 0.4 * (L @ W)
        W /= W.sum(1, keepdims=True)
        self.W = W
        self.conf_mean = float(conf.mean())

    def relayer(self, inner):
        """Second pass: cloth lying on other cloth takes that cloth's weights, so the two move
        as one (a cape on its robe, a hood's cape tucked under a collar, a belt on its tunic).
        `inner`: (welded positions, weights) of the garments worn under this one; the other
        shells of this garment nearer the body are added here."""
        U = self.U
        med = {c: np.median(self.bodyd[self.comp == c]) for c in np.unique(self.comp)}
        W0, conf = self.W0.copy(), self.conf.copy()
        changed = 0
        for c in np.unique(self.comp):
            vs = np.nonzero(self.comp == c)[0]
            srcP = [P for P, _ in inner]; srcW = [W for _, W in inner]
            for c2 in med:
                if c2 != c and med[c2] < med[c] - 0.002:
                    o = np.nonzero(self.comp == c2)[0]
                    srcP.append(U[o]); srcW.append(self.W[o])
            if not srcP:
                continue
            P = np.concatenate(srcP); Ws = np.concatenate(srcW)
            kk = min(3, len(P))
            d, k = cKDTree(P).query(U[vs], kk)
            d, k = d.reshape(len(vs), kk), k.reshape(len(vs), kk)
            on = d[:, 0] < LAYER_NEAR
            # Nearer to that cloth than to the skin (or the skin is not under it).
            on &= d[:, 0] < self.bodyd[vs] + 0.003
            if not on.any():
                continue
            w = 1 / np.maximum(d[on], 1e-4); w /= w.sum(1, keepdims=True)
            W0[vs[on]] = np.einsum('ik,ikj->ij', w, Ws[k[on]])
            conf[vs[on]] = 1.0
            changed += int(on.sum())
        # Double-walled cloth (a robe whose skirt is an outer and an inner wall joined at
        # the hem; a cape): the inner wall, which a ray out along its normal meets the same
        # shell within 3 cm, copies the weights of the outer wall over it. Weighted on their
        # own, the inner wall (nearer the legs) crossed the outer one in the stride and showed
        # as dark slits at the hem.
        Nv = vertex_normals(U, self.Fw)
        inner_wall = np.zeros(len(U), bool)
        for c in np.unique(self.comp):
            vs = np.nonzero(self.comp == c)[0]
            Fc = self.Fw[self.comp[self.Fw[:, 0]] == c]
            if len(Fc) < 50:
                continue
            # (Out = away from the body, along the nearest body point's normal: the inner wall's
            # own normals face the body.)
            _, nb = self.body.tree.query(U[vs])
            out = self.body.N[nb]
            inner_wall[vs] = ray_hits(U[vs] + out * 0.002, out, U, Fc, 0.03)
        walls = 0
        for c in np.unique(self.comp):
            iv = np.nonzero((self.comp == c) & inner_wall)[0]
            ov = np.nonzero((self.comp == c) & ~inner_wall)[0]
            if not len(iv) or len(ov) < 3:
                continue
            d, k = cKDTree(U[ov]).query(U[iv], 3)
            near = d[:, 0] < 0.04
            w = 1 / np.maximum(d[near], 1e-4); w /= w.sum(1, keepdims=True)
            src = W0 if changed else self.W0
            W0 = W0 if changed else self.W0.copy()
            conf = conf if changed else self.conf.copy()
            # (From the solved outer wall, so the inner follows exactly what the outer does.)
            W0[iv[near]] = np.einsum('ik,ikj->ij', w, self.W[ov[k[near]]])
            conf[iv[near]] = 1.0
            changed += int(near.sum()); walls += int(near.sum())
        if changed:
            self.W0, self.conf = W0, conf
            self.solve()
        self.relayered = changed
        self.walls = walls

    def finish(self):
        """Thick edges, on the (possibly inflated) cloth with its final weights."""
        m, F0, N0, rep, U, Fw = self.m, self.F0, self.N0, self.rep, self.U, self.Fw
        P0 = U[rep]
        Nw = vertex_normals(U, Fw)
        W = self.W
        # 3. Thick open edges: the band within BAND of an open edge, copied inward.
        E = np.sort(np.concatenate([Fw[:, [0, 1]], Fw[:, [1, 2]], Fw[:, [2, 0]]]), 1)
        Eu, cnt = np.unique(E, axis=0, return_counts=True)
        bedges = Eu[cnt == 1]
        bverts = np.unique(bedges)
        geo = np.full(len(U), np.inf)
        if len(bverts):
            # Dijkstra over the cloth's edges from every open-edge vertex.
            from scipy.sparse.csgraph import dijkstra
            el = np.linalg.norm(U[Eu[:, 0]] - U[Eu[:, 1]], axis=1)
            G = sparse.coo_matrix((el, (Eu[:, 0], Eu[:, 1])), shape=(len(U), len(U))).tocsr()
            src = len(U)
            G = sparse.vstack([sparse.hstack([G, sparse.csr_matrix((len(U), 1))]),
                               sparse.csr_matrix((np.full(len(bverts), 1e-9), (np.zeros(len(bverts), int), bverts)), shape=(1, len(U) + 1))]).tocsr()
            geo = dijkstra(G, directed=False, indices=src, limit=BAND * 1.5)[:len(U)]
        band_t = np.nonzero((geo[Fw] <= BAND).all(1))[0]
        nv = len(P0)
        P, N, UV = [P0], [N0], [m['UV']]
        Wd = [W[rep]]
        shade = [np.ones(nv)]
        Fo = [F0]
        self.src = np.arange(nv)
        if len(band_t):
            bv = np.unique(F0[band_t])
            copy = -np.ones(nv, int)
            copy[bv] = nv + np.arange(len(bv))
            self.src = np.concatenate([self.src, bv])
            P.append(P0[bv] - Nw[rep[bv]] * THICK)
            N.append(-N0[bv]); UV.append(m['UV'][bv]); Wd.append(W[rep[bv]])
            # The inside is the cloth in its own shadow.
            shade.append(np.full(len(bv), 0.8))
            Fo.append(copy[F0[band_t]][:, [0, 2, 1]])
            # The rim: each open edge (as the outer face winds it) joined to its copy.
            first = {}
            for i in range(nv):
                first.setdefault(int(rep[i]), i)
            bset = {tuple(e) for e in bedges}
            # The rim has its own corners, shaded with the normal of the edge itself (along
            # the cloth, away from it), so it reads as the cloth's thickness and not as a
            # dark crease between the outer face and the inside.
            bnd = np.zeros(len(U), bool); bnd[bverts] = True
            nb_sum = np.zeros_like(U); nb_cnt = np.zeros(len(U))
            for i0, i1 in Eu:
                if not bnd[i1]:
                    nb_sum[i0] += U[i1]; nb_cnt[i0] += 1
                if not bnd[i0]:
                    nb_sum[i1] += U[i0]; nb_cnt[i1] += 1
            T = U - nb_sum / np.maximum(nb_cnt, 1)[:, None]
            T -= Nw * np.einsum('ij,ij->i', T, Nw)[:, None]
            T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
            rv = {}
            extraP, extraN, extraUV, extraW, extraS, extraSrc = [], [], [], [], [], []
            base = nv + len(bv)
            def rim_vert(src_i, inner):
                k = (src_i, inner)
                if k not in rv:
                    rv[k] = base + len(extraP)
                    extraP.append(P0[src_i] - Nw[rep[src_i]] * (THICK if inner else 0))
                    extraN.append(T[rep[src_i]]); extraUV.append(m['UV'][src_i]); extraW.append(W[rep[src_i]])
                    extraS.append(0.9 if inner else 1.0); extraSrc.append(src_i)
                return rv[k]
            bset = {tuple(e) for e in bedges}
            rim = []
            for f in F0[band_t]:
                for e in range(3):
                    a, b = int(f[e]), int(f[(e + 1) % 3])
                    key = tuple(sorted((int(rep[a]), int(rep[b]))))
                    if key in bset and copy[a] >= 0 and copy[b] >= 0:
                        A, B, A2, B2 = rim_vert(a, 0), rim_vert(b, 0), rim_vert(a, 1), rim_vert(b, 1)
                        rim += [(B, A, A2), (B, A2, B2)]
            if rim:
                Fo.append(np.array(rim))
                P.append(np.array(extraP)); N.append(np.array(extraN)); UV.append(np.array(extraUV))
                Wd.append(np.array(extraW)); shade.append(np.array(extraS))
                self.src = np.concatenate([self.src, np.array(extraSrc)])
        self.P = np.concatenate(P); self.N = np.concatenate(N); self.UV = np.concatenate(UV)
        Dfull = np.concatenate(Wd)
        self.J, self.W = top4(Dfull)
        self.shade = np.concatenate(shade)
        self.F = np.concatenate(Fo).astype(np.int64)
        self.n_outer = len(F0)  # the first n_outer triangles are the cloth itself
        self.rep = rep
        self.band = len(band_t)
        # For ray tests: the outer surface (welded positions, oriented triangles).
        self.Vw, self.Fw = U, Fw
        self.Nv = Nw[rep]


CLEAR, MAX_PUSH = 0.006, 0.015


def inflate(pieces, worn_with, depth, log=print):
    """Clearance, offline: where one surface lies on another (another garment
    worn under it, or another shell of the same garment nearer the body),
    the outer one is moved out along its normal to CLEAR above the inner,
    at most MAX_PUSH, the push spread smoothly over the cloth. Both are then
    skinned alike (finish()), so the clearance holds in motion."""
    for rnd in range(3):
        for x, p in pieces.items():
            if p.layer == 'shoe':
                continue
            inner = [y for y in worn_with[x] if depth[y] < depth[x]]
            Q, Qd, Qc, own = [], [], [], []
            for y in inner:
                Q.append(pieces[y].U); Qd.append(np.full(len(pieces[y].U), -1.0)); Qc.append(np.full(len(pieces[y].U), -1)); own.append(np.zeros(len(pieces[y].U), bool))
            Q.append(p.U); Qd.append(p.bodyd); Qc.append(p.comp); own.append(np.ones(len(p.U), bool))
            Q = np.concatenate(Q); Qd = np.concatenate(Qd); Qc = np.concatenate(Qc); own = np.concatenate(own)
            tree = cKDTree(Q)
            N = vertex_normals(p.U, p.Fw)
            need = np.zeros(len(p.U))
            # Only the cloth's outer face is moved (not a lining or facing that looks at the body).
            _, near = p.body.tree.query(p.U)
            outer = np.einsum('ij,ij->i', N, p.body.N[near]) > 0.3
            for i, nb in enumerate(tree.query_ball_point(p.U, 0.03)):
                if not outer[i]:
                    continue
                nb = np.asarray(nb)
                if not len(nb):
                    continue
                # Another garment beneath, or another shell of this one lying nearer the body.
                ok = ~own[nb] | ((Qc[nb] != p.comp[i]) & (Qd[nb] < p.bodyd[i] - 0.002))
                nb = nb[ok]
                if not len(nb):
                    continue
                d = p.U[i] - Q[nb]
                h = d @ N[i]
                lat = np.linalg.norm(d - h[:, None] * N[i], axis=1)
                # Another garment may have come up to 1 cm through it; a shell of the same garment only touches.
                lo = np.where(own[nb], -0.003, -0.01)
                sel = (lat < 0.012) & (h > lo) & (h < CLEAR)
                if sel.any():
                    need[i] = np.clip((CLEAR - h[sel]).max(), 0, MAX_PUSH)
            if not need.any():
                continue
            L = adjacency(p.Fw, len(p.U))
            push = need.copy()
            for _ in range(6):
                push = np.maximum(need, 0.5 * push + 0.5 * (L @ push))
            push = np.minimum(push, MAX_PUSH - p.push)
            p.U = p.U + N * push[:, None]
            p.push += push
            p.bodyd = p.body.tree.query(p.U)[0]
        log(f'  clearance round {rnd}: ' + ', '.join(f'{x} {np.percentile(q.push, 99) * 1000:.0f}/{q.push.max() * 1000:.0f}mm' for x, q in pieces.items() if q.push.any()))


def tuck(p, tunics, neck, reach=0.02):
    """A hood, cowl or veil worn with a tunic or robe goes into its collar: the head
    cloth inside the collar (within 2 cm outside the collar's own radius) and below its
    rim is cut away, so what shows there is the collar's finished edge, not the two
    cloths crossing each other in a jagged line. Capes lying well outside the collar
    are kept."""
    bins = 48
    T = np.concatenate([t.U for t in tunics])
    r = np.hypot(T[:, 0] - neck[0], T[:, 2] - neck[2])
    sel = (r < 0.16) & (T[:, 1] > neck[1] - 0.15)
    T, r = T[sel], r[sel]
    a = np.arctan2(T[:, 0] - neck[0], T[:, 2] - neck[2])
    k = ((a / (2 * np.pi) * bins).round().astype(int)) % bins
    top = np.full(bins, -np.inf); rad = np.zeros(bins)
    np.maximum.at(top, k, T[:, 1])
    for b in range(bins):
        near = (k == b) & (T[:, 1] > top[b] - 0.015)
        rad[b] = np.median(r[near]) if near.any() else 0
    C = p.U[p.Fw].mean(1)
    rc = np.hypot(C[:, 0] - neck[0], C[:, 2] - neck[2])
    kc = ((np.arctan2(C[:, 0] - neck[0], C[:, 2] - neck[2]) / (2 * np.pi) * bins).round().astype(int)) % bins
    # Tucked, not cut: the head cloth below the collar's rim is drawn in to just inside the
    # collar (1 cm under its radius), fading in over the 2 cm above the rim, so its own edge
    # lies hidden under the tunic. Only cloth deep inside (6 cm below the rim) is cut away.
    U = p.U.copy()
    rv = np.hypot(U[:, 0] - neck[0], U[:, 2] - neck[2])
    kv = ((np.arctan2(U[:, 0] - neck[0], U[:, 2] - neck[2]) / (2 * np.pi) * bins).round().astype(int)) % bins
    ok = np.isfinite(top[kv]) & (rad[kv] > 0) & (rv < rad[kv] + reach)
    f = np.clip((top[kv] + 0.02 - U[:, 1]) / 0.02, 0, 1) * ok
    want = np.minimum(rv, rad[kv] - 0.01)
    rn = rv + (want - rv) * f
    sc = np.where(rv > 1e-6, rn / np.maximum(rv, 1e-6), 1)
    U[:, 0] = neck[0] + (U[:, 0] - neck[0]) * sc
    U[:, 2] = neck[2] + (U[:, 2] - neck[2]) * sc
    p.U = U
    p.bodyd = p.body.tree.query(U)[0]
    p.tucked = True
    cut = np.isfinite(top[kc]) & (C[:, 1] < top[kc] - 0.06) & (rc < rad[kc] + reach)
    if cut.any():
        F0 = p.F0[~cut]
        p.F0, p.Fw = F0, p.rep[F0]
    return int((f > 0).sum())


class Body:
    def __init__(self, g, node, names):
        self.prims = [g.mesh(node, 0), g.mesh(node, 1)]
        P = np.concatenate([p['P'] for p in self.prims])
        F = np.concatenate([self.prims[0]['F'], self.prims[1]['F'] + len(self.prims[0]['P'])])
        J = np.concatenate([p['J'] for p in self.prims]); W = np.concatenate([p['W'] for p in self.prims])
        rep, U = weld(P, 1e-5)
        self.rep0 = rep[:len(self.prims[0]['P'])]
        self.P, self.N = U, vertex_normals(U, rep[F])
        nj = len(names)
        Dv = dense_weights(J.astype(int), W, nj)
        D = np.zeros((len(U), nj))
        D[rep] = Dv
        self.D = D
        self.tree = cKDTree(U)
        main = D.argmax(1)
        self.main = main
        # 0: trunk, legs and head; 1, 2: the left and right arm (arm, forearm, hand and fingers).
        arm = lambda S: [i for i, n in enumerate(names) if n.startswith(S) and any(x in n for x in ('Arm', 'Hand'))]
        self.label = np.zeros(len(U), int)
        self.label[np.isin(main, arm('Left'))] = 1
        self.label[np.isin(main, arm('Right'))] = 2
        knees = [i for i, n in enumerate(names) if n in ('LeftLeg', 'RightLeg')]
        self.knee_y = float(np.median(U[np.isin(main, knees), 1].max())) if np.isin(main, knees).any() else 0.5
        self.label_trees = {l: (cKDTree(U[self.label == l]), np.nonzero(self.label == l)[0]) for l in range(3)}


def build(src, out, body_id, log=print):
    t0 = time.time()
    g = Gltf(os.path.join(src, body_id + '.json'))
    meta = g.meta()
    names = g.joints()
    bmap = sub_bones(names)
    bnode = next(n['name'] for n in g.j['nodes'] if n['name'].endswith('.body'))
    body = Body(g, bnode, names)
    # The legs, for skirts: body points by side (thigh, shin, foot).
    legs = []
    for S in ('Left', 'Right'):
        ids = [names.index(S + x) for x in ('UpLeg', 'Leg', 'Foot', 'ToeBase')]
        sel = np.nonzero(np.isin(body.main, ids))[0]
        legs.append((cKDTree(body.P[sel] * [1, 3, 1]), sel))
    legs = (legs[0][0], legs[1][0], legs[0][1], legs[1][1])
    inv = g.acc(g.j['skins'][0]['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
    Bpos = {n: np.linalg.inv(M)[:3, 3] for n, M in zip(names, inv)}
    crotch_y = Bpos['LeftUpLeg'][1] - 0.06
    # Outfits: one per set of garments the population wears (belt styles included), no cloaks.
    outfits = {}
    for oid, o in meta['outfits'].items():
        if 'cloak' in o['garments']:
            continue
        sets = [list(o['garments'])]
        for gid, b in (meta.get('belts') or {}).items():
            if gid in o['garments'] and b['default'] in o['garments']:
                for style, belt in b['styles'].items():
                    if belt != b['default']:
                        sets.append([belt if x == b['default'] else x for x in o['garments']])
        for s in sets:
            outfits.setdefault('+'.join(sorted(s)), s)
    used = sorted({x for s in outfits.values() for x in s})
    pieces = {}
    for x in used:
        pieces[x] = Piece(x, g.mesh('G_' + x), body, names, bmap, legs if meta['garments'][x]['layer'] in ('tunic', 'over', 'belt') else None, crotch_y, meta['garments'][x]['layer'])
    depth = {x: meta['garments'][x]['depth'] for x in used}
    worn_with = {x: sorted({y for s in outfits.values() if x in s for y in s if y != x}) for x in used}
    inflate(pieces, worn_with, depth, log)
    for x in used:
        if meta['garments'][x]['layer'] == 'head':
            tunics = [pieces[y] for y in worn_with[x] if meta['garments'][y]['layer'] == 'tunic']
            if tunics and all(any(meta['garments'][y]['layer'] == 'tunic' for y in s) for s in outfits.values() if x in s):
                # A hood has no cape to keep: all of it below the collar's rim goes in.
                log(f'  {x}: {tuck(pieces[x], tunics, Bpos["Neck"], 0.08 if x == "hood" else 0.02)} vertices tucked into the collar')
    for x in used:
        pieces[x].weights()
    # Layered weights, innermost garment first.
    for x in sorted(used, key=lambda y: depth[y]):
        inner = [(pieces[y].U, pieces[y].W) for y in worn_with[x] if depth[y] < depth[x] and meta['garments'][y]['layer'] != 'shoe']
        pieces[x].relayer(inner)
        log(f'  {x}: {pieces[x].relayered} vertices take the weights of the cloth under them ({pieces[x].walls} inner wall)')
    for x in used:
        pieces[x].finish()
        log(f'  {x}: {pieces[x].ears} ear triangles peeled, {pieces[x].lined} lining/facing triangles dropped, flipped {pieces[x].flipped} pieces, near-body {pieces[x].conf_mean:.2f}, band tris {pieces[x].band}')
    layer = {x: meta['garments'][x]['layer'] for x in used}
    # Skin vertices (prim 0) and their normals, for the cover test.
    sk = body.prims[0]
    skP = sk['P']; skN = body.N[body.rep0]
    neckhead = np.isin(body.main[body.rep0], [names.index('Neck'), names.index('Head')])
    legs_all = np.isin(body.main[body.rep0], [i for i, n in enumerate(names) if any(x in n for x in ('Leg', 'Foot', 'Toe'))])
    footleg = np.isin(body.main[body.rep0], [i for i, n in enumerate(names) if any(x in n for x in ('Leg', 'Foot', 'Toe')) and 'UpLeg' not in n])
    report = {'body': body_id, 'outfits': {}}
    new_nodes = []
    j = g.j
    # Accessors shared by all outfits.
    def acc(arr, ctype, kind, target=34962):
        return g._add_acc(arr, ctype, kind, target)
    skin_prim = j['meshes'][g.node(bnode)['mesh']]['primitives']
    shared_skin = {k: v for k, v in skin_prim[0]['attributes'].items() if k != '_HIDE'}
    shared_head = {k: v for k, v in skin_prim[1]['attributes'].items() if k != '_HIDE'}
    head_idx = skin_prim[1]['indices']
    gacc = {}
    for x, p in pieces.items():
        J = p.J.astype(np.uint16 if p.J.max() > 255 else np.uint8)
        gacc[x] = {
            'POSITION': acc(p.P.astype(np.float32), 5126, 'VEC3'),
            'NORMAL': acc(p.N.astype(np.float32), 5126, 'VEC3'),
            'TEXCOORD_0': acc(p.UV.astype(np.float32), 5126, 'VEC2'),
            'JOINTS_0': acc(J, 5123 if J.dtype == np.uint16 else 5121, 'VEC4'),
            'WEIGHTS_0': acc(p.W.astype(np.float32), 5126, 'VEC4'),
            '_SHADE': acc(p.shade.astype(np.float32), 5126, 'SCALAR'),
        }
    gmat = {x: j['meshes'][g.node('G_' + x)['mesh']]['primitives'][0].get('material') for x in used}
    gextras = {x: g.node('G_' + x).get('extras') for x in used}
    skin_node = g.node(bnode)
    parent = next(n for n in j['nodes'] if j['nodes'].index(skin_node) in n.get('children', []))
    for key, gs in outfits.items():
        rep_o = {'tris': {}}
        # Skin: dropped where every garment over it covers it.
        outer = [pieces[x] for x in gs]
        V = np.concatenate([q.Vw for q in outer]); off = np.cumsum([0] + [len(q.Vw) for q in outer])
        F = np.concatenate([q.Fw + o for q, o in zip(outer, off[:-1])])
        cov = covered(skP, skN, V, F) | poking(skP, skN, V, F)
        # The neck is always kept: it closes the head to the collar or hood.
        cov &= ~neckhead
        # Inside a shoe or boot: everything below its top (less 1.5 cm) goes, so no heel shows through it.
        shoes = [pieces[y] for y in gs if layer[y] == 'shoe']
        if shoes:
            top = min(np.percentile(q.Vw[:, 1], 98) for q in shoes) - 0.015
            cov |= footleg & (skP[:, 1] < top)
        # Under a skirt to the ankles the legs are never seen: all of them go (kept, they came
        # through the skirt's front in the stride).
        if any(layer[y] == 'tunic' and pieces[y].Vw[:, 1].min() < 0.25 for y in gs):
            cov |= legs_all
        drop = cov[sk['F']].all(1)
        rep_s, _ = weld(skP, 1e-5)
        drop = keep_specks(sk['F'], drop, rep_s)
        Fs = sk['F'][~drop]
        prims = [
            {'attributes': dict(shared_skin), 'indices': acc(Fs.reshape(-1).astype(np.uint16 if len(skP) < 65536 else np.uint32), 5123 if len(skP) < 65536 else 5125, 'SCALAR', 34963), 'material': skin_prim[0]['material'], 'mode': 4},
            {'attributes': dict(shared_head), 'indices': head_idx, 'material': skin_prim[1]['material'], 'mode': 4},
        ]
        rep_o['tris']['skin'] = [int(len(Fs)), int(len(sk['F']))]
        rep_o['tris']['head'] = int(j['accessors'][head_idx]['count'] // 3)
        j['meshes'].append({'name': 'body|' + key, 'primitives': prims})
        new_nodes.append({'name': 'body|' + key, 'mesh': len(j['meshes']) - 1, 'skin': skin_node['skin'], 'extras': skin_node.get('extras')})
        for x in gs:
            p = pieces[x]
            over = [pieces[y] for y in gs if depth[y] > depth[x]] if layer[x] != 'shoe' else []
            # Covered by anything else worn (also a lower layer: a hood's edge tucked under a collar).
            others = [pieces[y] for y in gs if y != x and layer[y] != 'shoe']
            keepF = np.ones(len(p.F), bool)
            if layer[x] == 'shoe' and any(layer[y] == 'tunic' and pieces[y].Vw[:, 1].min() < 0.25 for y in gs):
                # Under a robe to the ankles only the shoe shows, not its small straps and laces.
                sizes = np.bincount(p.comp)
                small = sizes[p.comp] < 80
                # The shoe's top (its light folded cuff) under the robe: covered by the skirt, or
                # coming through it near the hem, goes; it read as a torn patch on the hem.
                robes = [pieces[y] for y in gs if layer[y] == 'tunic']
                Vr = np.concatenate([q.Vw for q in robes]); orr = np.cumsum([0] + [len(q.Vw) for q in robes])
                Fr = np.concatenate([q.Fw + o for q, o in zip(robes, orr[:-1])])
                Nv = vertex_normals(p.Vw, p.Fw)
                hem = Vr[:, 1].min()
                top = p.Vw[:, 1] > hem + 0.01
                hid = top & (covered(p.Vw, Nv, Vr, Fr) | poking(p.Vw, Nv, Vr, Fr, 0.05))
                drop_v = (hid | small)[p.rep[p.src]]
                keepF = ~drop_v[p.F].all(1)
            elif layer[x] != 'shoe':
                # Garments worn over it, and the other shells of the same garment
                # (a cape over the robe, a sleeve over the side), cover it.
                Nv = vertex_normals(p.Vw, p.Fw)
                cw = np.zeros(len(p.Vw), bool)
                for c in np.unique(p.comp):
                    vs = np.nonzero(p.comp == c)[0]
                    parts = [(q.Vw, q.Fw) for q in others] + [(p.Vw, p.Fw[p.comp[p.Fw[:, 0]] != c])]
                    off = np.cumsum([0] + [len(v) for v, _ in parts])
                    V = np.concatenate([v for v, _ in parts]); F = np.concatenate([f + o for (_, f), o in zip(parts, off[:-1])])
                    if len(F):
                        cw[vs] = covered(p.Vw[vs], Nv[vs], V, F)
                # Through a garment worn over it (a collar over the hood's cape): dropped, the outer one shows.
                # (A hood's or cowl's shoulder cape can lie several cm under a tunic's collar in the bind pose.)
                for q in over:
                    if getattr(q, 'tucked', False):
                        continue  # (a hood tucked into this collar lies inside it)
                    cw |= poking(p.Vw, Nv, q.Vw, q.Fw, 0.07 if q.layer == 'head' else POKE)
                cov = cw[p.rep]
                cov = cov[p.src]
                drop = cov[p.F].all(1)
                rep_full = p.rep[p.src] + np.where(p.src != np.arange(len(p.src)), len(p.Vw), 0)
                drop = keep_specks(p.F, drop, rep_full)
                keepF = ~drop
            Fk = p.F[keepF]
            big = len(p.P) >= 65536
            prim = {'attributes': dict(gacc[x]), 'indices': acc(Fk.reshape(-1).astype(np.uint32 if big else np.uint16), 5125 if big else 5123, 'SCALAR', 34963), 'mode': 4}
            if gmat[x] is not None:
                prim['material'] = gmat[x]
            j['meshes'].append({'name': 'G_' + x + '|' + key, 'primitives': [prim]})
            node = {'name': 'G_' + x + '|' + key, 'mesh': len(j['meshes']) - 1, 'skin': skin_node['skin']}
            if gextras[x]:
                node['extras'] = gextras[x]
            new_nodes.append(node)
            rep_o['tris'][x] = [int(keepF.sum()), int(len(p.F))]
        rep_o['total'] = int(sum(v[0] if isinstance(v, list) else v for v in rep_o['tris'].values()))
        report['outfits'][key] = rep_o
        log(f'  {key}: {rep_o["total"]} tris  {rep_o["tris"]}')
    # Replace the old garment and body nodes with the baked ones (eyes kept).
    old = [i for i, n in enumerate(j['nodes']) if 'mesh' in n and (n['name'].startswith('G_') or n['name'] == bnode)]
    keep_meshes = []
    for i in old:
        j['nodes'][i] = {'name': j['nodes'][i]['name'] + '_unused'}
    parent['children'] = [c for c in parent['children'] if c not in old]
    for n in new_nodes:
        j['nodes'].append(n)
        parent['children'].append(len(j['nodes']) - 1)
    # Drop meshes nothing points at (their accessors then leave the buffer).
    used_m = sorted({n['mesh'] for n in j['nodes'] if 'mesh' in n})
    mm = {m: i for i, m in enumerate(used_m)}
    j['meshes'] = [j['meshes'][m] for m in used_m]
    for n in j['nodes']:
        if 'mesh' in n:
            n['mesh'] = mm[n['mesh']]
    meta['npcb'] = {'version': 1, 'outfits': {k: v for k, v in outfits.items()}}
    g.set_meta(meta)
    os.makedirs(out, exist_ok=True)
    g.save(os.path.join(out, body_id + '.json'))
    report['seconds'] = round(time.time() - t0, 1)
    log(f'{body_id}: done in {report["seconds"]} s')
    return report


if __name__ == '__main__':
    src, out = sys.argv[1:3]
    bodies = sys.argv[3:] or ['m_young', 'm_mid', 'm_old', 'm_elder', 'w_young', 'w_mid']
    rep = {}
    for b in bodies:
        print(b, flush=True)
        rep[b] = build(src, out, b, log=lambda s: print(s, flush=True))
    json.dump(rep, open(os.path.join(out, 'bake-report.json'), 'w'), indent=1)
