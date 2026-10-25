"""Register the plan (px) to the world (m) with identifiable control points.
Affine least squares (report residuals), then a thin-plate spline through the
points so the plan's internal layout lands exactly on the real landmarks."""
import json, numpy as np
CP = [  # name, plan px, world m, source of world coordinate
    ('Arch of Trajan', (923, 185), (389.1, -223.8), 'OSM way 249... building "Arco di Traiano" centroid; plan triangle 3 centroid'),
    ('Arch of Sacramento', (469, 425), (-75.7, -60.6), 'OSM building centroid; plan triangle 4 centroid'),
    ('Roman theatre', (322, 497), (-222.0, -23.0), 'OSM cavea polygon 373842941 centre; plan semicircle "2" centre'),
    ('Rocca dei Rettori', (1220, 515), (623.0, 148.0), 'OSM way 480370253 centroid; plan SE castle'),
    ('NE wall corner (Torre del Santo Panaro)', (1205, 216), (675.0, -149.0), 'OSM building centroid; plan outline NE corner'),
    ('Road to Ponte Vanvitelli at the N wall', (472, 158), (-75.0, -318.0), 'OSM highway "Ponte Vanvitelli" reaching the bluff; plan double line (north stub)'),
    ("West tip (Port'Arsa)", (42, 462), (-504.0, -81.0), "OSM city_gate Port'Arsa; plan outline W tip"),
]
P = np.array([c[1] for c in CP], float); Wd = np.array([c[2] for c in CP], float)
A = np.hstack([P, np.ones((len(P), 1))])
B = np.linalg.lstsq(A, Wd, rcond=None)[0]
res = A @ B - Wd
rows = []
for (n, p, w, src), r in zip(CP, res):
    rows.append({'name': n, 'plan_px': p, 'world_m': w, 'affine_residual_m': round(float(np.hypot(*r)), 1), 'source': src})
    print(f'{n:42s} residual {np.hypot(*r):6.1f} m')
rms = float(np.sqrt((res ** 2).sum(1).mean()))
sx = np.linalg.norm(B[0]); sy = np.linalg.norm(B[1]); rot = np.degrees(np.arctan2(B[0][1], B[0][0]))
print('affine RMS', round(rms, 1), 'm; scale', round(sx, 3), round(sy, 3), 'm/px; rotation', round(rot, 1), 'deg')
# Thin-plate spline (plan px -> world m), exact at the control points.
def U(r): return np.where(r > 0, r * r * np.log(r + 1e-12), 0.0)
K = U(np.linalg.norm(P[:, None] - P[None], axis=2))
n = len(P)
L = np.zeros((n + 3, n + 3)); L[:n, :n] = K; L[:n, n:] = A; L[n:, :n] = A.T
Y = np.vstack([Wd, np.zeros((3, 2))])
Wt = np.linalg.solve(L, Y)
json.dump({'controls': rows, 'affine': B.tolist(), 'affine_rms_m': round(rms, 1), 'scale_m_per_px': [round(sx, 3), round(sy, 3)], 'rotation_deg': round(rot, 1),
           'tps': {'P': P.tolist(), 'W': Wt.tolist()}}, open('registration.json', 'w'), indent=1)
np.save('ref_px2world.npy', B)
