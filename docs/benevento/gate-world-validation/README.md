# Production-world gate checks

These are actual game captures at 390×844/DPR1, using Chromium/SwiftShader and the
production build. They include streamed geometry, terrain, game materials,
lighting, fog and culling. The isolated neutral-light gate fixtures are in
`../gate-validation/`; they answer different questions.

## Baseline diagnosis

The pre-change build was preserved until these four captures completed:

- `laurentii-near-before.png`: native Laurentii teleport, about 9 m from gateway.
  The narrow phone view does not show both lateral joins.
- `laurentii-approach-before.png`: 38 m back along the native approach direction.
  Both joins are visibly continuous.
- `laurentii-oblique-before.png`:same approach plus 20 m along the wall tangent.
  Both joins remain continuous.
- `aurea-route-before.png`:looking toward the Arch of Trajan from 30 m along the
  surveyed road axis. The old curtain wall blocks this view of the detached arch.

No San Lorenzo wall gap was reproduced in these three views. The gate's full
chunk was ready, visible and not occluded; the oblique diagnostic also records
its active pooled cluster mask. This is evidence about the tested positions,
not proof that every possible camera position is free of streaming defects.
No San Lorenzo culling/LOD fix is claimed.

`before.json` records actual camera coordinates/rotation, geometry/draw counts,
nearby streamed chunk status and cell bounds/visibility. Gate center is
(-381.375111,-319.321562), with tangent(-.766449, .642306).

## Capture limitations

Startup was CPU/software-GPU bound. The ordinary capture supervisor was paused
to retain its browser for multiple diagnostic views; its eventual 600 s timeout
is not a production loading failure. Screenshots and JSON were saved separately
through CDP. The initial shot used the existing `__step()` debug hook to finish
a delayed frame sequence. Later views waited for the production 36 m streaming
radius and rendered three frames. No JavaScript exception or application asset
failure was observed; external Google Fonts failed certificate verification and
used fallback fonts. TLS verification was retained.

Software-rendered FPS is not a phone benchmark. Geometry/draw counts are useful
budget checks; cached textures and animated NPC/fire/fog can differ between views.

## Final build and exact-camera comparison

`npm run build` passed: TypeScript and Vite, 159 modules, producing
`index-D0_jebvi.js` and `fabric.worker-DqKgwek8.js`. Vite retained its existing
large-bundle warning. The final capture used this production build on preview 5400;
no source-server cache was involved.

`tools/check-gate-world.py` reuses the saved **actual** baseline camera coordinates
and Euler rotation, asserts exact equality, and holds the camera steady during
capture to prevent capsule settling from shifting the comparison. It changes no
production behavior. The browser ran one world, streamed the second location,
and closed successfully. No page exceptions or shader compilation errors occurred.

- `aurea-route-after.png`: the old obstructing wall has become a clear approach
  corridor; the complete carved arch, both connected returns and open passage
  are visible. Both before and after use camera
  [413.00174096175056,44.8138444669465,-242.00164549934672],yaw 2.214297435588181,
  pitch 0.16.
- `laurentii-approach-after.png`: both existing joins remain continuous from the
  exact 38 m baseline camera. The San Lorenzo gap remains unreproduced in these views;
  this is a regression check, not evidence of a newly repaired San Lorenzo gap.

| Final view | Triangles | Draw calls | Cached GPU textures |
|---|---:|---:|---:|
| Aurea route |141,577|106|104|
| San Lorenzo 38 m approach |122,129|49|108|

Both final views fit the stated 350k-triangle/130-call street-level budget.
`after.json` contains exact counters and camera assertions; `final-progress.jsonl`
records loading and capture stages. Counts are snapshots, not a controlled claim
of performance improvement: stream/mid-LOD residency, NPCs and caches differ
between the before and after runs. The camera comparison is exact; animated fog,
lights and characters are not frozen. Software FPS does not establish iPhone FPS.
