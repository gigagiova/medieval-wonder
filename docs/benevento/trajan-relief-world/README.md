# Photographic reliefs in the production world

Validation completed 27 October 2026 against the current source build
(`index-Na4SHZVP.js`); no deployment was performed by this audit.

`aurea30.png` is the actual production game at 390×844/DPR1, at the exact
camera coordinates and rotation used in the earlier gate comparison. It shows
the new narrative relief fields in the game's dusk lighting, connected walls
and open passage. The image was opened and visually inspected. The reliefs
remain soft at this phone distance; simplified capitals, wing motifs and frieze
remain outside the photographic replacement. Source-photo illumination and
colour differences remain visible, particularly on passage panels.

The build passes. No page, shader or application-resource errors were recorded.
The attachment uses its near geometry (28,672 triangles), one shared material,
and a GPU-compressed 1024² atlas. `report.json` records the pre-screenshot sample:
122,373 submitted triangles / 56 calls. During the slow software-GPU screenshot,
async NPCs/textures finished loading: the saved HUD shows approximately 136k
triangles / 80 calls / 89 textures instead. Both observed samples are below the
350k / 130 project budget. These differing population/asset states do **not**
establish a performance improvement over the previous arch, nor a real-iPhone
frame-rate result. The current harness now also records an after-capture sample
on future runs; the existing report is preserved as actually measured.

Optional external Google Fonts stylesheets were replaced with empty CSS for
this capture, using existing fallback fonts; absent favicon requests were
answered with 204. TLS verification was not disabled. All application/texture
and shader errors still fail the harness.

Reproduce after `npm run build`, using a production Vite preview server:

```sh
python tools/check-trajan-world.py --base http://127.0.0.1:5432 \
  --before /workspace/npc-audit/gates-world-before \
  --out docs/benevento/trajan-relief-world
```

The before camera comes from the saved original full-world gate audit. Compare
`../gate-world-validation/aurea-route-after.png` (primitive figures) against
`aurea30.png` here (photographic reliefs), while keeping the async NPC/lighting
state limitation above in mind. The isolated eight matched architecture views
remain in `../trajan-relief-integration/` and provide the clearer sculpture
comparison under controlled neutral lighting.

## Combined release verification

`release/` verifies the relief attachment together with the subsequently revised
brazier and touch-only phone looking (`index-De9oo6HE.js`). Build and shader checks
pass; the same saved gate camera shows the reliefs, connected walls and open
passage. After the screenshot and asynchronous NPC loading, the measured view
submits **136,009 triangles / 81 draws**. The 1024² relief atlas is GPU-compressed;
application errors are empty. This remains a software-rendered budget check,
not an iPhone frame-time measurement.
