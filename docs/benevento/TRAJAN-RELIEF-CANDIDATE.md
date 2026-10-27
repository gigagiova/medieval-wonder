# Exact-monument photographic relief candidate

The previous ellipsoid/cylinder figures are inadequate for recognisable Roman
sculpture. This isolated candidate changes the representation, rather than
adding more primitives. It uses a real, openly licensed photograph of the actual
upper-pier relief and a shallow depth field inferred from that photograph.

## What is verified

Bernard Gagnon's image 03 is CC0, 4313×3081 px. The scene matches a separately
photographed Commons image labelled imperial stability/security; this label is
an uploader identification, not a newly verified archaeological interpretation.
See `TRAJAN-RELIEF-ASSETS.md` for metadata, other exact-monument fields and URLs.

The browser candidate compares four approaches from identical front and oblique
cameras, with the directional light on opposite sides:

* The rejected primitive figures, merged as in production (control).
* Flat photographic panel with reduced large-scale illumination and contrast.
* Photo plus inferred shallow geometry, 80×64 cells.
* The same inferred surface at 40×32 cells for a lower phone geometry cost.

The source photograph has strong sunlight. We explicitly **do not use raw image
brightness as depth**: that would carve shadows into stone. Instead the offline
Apache 2.0 Depth Anything V2 Small model estimates coarse relative depth from
semantic structure. The output is normalized and compressed to18 cm. The choice
of compression is artistic, not a measurement of the monument. Geometry normals
react to scene lighting. No inference library/model runs in the game.

## Remaining limitations

This is an inferred 2.5D relief, **not a photogrammetric scan**. It cannot recover
undercuts, missing backs of projecting heads, or all fold geometry. Fine details
are still primarily photographic. Large-scale illumination flattening reduces
but does not remove captured shadows; reverse-light views expose that limitation.
Current erosion/damage is present in the photograph and cannot be dated to 700.
The neutral-light audit is not proof of matching the dusk game materials.

The production source now replaces all 14 main narrative fields: 8 pier scenes,
4 attic scenes and 2 passage scenes. These are 14 distinct photographs/crops,
assigned by visual matching against the two facades. Five countryside fields
have only roughly 250–350 px source crops; dedicated high-resolution photographs
would improve those. The smaller architectural motifs, capitals and frieze are
still simplified geometric work and are not claimed to be exact sculpture.

`src/benevento/trajan-reliefs.ts` attaches a single UV-preserving merged mesh to
the existing site group, using the shared atmosphere and standard scene lights.
Builder's world-material batching discards UVs, which is why this attachment is
separate. The one 1024² atlas allocates 256² cells to facade fields and 512×256 to
the two passage fields. The atlas ships as GPU-compressed KTX2 with WebP fallback;
no runtime inference or extra model library is included. Beyond 40 m the
attachment switches to the same atlas on 28 triangles; beyond 100 m it is
culled. This automatic distance LOD preserves the single quality mode. Source/derivative
licences and authors are recorded in `public/models/trajan/CREDITS.md`.

Final isolated integration: 8 matched captures against snapshot 48d8682, zero
page/console/texture errors, central passage ray clear. Front/rear/oblique submit
54,536 triangles / 6 draws versus 44,104 / 5, including audit floor. Passage view submits
42,978 / 3 versus 32,546 / 2. These are isolated counts, not the full-town phone budget.
The full-town check is tracked separately. The existing published deployment
has not been replaced by this experiment merely because source is integrated.

## Reproduction and evidence

`tools/bake-trajan-relief.py` writes photo derivatives and inferred depth into
`public/models/trajan-candidate/`; it currently expects the documented external
source/model caches. `tools/trajan-relief-audit.ts` renders the candidate without
production edits. `tools/capture-trajan-relief.py` records all views and fails on
any page/console error. Use a fresh Vite instance after source edits to avoid the
no-watch audit server's stale modules. Evidence:
`docs/benevento/trajan-relief-candidate/`.

The learned depth method/reference is verified accessible:
https://depth-anything-v2.github.io/
https://huggingface.co/onnx-community/depth-anything-v2-small

Sketchfab API searches for Benevento, Trajan Benevento and Arco di Traiano found
no verified downloadable scan of this arch. The Ancona arches returned by name
search are a different monument and are unsuitable replacements.

Production asset regeneration: `tools/bake-trajan-panels.py` uses the frozen
14-field manifest from the documented source cache and writes the atlas/depth
JSON. `tools/encode-trajan-reliefs.mjs` generates the GPU-compressed derivative;
its optional `TRAJAN_ENCODER_MODULE` points to an externally installed encoder,
so no runtime dependency/package-lock change is required. Author and source
records are preserved in `public/models/trajan/sources.json`.

`tools/capture-trajan-integration.py` regenerates the prior primitive model from
commit 48d8682 and captures identical full-monument cameras. The fixture uses
production materials, neutral common lighting and a common floor. The separate
`tools/check-trajan-world.py` runs the actual production game at 390×844, checks
that the new atlas is GPU-compressed and enforces the 350k-triangle / 130-call budget.

Production-world validation is now complete: current build passes, exact gate
camera matches, photographic reliefs are present with a GPU-compressed 1024²
atlas, and no application/shader errors were recorded. The pre-capture sample
is 122,373 triangles / 56 draws; the saved HUD after asynchronous NPC arrivals
shows approximately 136k / 80. See `trajan-relief-world/README.md` for the timing
and comparison limitations. This is not an iPhone frame-rate benchmark and has
not itself published the changes.
