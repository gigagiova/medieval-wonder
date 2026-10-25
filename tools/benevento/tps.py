import json, numpy as np
from scipy.optimize import least_squares
R = json.load(open('registration.json'))
P = np.array(R['tps']['P']); Wt = np.array(R['tps']['W'])
def U(r): return np.where(r > 0, r * r * np.log(r + 1e-12), 0.0)
def px2world(q):
    q = np.atleast_2d(np.asarray(q, float))
    K = U(np.linalg.norm(q[:, None] - P[None], axis=2))
    A = np.hstack([q, np.ones((len(q), 1))])
    return K @ Wt[:len(P)] + A @ Wt[len(P):]
B = np.array(R['affine']); Ai = np.linalg.inv(B[:2])
def world2px(w):
    w = np.atleast_2d(np.asarray(w, float))
    g = (w - B[2]) @ Ai
    out = []
    for gi, wi in zip(g, w):
        s = least_squares(lambda q: px2world(q)[0] - wi, gi, xtol=1e-6)
        out.append(s.x)
    return np.array(out)
def world2px_fast(w):
    """Inverse via a dense lookup grid (good to ~0.2 px)."""
    global _grid
    w = np.atleast_2d(np.asarray(w, float))
    if '_grid' not in globals():
        xs, ys = np.meshgrid(np.arange(-50, 1450, 4.0), np.arange(-50, 850, 4.0))
        q = np.stack([xs.ravel(), ys.ravel()], 1)
        _grid = (q, px2world(q))
    q, wg = _grid
    from scipy.interpolate import griddata
    return np.stack([griddata(wg, q[:, 0], w, method='linear'), griddata(wg, q[:, 1], w, method='linear')], 1)
