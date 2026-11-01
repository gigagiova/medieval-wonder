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
4 points, and nothing else is rendered (no post-processing).
