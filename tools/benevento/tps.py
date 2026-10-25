"""Plan px <-> world m through the control-point registration (registration.json):
px2world is the thin-plate spline (exact at the control points); world2px_fast its
inverse through one interpolator over a dense forward grid (~0.2 px)."""
import json, numpy as np, os
_here = os.path.dirname(os.path.abspath(__file__)) if '__file__' in globals() else '.'
_regf = 'registration.json' if os.path.exists('registration.json') else os.path.join(_here, 'registration.json')
R = json.load(open(_regf))
P = np.array(R['tps']['P']); Wt = np.array(R['tps']['W'])
def U(r): return np.where(r > 0, r * r * np.log(r + 1e-12), 0.0)
def px2world(q):
    q = np.atleast_2d(np.asarray(q, float))
    K = U(np.linalg.norm(q[:, None] - P[None], axis=2))
    A = np.hstack([q, np.ones((len(q), 1))])
    return K @ Wt[:len(P)] + A @ Wt[len(P):]
_inv = None
def world2px_fast(w):
    global _inv
    from scipy.interpolate import LinearNDInterpolator
    if _inv is None:
        xs, ys = np.meshgrid(np.arange(-900, 2300, 8.0), np.arange(-700, 1500, 8.0))
        q = np.stack([xs.ravel(), ys.ravel()], 1)
        _inv = LinearNDInterpolator(px2world(q), q)
    return _inv(np.atleast_2d(np.asarray(w, float)))
