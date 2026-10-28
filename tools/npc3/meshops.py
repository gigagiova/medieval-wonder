"""Mesh helpers for the garment tools: welding, edges, boundary loops, normals, skinning."""
import numpy as np
from scipy.spatial import cKDTree


def weld(P, tol=1e-5):
    """Indices of unique positions: (rep[v] = welded id, U = welded positions)."""
    t = cKDTree(P)
    rep = -np.ones(len(P), int)
    U = []
    for i in range(len(P)):
        if rep[i] >= 0:
            continue
        for j in t.query_ball_point(P[i], tol):
            if rep[j] < 0:
                rep[j] = len(U)
        U.append(P[i])
    return rep, np.array(U)


def edges_of(F):
    E = np.sort(np.concatenate([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]]), 1)
    E, cnt = np.unique(E, axis=0, return_counts=True)
    return E, cnt


def boundary_loops(F):
    """Closed boundary loops (lists of vertex ids) of a welded triangle mesh."""
    E, cnt = edges_of(F)
    b = E[cnt == 1]
    nxt = {}
    for a, c in b:
        nxt.setdefault(a, []).append(c)
        nxt.setdefault(c, []).append(a)
    seen, loops = set(), []
    for s in nxt:
        if s in seen:
            continue
        loop, prev, cur = [s], None, s
        seen.add(s)
        while True:
            cand = [x for x in nxt[cur] if x != prev and x not in seen]
            if not cand:
                break
            prev, cur = cur, cand[0]
            loop.append(cur)
            seen.add(cur)
        loops.append(loop)
    return loops


def vertex_normals(P, F):
    n = np.zeros_like(P)
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    for k in range(3):
        np.add.at(n, F[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def dense_weights(J, W, nj):
    D = np.zeros((len(J), nj))
    for k in range(4):
        np.add.at(D, (np.arange(len(J)), J[:, k]), W[:, k])
    return D


def top4(D):
    """Sparse 4-influence skin from dense weights (normalised)."""
    idx = np.argsort(-D, 1)[:, :4]
    w = np.take_along_axis(D, idx, 1)
    w = w / np.maximum(w.sum(1, keepdims=True), 1e-12)
    return idx, w
