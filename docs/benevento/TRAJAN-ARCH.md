# Arch of Trajan / Porta Aurea reconstruction

The architectural module is `src/benevento/arcus-traiani.ts`; shared dimensions
are in the dependency-free `arcus-traiani-dimensions.ts`, also used by the town
wall integration. The monument remains centred on the existing plan anchor.

## Sources inspected

* [Ministero della Cultura, Arco di Traiano](https://cultura.gov.it/luogo/arco-di-traiano),
  retrieved with its [frontal photograph](https://media.cultura.gov.it/mibac/files/boards/bec8803f226b6c1f1d4be3ed98d36b8e/Campania/732.jpg).
  The official account identifies the countryside face's provincial campaigns
  and the city face's peaceful acts and imperial benefactions. It records the
  restoration completed in 2002. The photograph was visually inspected as an
  architectural reference; it is not distributed as a game texture.
* [Wikimedia Commons, Benevento arco di Traiano.JPG](https://commons.wikimedia.org/wiki/File:Benevento_arco_di_Traiano.JPG),
  relief close-up retrieved by the parent investigation and visually inspected
  here. It shows overlapping figures and drapery occupying the narrative field,
  rather than detached statues spaced along its bottom. This photograph is a
  reference only; no pixels from it are included in the asset.
* The existing inscription transcription in `lore.ts`, attributed to **CIL IX 1558**,
  supplies the dedication's words. The geometry uses those words without claiming
  a facsimile of the original letterforms, punctuation or precise line spacing.

## Dimensions: explicit unresolved ambiguity

Published summaries repeatedly give a height of **15.60 m** and a figure of
**8.60 m** often labelled width. The old model used 8.6 m as its complete facade
width and produced a conspicuously narrow tower-like silhouette. The official
frontal photograph has a much broader facade relative to its height.

No measured architectural survey resolving that dimensional referent was
retrieved in this pass. The reconstruction therefore uses an explicitly
**photo-proportioned 13.4 m overall cornice width**, a 12.6 m core, 6 m depth, 5.2 m
clear opening and 5.6 m spring height, with total height 15.6 m. The facade width,
subdivisions, depth and opening are modelling estimates, **not new archaeological
measurements**. The 8.6 m discrepancy remains open for a surveyed plan/elevation.
Do not describe the new model as metrically exact.

## What changed and why

The old arch had a narrow central block, overlapping half-round columns,
block-like capitals, blank relief plaques and a dark rectangular attic patch.
The replacement follows the recognisable architectural hierarchy visible in
the monument's photographs:

* A single round-headed passage between broad piers on continuous plinths.
* Flat fluted Corinthian pilasters framing the relief registers, with shallow
  leaf lobes and volutes; these replace the old cylindrical engaged shafts.
* Two principal relief registers separated by the narrow band at impost level,
  framed attic reliefs flanking the broad dedication, and a processional frieze.
* Winged spandrel motifs, moulded archivolt, stepped architrave/cornice and a
  continuous full-width attic.
* Coffered intrados and two substantial passage-wall relief fields.

The relief figures, vegetation and procession are **simplified sculptural
approximations**. They reproduce the placement, density and depth of decoration,
not each scene's exact iconography. Contemporary regional/imperial figures are
not represented by the game's animated NPC meshes. A future properly licensed
scan or high-to-low bake could improve those sculptural details without changing
the architectural proportions.

Geometry is emitted without the generic world noise bend: that deformation made
precisely related pilasters, frames and entablature lines disagree. Terrain/site
placement is retained. Small geometric relief and weathered material detail
provide surface irregularity without turning the whole stone order into clay.

The scoped `carvedMarble` surface reuses the already resident marble texture set.
It reduces oversized scan pits, normal amplitude and baked cavity darkening so
those do not obscure the actual relief geometry. Other world marble/materials
retain their previous settings. This adds a shader variant, not a texture set;
the monument's carved parts remain merged by material. The inscription uses
vector glyphs from Three.js's bundled Optimer font, whose licence is distributed
at `public/licenses/three-optimer-font.txt`.

## Validation and reproducibility

`tools/capture-trajan.py` regenerates the pre-change architecture from commit
`9200a4ac1282c0d5fb23930b40e57c4adc970ff5`, then captures front, oblique and vault
views from identical cameras. It uses production materials with common neutral
audit lighting and the same floor, keeping the architectural comparison separate
from the town wall/road correction. Both architectures are placed in the same
current site frame for this comparison; the whole-world gate audit tests the
road alignment and connecting walls separately.

Run against a **fresh** Vite instance, for example:

```sh
python tools/capture-trajan.py --url http://127.0.0.1:5390
```

Evidence is in `docs/benevento/trajan-validation/`; `render-check.json` records
submitted triangles/draws and a horizontal passage collision ray. These isolated
counts include the audit floor and do not establish the full-town phone budget.
The town must additionally pass its 390×844 debug check. Desktop software-WebGL
timing is not a substitute for an iPhone run.

Final isolated verification (27 October 2026): all six screenshots rendered with
zero console/page/shader errors (`valid: true`). Front and oblique views submit
44,104 triangles / 5 draws versus 48,024 / 5 before; vault views submit
43,652 / 3 versus 47,572 / 3. The central passage ray has zero collision hits.
All three final views were visually inspected. Relief figures remain visibly
schematic at close range; this is an architectural reconstruction, not a scan
of the surviving sculptures. The figure groups and capitals now occupy their
architectural fields without the previous oversized material pitting.

## Subsequent sculptural correction

The primitive narrative figures described above were rejected by the owner.
Their replacement uses 14 distinct licensed exact-monument fields with shallow
inferred geometry and a shared photographic atlas. See
`TRAJAN-RELIEF-CANDIDATE.md`, `TRAJAN-RELIEF-ASSETS.md` and
`trajan-relief-integration/` for the later implementation, comparisons and limits.
