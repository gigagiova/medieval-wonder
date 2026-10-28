"""Register the plan (px) to the world (m) with identifiable control points.
Affine least squares (report residuals), then a thin-plate spline through the
points so the plan's internal layout lands exactly on the real landmarks."""
import json, sys, numpy as np
OUT = sys.argv[1] if len(sys.argv) > 1 else "registration.json"
# Version 2 (28 Oct 2026, docs/benevento/PLAN-TRACE.md): the Arch of Trajan is matched where the
# plan's north edge passes under triangle 3 (the arch was the gate in the curtain), not at the
# triangle's centroid 18 px inside the town; four surviving wall towers mapped in OSM are matched
# to the projections drawn on the plan's outer line (see docs/benevento/towers/osm-inventory.json).
CP = [  # name, plan px, world m, source of world coordinate
    ('Arch of Trajan', (923.0, 167.1), (389.26, -225.58), 'OSM way 122652341 footprint centroid; plan north edge under triangle 3 (line (912,161)-(946,180) at x=923)'),
    ('Arch of Sacramento', (469.0, 444.5), (-75.7, -60.6), 'OSM building centroid; plan edge of Civitas Nova under triangle 4 (line (453,433)-(492,461) at x=469)'),
    ('Roman theatre', (322, 497), (-222.0, -23.0), 'OSM cavea polygon 373842941 centre; plan semicircle "2" centre'),
    ('Rocca dei Rettori', (1220, 515), (623.0, 148.0), 'OSM way 480370253 centroid; plan SE castle'),
    ('NE wall corner (Torre del Santo Panaro)', (1205, 216), (675.0, -149.0), 'OSM building centroid; plan outline NE corner'),
    ('Road to Ponte Vanvitelli at the N wall', (472, 158), (-75.0, -318.0), 'OSM highway "Ponte Vanvitelli" reaching the bluff; plan double line (north stub)'),
    ("West tip (Port'Arsa)", (42, 462), (-504.0, -81.0), "OSM city_gate Port'Arsa; plan outline W tip"),
    ('Torre della Biffa', (240.65, 132.1), (-285.41, -377.9), 'OSM way 1015674808 centroid; projection on the plan north line'),
    ('North tower (OSM 1016982302)', (843.85, 134.4), (314.49, -286.22), 'OSM way 1016982302 centroid; projection on the plan north line'),
    ('North-east tower (OSM 480303640)', (1047.85, 172.4), (528.57, -211.78), 'OSM way 480303640 centroid; projection on the plan north line'),
    ('East tower (OSM 1015674809)', (1209.45, 358.95), (666.01, -9.44), 'OSM way 1015674809 centroid; plan east line (slight projection)'),
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
           'tps': {'P': P.tolist(), 'W': Wt.tolist()}}, open(OUT, 'w'), indent=1)

