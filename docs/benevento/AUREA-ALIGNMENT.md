# Porta Aurea perimeter registration audit — 28 October 2026

The owner's objection is correct: the previous connection created a narrow
inward pocket, rather than placing the gate in the continuous perimeter. The
previous collision audit proved attachment and passage; it did not prove that
the resulting urban geometry respected the historical map. This audit does
not itself change production geography.

## What the source map and registration actually establish

`urban-plan-reference.webp` is the supplied plan. The saved registration uses
plan pixel **(923,185)**, explicitly the centroid of the large triangular marker
“3”, as the Arch of Trajan control point. Its target is **(389.1,-223.8)m**.
The saved thin-plate spline reproduces that control exactly. The production
arch anchor **(389,-224)m** is consistent with it.

However, `outline.py` does not identify wall strokes semantically. It thresholds
all dark image marks, blanks everything above image row150, performs a9px
morphological closing twice, and takes an outer contour. The triangular gate
symbol is not excluded. `gen_geo.py` then applies25m morphological buffering,
additional8m operations and2.5m simplification. These are approximate image
operations, not an independently surveyed wall plan.

The resulting wall vertex54 **(392.6,-256.3)m** inversely maps to
**(922.66,151.84)px**, beside the top of the triangular annotation. Vertex55 to56
maps from approximately **(905.95,150.44)px to (654.15,150.01)px**: a long run at
the image-clipping threshold rather than a faithful trace of all visible wall
undulations. The nearest wall point to the arch is **(403,-241.8)m**, a
**22.646m** discrepancy. The previous fabric builder added two parallel
inward returns to bridge that discrepancy. The resulting pocket is authored
geometry, not a feature established by the supplied map.

The exact saved-TPS comparison is in
[aurea-alignment/registration-overlay.png](aurea-alignment/registration-overlay.png)
and [registration-report.json](aurea-alignment/registration-report.json).
Reproduce with `python tools/benevento/audit_aurea_registration.py`.
The inverse is solved numerically against the saved forward TPS rather than
relying solely on the approximate inverse grid.

## Independent arch footprint check

Fetched the public [OpenStreetMap arch footprint, way122652341](https://www.openstreetmap.org/way/122652341)
on28October2026. The same projection used by `parse_osm.py` gives polygon
centroid approximately **(389.255,-225.584)m**, only1.6m from the game anchor.
The long mapped edge is14.946m, with façade-width direction **56.184°** in the
world x/z plane. The current width direction is53.130°, about3° different,
not40°. The short mapped edge is6.795m with direction−33.478°. The public
footprint is mapping evidence, not a measured reconstruction of the ancient
curtain. Data, attribution and calculation results are in
[osm-arch-footprint.json](aurea-alignment/osm-arch-footprint.json).

Do not rotate the arch roughly40° simply to match the erroneous raw curtain.
The existing road-derived direction was not originally measured, but the live
footprint independently supports its general orientation. Likewise, blindly
moving the standing monument22m to the raw contour exchanges one mismatch
for another.

## Repair constraints and diagnostic alternatives

- Remove the two long parallel returns and the narrow inward pocket.
- Use one coherent perimeter for rendered walls, collision, gate gaps,
  containment and the parchment map. Do not repair only the visible masonry.
- The gate can meet an oblique curtain through solid front/back **pier faces**;
  the wall need not approach along the façade-width axis or terminate at the
  outer width tips. This avoids incorrectly requiring a40° arch rotation.
- A straight diagnostic chord from raw vertex56 **(112.8,-298.1)** to vertex43
  **(671.7,-149.5)** passes within about0.3m of the arch, illustrating its
  relation to the broad northeast perimeter. But it crosses **40 existing lot
  polygons** and leaves182 completely on its north side. It is **not an
  accepted replacement wall** and cannot be described as preserving the plan.
- Any broad perimeter repair needs coordinated local registration of nearby
  wall/street/parcel geometry, or a clearly justified local reconstruction;
  simply bending a few wall segments inward repeats the underlying mistake.
- The annotation obscures the exact wall/arch junction on this schematic map.
  Moving the control from the marker centroid to an inferred wall-crossing
  pixel is a new registration judgment, not an exact location read from the
  image. Preserve the original registration and audit the changed region.

The published OSM anchor and supplied schematic are not identical kinds of
geometric evidence. The final choice should make the user's requested smooth
perimeter explicit, quantify changes to nearby streets/lots, and avoid claims
of a surveyed junction that neither source provides. This document records the
problem and constraints; the implementation agent owns the final correction.

## Implemented correction

The final decision prioritizes the owner's supplied plan and the relationship
between gate and continuous perimeter. The schematic and the modern OSM
footprint cannot both be treated as exact coordinates under the existing
registration. The arch is therefore placed on the local curtain, at
**(389, -256.218)**, rather than retaining the triangle-centroid anchor and
pulling the curtain inward. This is a **plan-registration reconstruction**, not
a claim that the real monument stands32m north of its mapped coordinates.
The existing façade orientation is retained.

Only the annotation-contaminated vertices52–54 are made collinear with their
neighbors51 and55. The arch stands on that same line; the two recessed return
walls are removed. The oblique curtain meets the solid pier faces. The map,
rendered curtain, collision and world containment use this corrected outline.
The raw trace remains solely as a stable procedural-generation reference,
preventing unrelated houses and wall decoration from being regenerated.

The new5m-wide city approach follows the arch's passage axis30m inward to
(365,-238.218), where it meets an existing3.92m-wide plan lane: its center is
only0.592m from that lane's centerline. The approach intersects no existing
house footprint. The first two Via Traiana points follow the new gate position;
the road farther from the gate remains unchanged. All6,019 existing lot
footprints are unchanged, including the newly reconstructed churches.

## Visual and traversal verification

Matched neutral-material captures use the same camera for the actual previous
return-wall layout and the corrected layout:
[before](aurea-alignment/rendered/before-top.png) /
[after](aurea-alignment/rendered/after-top.png), with matching frontage views
in the same directory. Neutral materials isolate geometry; production relief
textures and lighting are unchanged. The comparison confirms that the arch
intersects one continuous curtain instead of sitting at the end of a pocket.

The actual production phone view is
[Porta Aurea](aurea-alignment/world/porta-aurea.png): **129,167 triangles,
70 draw calls** at390×844, with no browser errors. These are draw-budget
measurements under headless software rendering, not measured phone FPS.
`check-gate-connections.ts` tests the30m city-side passage, Via Traiana,
solid pier/curtain barriers and San Lorenzo. No new wall/lot overlap was
introduced; contacts with lots1 and2 already existed in the baseline and are
recorded explicitly rather than reported as newly fixed.
