> Superseded for Porta Aurea on28October2026: the return-wall connection below
> was collision-safe but created an incorrect inward pocket. See
> [the perimeter correction](../AUREA-ALIGNMENT.md) and its matched captures.
> These older screenshots are retained as historical validation evidence.

# Gate / curtain connection audit

The standing Porta Aurea anchor `(389,-224)` is 22.646 m from the nearest
registered circuit point `(403,-241.8)`. The old builder only cut a 9.6 m gap
at that projection; it supplied no connecting masonry. Its site rotation was
also zero while both the Via Traiana and the generated approach ran northeast.

The corrected site keeps its anchor and aligns its passage with Via Traiana's
existing `(24,-18)` direction: rotation `-atan2(24,18)`. Only the generated Aurea
approach derives this shared axis; registered streets, parcel outlines and
circuit vertices are unchanged. Two 2.5 m thick local return curtains meet the
solid arch piers and intersect the existing circuit, with its intervening wall
removed. Their placement is a reconstruction of the required connection, not a
surveyed medieval curtain plan. See HISTORY.md for the historical distinction.

`wallPlan()` now subtracts whole gate intervals, preserving both remaining
fragments when a gap falls inside a 10 m piece. Old random draws are retained:
all 57 existing towers keep the same specifications and positions. The plan has
293 curtain pieces versus 283 before the fix.

San Lorenzo's isolated geometry was already joined on both sides: its gap
half-width is 2.9 m and gateway half-width 3.5 m, producing 0.6 m overlaps.
The isolated comparison cannot substantiate a streaming/culling defect there;
that requires the separate full-world audit. The generic interval fix prevents
wall fragments being discarded at gates without claiming that it explains the
reported San Lorenzo appearance.

## Checks and evidence

- `layout-check.json`: exact polygon comparison with the original `.88,-.48`
  generated Aurea approach restored, all other current inputs held constant.
  Both layouts contain 6,019 lots: no polygon changes, added/removed lots,
  shifted lot IDs, or changed explorable selections. Aurea has no reserved
  polygon; its radial terrain plateau is independent of site rotation.

- `geometry-check.json`: actual production collider geometry, terrain-following
  waist/head passage rays through both gates, including the real Via Traiana
  polyline; barrier rays across every Aurea return joint and San Lorenzo's two
  joins; return thickness sampled against all current building lot polygons.
- `render-check.json` / matched PNGs: real wall, gate and terrain geometry with
  a neutral rough material so connections can be inspected independently of
  the lighting/material task. Both modes use the current arch model; baseline
  uses the old wall plan and old arch rotation. Terrain/material/camera are held
  constant. These are isolated geometry evidence, not full-world phone budgets.
- TypeScript compilation passes. Collision rays test clearance and closed
  barriers; they are not a full player/capsule traversal benchmark.

Reproduce from repository root:

```sh
npx tsx tools/check-gate-layout.ts > docs/benevento/gate-validation/layout-check.json
npx tsx tools/check-gate-connections.ts > docs/benevento/gate-validation/geometry-check.json
npx vite --host 0.0.0.0 --port 5412 --strictPort --config tools/vite.nohmr.config.ts
python tools/capture-gates.py --url http://localhost:5412
```

Start a fresh Vite process after source edits: the audit's no-HMR configuration
caches transformed modules. The capture script reconstructs the old fabric
module from pinned commit `9200a4ac1282c0d5fb23930b40e57c4adc970ff5` in ignored
`tools/.cache/`; it records browser errors and fails on them.
