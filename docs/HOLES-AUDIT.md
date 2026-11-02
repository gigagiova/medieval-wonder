# Holes audit

The owner's report (October 2026): the ground is full of holes, the inner faces
of roofs can be seen from the street (one sees the sky through them), and pots
and bowls have no insides. This document describes the two automated audits
that find every instance of these defects, the causes they found, the fixes at
the source, and the before/after numbers.

## How to run

```sh
npm ci
# 1. Geometry audit (node, ~45 min for the whole world; --quick: the centre of the town, ~12 min)
npx tsx tools/audit-holes.ts --out docs/holes-audit/after
# 2. Render audit (headless Chromium + SwiftShader, ~1 h for the 34 fixed standing points)
npx vite build
node tools/audit-holes-render.mjs --out docs/holes-audit/after/render --views tools/holes/views.json
# 3. Rendering budget (?debug numbers at 390x844)
node tools/holes/budget.mjs --out docs/holes-audit/after/budget.json
```

The render audit needs Playwright's Chromium; it uses the global
`playwright` package when the project has none.

### 1. Geometry audit (`tools/audit-holes.ts`)

It builds the world's geometry in node the way the game does
(`tools/holes/scene.ts`): every town chunk through `buildChunk` exactly as the
fabric worker builds it, in full detail (tessellation scale 1.9) and in middle
detail (`DETAIL.mid`, scale 5); the landmarks through `buildLandmarks()` (the
same function `buildWorld()` calls, exported for this), Ponte Fratto and the
rivers. Every triangle carries its material, its draw side and a source tag:
`Builder.add` and the house kit's `Acc.tri` are wrapped for the audit only
(`tools/holes/tag.ts`, no change to the game's code paths) and read the owner
module and helper from the V8 call stack, e.g.
`town.ts#buildHouse > arch/roof.ts#tiledLeanTo`.

It then measures:

- **A. Ground holes.** Over the whole world (2,350 × 1,360 m, all 3,225
  chunks) a point every 0.5 m (jittered inside the cell); a ray down from 0.8 m
  above the terrain must meet a surface (either side) within 2.3 m (stair
  openings: 14 m). Points inside the footprint of a house one cannot enter are
  skipped (its walls hide them); every other point counts: lanes, yards,
  gardens, the fields outside the walls, landmark precincts. Done for the full
  and the middle detail. The outer 0.45 m of each chunk is left to test B
  (the displacement field moves a chunk's border sideways by up to 0.3 m, and
  only the neighbour's ground covers that).
- **B. Seams between levels of detail.** Along every chunk border, the
  largest vertical gap between the full (0.64 m grid), middle (2 m) and
  stand-in (4 m, 3 cm low) ground as bent by the field, and whether skirts
  deep enough to close it hang under both sides.
- **C. What a standing person sees.** From a 4 m grid of standing points (on
  the floor found under each point, eye 1.65 m up) in and around the walled
  town, round every landmark and along the roads: 38–39 thousand points,
  120 rays each (elevation −35° to +85°, 32 m long, a chunk of apron so they
  never leave the loaded geometry). The first surface hit: if it is the back
  of a one-sided surface (and no front face lies within 2 cm, i.e. it is not
  one of a pair of surfaces given both sides), that is a see-through defect,
  counted against the triangle's source; a ray going down that meets
  nothing before it passes under the terrain looks through a hole in the
  ground. Standing points inside a solid (most of their rays meet back faces)
  are skipped and counted.
- **D. Open shells.** Boundary edges (vertices welded at 1 mm) per source
  and material: the inventory of open surfaces. Most are harmless (the
  bottoms of walls under the ground, tiles lying on boards); C says which
  ones are seen from behind.
- **E. glTF props and trees.** For every model in `public/models/props` and
  `public/models/trees`: open edges, whether the materials are double-sided,
  and the share of rays from a dome of viewpoints round it that would meet a
  back face if it were drawn one-sided.

Outputs: `report.json` (summary, per module, per source with sample points
and the eye that saw them, assets, worst standing points, seams, hole points),
`holes-map.png` and `holes-map-town.png` (1 px = 1 m; red: ground holes in
full detail, blue: middle detail, orange: where a sightline went through the
ground, magenta: back faces seen and the worst standing points), `grid.json`
(one standing point per 40 m cell) and `views.json` (the worst points).

### 2. Render audit (`tools/audit-holes-render.mjs`, `src/holesview.ts`)

`?holes` turns the built game into a debug view: every material is swapped
for a flat one drawn on both sides, grey in front; the back faces of one-sided
materials are pure magenta (in the game they are culled, and one sees through
them). The clear colour is pure green; a copy of the terrain 0.6 m under the
real ground is drawn pure green within 90 m (no copy under stair openings and
wells), so a hole in the ground shows green; a fog-grey sphere 120 m out stands
for the fog, and both markers give way to grey where the game's fog would
leave less than 15 % of a surface (the same fog model as `fogcull.ts`). The
post-processing is skipped, the culling (distance, fog, occlusion buffer,
clusters) is the game's own.

The script serves `dist/`, and for each standing point of
`tools/holes/views.json` (34 points: every 14th point of the 40 m lattice of
the geometry audit, plus the 10 worst places it found, all fixed so before and
after use the same views) stands there with the game's own teleport (floor
found on the collider), waits for the town round it to finish streaming, and
renders 4 yaws × 2 pitches (+0.22 rad: roofs; −0.3: the ground) at 390×844.
It counts magenta and green pixels (green: below the horizon) by `readPixels`,
saves every frame and a contact sheet per point.

SwiftShader stability: a previous attempt that teleported to many places in
one page crashed. Here the viewport is the phone's at pixel ratio 1, every move
waits for `stream.ready` before a frame is drawn, the page is reloaded every
4 points, and nothing else is rendered (no post-processing). No run crashed.

`tools/holes/summarize-render.mjs before/render.json after/render.json` gives
the totals over the same frames. A frame more than 40 % magenta is a camera
standing inside a solid (the teleport lands on the ground inside a house one
cannot enter, or a pier), as the geometry audit's skipped points; such frames
are left out of both totals.

## What the audits found, and the causes

Classes, each traced to the code that makes it:

1. **Ground left out between houses** (`fabric.ts makeChunks`). The ground of
   a chunk was masked wherever the layout raster said HOUSE. The raster's
   HOUSE also covers the slivers, courtyards and back yards between the lots
   of a block that no house stands on, and, after the plan trace, cells round
   traced footprints. There the ground simply was not drawn: holes seen
   through the gaps between houses, from the lanes and from any height.
2. **Middle-detail holes by the walls** (`fabric.ts ground`). A ground quad
   was hidden when the 1 m round its centre was under a house. Right for the
   0.64 m quads of full detail, wrong for the 2 m quads of the middle detail
   (40–96 m): they were dropped while sticking a metre out of the house.
3. **Seams between levels of detail** (`fabric.ts ground`, `stream.ts`). The
   ground of full (0.64 m), middle (2 m) and stand-in (4 m, 3 cm low) chunks
   is bent by the same field but sampled at different spacing, so their
   borders part by up to 0.22 m (full/middle) and 0.75 m (middle/stand-in) on
   steep ground: slits of sky along every chunk border at the detail
   boundaries (all 6,450 tested borders were over 2 cm).
4. **Landmark floor masks larger than the floors** (`sites.ts`, Codex's floor
   masks): S. Maria's mask was one rectangle over the nave, aisle, library and
   1.2 m beyond the walls; S. Pietro's the same. Only the nave and library
   have slab floors, so the ground was missing in the aisle, outside the west
   wall and round the apse: the two largest clusters of holes.
5. **Roofs without an underside.** `town.ts polyRoof` (every house on a
   footprint that is not a quad, and every tower house: most traced
   footprints) laid tiles on a one-sided board surface with only a strip of
   boards along each edge's overhang, with gaps at every corner; from below,
   in the gaps and wherever the strip did not reach, one saw the sky through
   the roof. `tiledLeanTo` houses stood open under the high side and the
   raking ends of their roof (walls stop at the eaves height). The open mouths
   of the half-round cover tiles at the eaves, the top course of lean-tos and
   the ends of the ridge rows show their culled insides: slivers of sky. The
   gable ends of the tiled boards were open slits.
6. **Containers without insides.** The storage jars by the doors and on
   balconies (`arch/dress.ts jar`) were an outer lathe open at the top: from
   eye height one looked into the mouth and through the jar. The same for the
   open cylinders of the library (box, mortar, crucibles), the palace's
   bronze basin and the horn lanterns' horn and lid (`lights.ts`).
7. **Theatre**: the cavea's core is a shell of treads and risers, seen from the
   passages under it through the outer arches; its vaults were drawn from
   inside only.
8. **Leaf cards** (merged from main: the new garden beds, vines and tussocks
   in `plotbuild.ts`): blades and leaves are single triangles in the one-sided
   'leaf' material, invisible from behind.
9. **World edge**: the coarse stand-in ground stopped at the world's bounds,
   within the fog of a walker near the edge (Nux Sacra, 80 m from the north
   edge).

The props from glTF (Poly Haven pots, bowls, buckets, baskets, barrels) are
all `doubleSided` in their files (audit E): their insides are drawn, with the
outer texture. The one one-sided model, the Sketchfab cart, is closed where it
can be seen (no back faces from the dome of viewpoints).

## Fixes at the source

| Class | Fix | Where | Cost |
|---|---|---|---|
| 1 | The ground is left out only under houses actually built: each closed house's own footprint polygon, rasterised into every chunk it covers (explorable houses and ruins keep their floors). | `fabric.ts makeChunks` | none |
| 2 | A quad is hidden only if every mask cell its own corners (plus 0.25 m) fall in is under a house. | `fabric.ts ground` | none |
| 3 | Skirts (Ulrich 2002, *Rendering massive terrains using chunked level of detail control*): a 0.8 m strip hanging from every chunk border, facing out; the stand-in ground gets the same where a detailed chunk begins. | `fabric.ts ground`, `stream.ts` | ~400 triangles per full chunk, ~130 per middle chunk |
| 4 | Floor masks fitted to the slabs actually built (nave, library); the mask's 0.6 m margin lies under their walls. The reserve keeps the precinct free in the layout. | `sites.ts` | none |
| 5 | polyRoof: a full underside of boards, 7 cm under the tile surface, facing down (the house's ceiling and the eaves' soffit in one), replacing the edge strips. Lean-to houses: the walls carried up under the slope. Cover tiles: the mouth closed at the eaves course, both ends of a lean-to's rows, both ends of ridge rows (`coppo(..., cap)`). Tiled gables: the board slab closed at the gable ends. | `town.ts`, `arch/roof.ts`, `arch/kit.ts` | polyRoof ~+30–60 triangles per house; caps 3 per capped tile |
| 6 | Jars get a lip, an inner neck going down and a floor (faces inward). Open vessels and lantern shells go through `bothSides()` (the same surface again, wound the other way). | `arch/dress.ts`, `builder.ts`, `library.ts`, `palace.ts`, `lights.ts` | jars +3 triangles per segment; small |
| 7 | The cavea core's treads and risers also facing the other way; vaults drawn inside and out. | `theatrum.ts` | ~+2,300 triangles |
| 8 | The Builder draws every piece in a thin-card material ('leaf') from both sides. | `builder.ts` (`THIN`) | doubles leaf triangles |
| 9 | The stand-in ground runs on to its super-chunk's edge (up to 96 m past the bounds). | `stream.ts` | a few hundred triangles at the edge |

Why geometry rather than double-sided materials: the surface materials are
shared by the whole town (one draw per material); `side: DoubleSide` on them
would rasterise every back face of every closed wall and roof in the town.
Apple GPUs remove hidden fragments before shading, but not the rasterisation
and binning of the extra triangles, and coincident party walls of adjacent
houses would z-fight. Each class is closed where it is open instead, at a cost
of tens of triangles per house; double-sidedness is used only for thin cards
and thin vessels, as geometry (`bothSides`), not as a material state.

## Before and after

Before: `main` at cd9bc69 (plan trace and open-ground fill merged) with only
the audit instrumentation added. After: this branch merged with that `main`.
Same tools, same views. Files: `docs/holes-audit/before/`, `after/`
(`report.json`, `holes-map.png`, `holes-map-town.png`, `render.json`,
`budget.jsonl`), `render-summary.json`, and `pairs/` (each image is before on
the left, after on the right, same view).

### Geometry audit (whole world)

| | before | after |
|---|---|---|
| Ground points tested (0.5 m) | 11,678,702 | 11,678,702 |
| Ground holes, full detail (open / under raster HOUSE but outside a house / deliberate openings) | 1,366 / 1,021 / 16 | 20 / 0 / 16 |
| Ground holes, middle detail | 3,446 / 1,312 / 30 | 291 / 23 / 30 |
| Chunk borders whose LOD seam is not covered by skirts (of 6,450; max gap 0.22 m full/middle, 0.75 m middle/stand-in) | 6,023 | 0 |
| Standing points / rays | 43,229 / 5.19 M | 43,290 / 5.19 M |
| Rays meeting a back face (per mille) | 7,313 (1.41) | 2,777 (0.53) |
| Standing points that see a back face | 2,926 | 1,611 |
| Rays seeing through the ground within 32 m | 1,229 | 1,018 |
| Sources with open boundaries / seen from behind | 200 / 73 | 178 / 61 |

Biggest sources seen from behind, before → after (rays): theatre cavea core
2,577 → 0; polyRoof boards (`town.ts#split`) 1,163 → 324; hipped-roof tiles
(`polyFaceTiles`) 1,125 → 824; theatre seats 379 → 191; lean-to roofs of
houses 212 → 40; huts' lean-tos (plotbuild) 159 → 31; theatre vaults 120 → 0;
gable boards of huts 84 → 0.

### Render audit (34 standing points × 8 views, 390×844)

Over the same 258 frames (22 frames whose camera the teleport put inside a
solid left out of both):

| | before | after |
|---|---|---|
| Magenta pixels (back faces seen) | 1,673,124 | 563,939 (−66 %) |
| Green pixels below the horizon (ground holes) | 314,100 | 1,878 (−99.4 %) |
| Frames with green | 17 | 4 |
| Frames with more than 100 magenta pixels | 106 | 93 |

Worst frames, before → after (magenta / green): Nux Sacra by the north edge
`w05_y180_p-30` 0/162,957 → 2/0; under the theatre cavea `w00_y90_p22`
125,666 → 2,671, `w02_y90_p-30` 114,565 → 12,419, `w02_y0_p22` 101,199 →
351, `w04_y0_p-30` 89,468 → 17,702; town eaves `g098_y-90_p22` and
`g126_y90_p-30` (see `pairs/`). The render runs predate the last change
(tile caps flush with the tile end instead of 3 cm back, which left a
magenta crescent in each capped tile mouth in `g098`); that change is not in
these numbers.

### Rendering budget (`?debug` numbers, 390×844, headless; not phone fps)

| View | before tris / calls | after tris / calls |
|---|---|---|
| Curtis Ducis | 296,491 / 147 | 293,650 / 147 |
| Episcopium | 249,253 / 88 | 259,695 / 88 |
| Forum | 236,114 / 97 | 264,828 / 97 |
| Porta Aurea | 155,967 / 132 | 159,995 / 132 |
| Theatrum | 93,790 / 78 | 101,563 / 78 |
| Town (−60, −290) | 108,349 / 94 | 110,313 / 94 |
| Town (40, −200) | 87,662 / 51 | 94,367 / 51 |
| Town (200, −180) | 222,853 / 48 | 224,835 / 48 |

No fix adds a material or a draw call; triangles grow by up to 12 % (Forum,
+29k), all views under 350k. Curtis Ducis (147) and Porta Aurea (132) were
already over ~130 draw calls on `main` before this work.

## What is left

- **Hipped-roof tiles** (`polyFaceTiles`, 824 rays) and some polyRoof boards
  (324): tiles at the hips and eaves of traced footprints still show slivers
  of their insides from below. Not fully diagnosed.
- **Curtain wall** (`fabric.ts curtain > ruin`, 580 rays): mostly standing
  points against or inside the thick wall where curtain pieces overlap; not
  fully diagnosed.
- **Theatre seats** (191) where blocks lie over gaps in the core.
- **Huts' lean-tos** in `plotbuild.ts` (map agent's file) stand open under
  their high side, as the houses did; the house fix (`town.ts`, walls carried
  up under the slope) was not copied into plotbuild.
- **Sightlines through the ground** fell only from 1,229 to 1,018 rays.
  Most are outside the walls on rough ground: the test compares against the
  field-bent ground height, and some remaining cases may be test noise.
- **Middle detail** keeps 291 open hole points, mostly at house corners where
  2 m quads cannot follow the footprint. They are 40–96 m away, in fog.
- **Porta Gloriosa** (`w11`): the camera ends up in the gate masonry, and
  that frame is 30 % magenta in both runs.
- **glTF props** are double-sided in their files: their insides draw the
  outer texture, lit from the other side. They no longer show through, but a
  dark inner texture would look better.
- **sites.ts floors** now feed `layout.ts` §2 too (as RESERVED raster). The
  smaller polygons do not change the layout: the episcopium's `reserve`
  covers it, and S. Pietro lies outside the walls.

## Round 2 (2 November 2026)

Before is published `main` 0f7f90d; after is this round's work. The geometry
audit covers the whole world and uses the same (updated) tool for both runs. The
render audit was rerun only for the affected standing points (w00, w02 under the
theatre cavea; g098, g126 town eaves; w11 by Porta Gloriosa). Files are in
`docs/holes-audit/round2/`; each image in `pairs/` is round 1 on the left and
round 2 on the right.

**Causes and fixes**
- **Holes at hipped-roof corners** (`town.ts polyRoof`). Each wall pushed its
  own eave square out from itself. On every corner that is not a right angle
  (most traced footprints), the two roof faces left a triangular hole between
  them, boards and tiles included. From below, one saw the tiles' insides
  through it. Fix: the eave corners are now mitred, i.e. the point where the
  two eave lines cross, clamped to 3 × the overhang on sharp corners.
- **Huts' sheds** (`plotbuild.ts`). The back wall now goes up to the roof's
  boards, as in the lean-to houses. The front is open by design.
- **Theatre.**
  - Seat blocks now always have their back (they had one only where the row
    behind was robbed).
  - Ruined walls (`shapes.ts jaggedWall`, the theatre's upper walls on the
    cavea) were open underneath and are seen from the passages below. They now
    have a bed: one face underneath, wherever `ruin()` is used.
- **Curtain wall (580 rays): not a visible defect.** Nearly all of it comes
  from standing points such as (−294, −378), which lies 0.66 m from the axis
  of the 2.5 m-thick curtain. The audit found the ground inside the wall and
  stood there, but the curtain's box collider keeps players out. A new
  level-ray rule (most level rays meeting a back face within 6 m means the
  point is inside a solid) did not catch these points.
- **Porta Gloriosa: not a travel point.** The gate's teleport is at
  (−52.9, −325.3), 9 m out from the built gate (−56.9, −317.2). The view w11
  (−81.9, −318.0) is a geometry-audit standing point inside the curtain, by
  the plan position the gate was traced near. It is the same kind of
  standing point as above; no travel point moved.

**Geometry audit (whole world)**

| | before (0f7f90d) | after |
|---|---|---|
| Rays meeting a back face | 2,609 (0.50 ‰) | 2,074 (0.40 ‰) |
| Standing points seeing a back face | 1,528 | 1,273 |
| Sources seen from behind | 60 | 53 |
| Hipped-roof tiles / boards (`polyFaceTiles` / `split`) | 734 / 324 | 722 / 194 |
| Theatre seats / theatre ruins | 191 / 168 | 0 / 0 |
| Ground holes, LOD seams, sightlines through the ground | unchanged (20 + 291 mid, 0, 1,014) | unchanged |

**Render audit, affected points (38 comparable frames):** magenta 302,510 →
204,844 pixels. Of what is left, 200,000 pixels are w11's two frames from inside
the curtain. Theatre frames w00/w02 go from 92,276 → 37 pixels. Town eaves:
g098 −76 %, g126 −24 %.

**Still left**
- Tiles on hipped roofs (722 rays): small slivers at ridges and eaves seen from
  the far side (the dots along the ridge line in `g126_y180_p22`).
- Hanging cloths and pieces on balconies (`dress.ts hang`, 65 rays).
- The curtain standing-point artefact above.

## Round 3 (2 November 2026, merged with main a6b7e5a)

**Fixes**
- **Tiles on hipped roofs** (`town.ts polyFaceTiles`, `arch/roof.ts`).
  - The eave course now starts 6 cm in from the eave (gables and lean-tos:
    it stops 6 cm short). Its tube is tilted outward and used to hang past
    the boards, open underneath.
  - The tile ends at the start of each hip and at both ends of each ridge
    row are capped.
  - The row tiles of hipped roofs are closed underneath by a chord (`coppo(..., under)`).
    Their rows run out over hips and mitred corners, and from below or from
    across the roof their culled insides showed (the dots along ridge lines).
    Cost: 2 triangles per tile on hipped roofs.
- **Hung cloths** (`arch/dress.ts`, the sheets folded over a pole): both sides.
- **Audit:** standing points inside the town wall's masonry are skipped: the
  curtain's 2.5 m width plus 0.3 m, and the towers. The curtain's collider is
  solid, and the ground runs on under it. The render summary takes `--skip`,
  and w11, the camera inside the curtain, is left out of the render totals.

**Geometry audit (whole world)**

Round 2 and the final run were both measured with the round-3 tool. Round 1's
figure comes from the older tool, which still counted standing points inside
the wall, so it is not exactly comparable.

| | round 1 | round 2 | final |
|---|---|---|---|
| Rays meeting a back face | 2,777 | 1,490 (0.29 ‰) | 1,160 (0.22 ‰) |
| Standing points seeing a back face | 1,611 | 1,252 | 955 |
| Hipped-roof tiles (`polyFaceTiles`) | 824 | 718 | 521 |
| Hung cloths (`hang`, all) | 127 | 127 | 0 |
| Sources seen from behind | 61 | 52 | 48 |

With the round-3 tool, 600 standing points are skipped as inside the wall's
masonry. Ground holes (20 full, 291 middle, 16 + 30 deliberate openings), LOD
seams (0 uncovered) and sightlines through the ground (1,014) are unchanged.

**Render audit (all 34 points, w11 left out)**

| | original main | round 1 | final |
|---|---|---|---|
| Magenta pixels | 1,472,320 | 478,161 | 202,531 |
| Green pixels below the horizon | 314,100 | 1,878 | 1,880 |
| Frames with more than 100 magenta pixels | 104 | 97 | 71 |

The original and round-1 columns come from two `summarize-render.mjs` runs
(each against the final render), so the frames each one leaves out as "inside
a solid" differ slightly. Files: `docs/holes-audit/round3/` (both reports, the
final render, the summaries, `pairs/` round 1 | final).

**Budget (`?debug`, 390×844, headless)**

| View | round 1 | final |
|---|---|---|
| Curtis Ducis | 293,650 tris / 147 calls | 302,682 / 146 |
| Episcopium | 259,695 / 88 | 261,422 / 88 |
| Forum | 264,828 / 97 | 264,888 / 97 |

All three views are under 350k triangles. Curtis Ducis's draw calls were
already over ~130 on main before the holes work.

**Left**
- Hipped-roof tiles: 521 rays, slivers at some corners.
- polyRoof boards: 194 rays.
- The edges of balcony and pentice roofs (seen in `g126_y180_p22`).
- The water seen from below at the bridges: 47 rays.
