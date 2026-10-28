# Mapping the wall towers

The owner's plan has small perimeter projections which must be reviewed as
possible towers. The previous world placed towers at random40–55m intervals;
the parchment independently invented symbols every45m. Neither is a source
inventory. The parchment now reads the actual world tower positions/shapes.

## Current implementation and limits

**Only Torre del Santo Panaro has completed source registration in this change.**
It replaces nearby procedural placeholders, is named on the map and can be
visited through the map travel list. Its center(675.410,-148.630) and circular
plan follow OSM way248001579, which matches the reference's northeast corner.
The4.5m radius approximates the mapped footprint; height13m, masonry treatment
and upper termination are AD700 reconstruction choices, not surveyed claims.
Its body overlaps the curtain rather than standing detached beside it.

Other procedural towers remain placeholders. Do not describe the entire tower
system as historically traced or complete. Replacing them is coupled to the
outstanding perimeter tracing: several known/source-plan towers currently lie
15–25m away from the automated curtain. Silently snapping them to that curtain
would repeat the Porta Aurea error. The review catalog deliberately retains
those discrepancies rather than inventing connector walls.

## First-pass inventory

The public OSM map API returned14 defensive-tower ways in the queried historic
center bounds. Bell towers were excluded. This is a survey of mapped surviving
features, **not a claim that Benevento had exactly14 towers in700**, nor that
all surviving upper structures date to700.

- `towers/osm-inventory.json`: coordinates, mapped footprints, corresponding
  source-plan pixels, and distances to the current raw curtain.
- [OSM locations over the supplied plan](towers/osm-on-plan.png): numbered
  footprints; registration uses the stored TPS and inherits its uncertainties.
- `towers/plan-projections.json` and
  [projection review](towers/projection-review.png): twelve manually selected
  perimeter features, including unresolved wall buildings and gate features.
  These are candidates, not twelve newly asserted towers. Small/obscured
  projections still need review; this is not a finished exhaustive trace.

| OSM way | Identification | Treatment |
|---|---|---|
|248001579|Torre del Santo Panaro|Registered and implemented|
|1015674808|Torre della Biffa|Northwest registration/wall discrepancy needs resolution|
|1016982302|Unnamed northern defensive tower|North curtain was clipped at source image row150; retrace first|
|480303640|Unnamed northeast defensive tower|Compare mapped footprint with source wall/building junction|
|1015674809|Unnamed eastern defensive tower|Source plan and modern position need reconciliation|
|423814415|Torre tardoantica|Review surviving fragment beside Sacramento; avoid duplicating the gate|
|249341737|Torre della Catena|Already a separate landmark; do not duplicate as circuit tower|
|272307489|Torre Pagana|Civitas Nova/southern perimeter inventory; not added to700 circuit|
|1015674810,1015674811,1016982304,1016982305|Southern defensive towers|Civitas Nova sector; excluded from the requested city circuit|
|1562485446,1562485447|Rocca-area defensive towers|Later fortress/extent; record separately from early curtain interpretation|

The source-plan footprint and connection to the curtain take priority when
reconstructing missing towers. Use modern coordinates/footprints to identify
survivals and check the registration, not as a reason to deform the historical
plan. Heights, reconstructed tops and material details remain separate from
position/footprint evidence. No uncertainty labels are added to gameplay.

## Sources and reproduction

[OpenStreetMap map API](https://www.openstreetmap.org/api/0.6/map?bbox=14.766,41.128,14.787,41.138),
retrieved28October2026. Individual feature URLs use
`https://www.openstreetmap.org/way/<id>`. © OpenStreetMap contributors,
[ODbL](https://www.openstreetmap.org/copyright).
The source drawing is `urban-plan-reference.webp`, with registration stored in
`tools/benevento/registration.json`. Wikipedia requests for the walls, Panaro
and Catena returned403 in this session; no unsupported chronology is attributed
to those inaccessible articles.

`tools/check-panaro.ts` checks curtain contact, duplicate suppression, house
clearance and the travel destination. `check-gate-connections.ts` retains the
Aurea/Lorenzo passage checks; its old tower-stability comparison explicitly
excludes the independently registered18m Panaro replacement area.
Matched real-geometry screenshots are in `towers/rendered/`; they use neutral
materials and identical cameras to show the changed corner connection.

Final production view:135,173 triangles and54 calls at390×844, with no browser
errors. The travel point is on the clear northeast exterior side at(695,-174),
not the initial city-side point which faced a nearby wall. The corrected
[screenshot](towers/world/torre-del-santo-panaro.png) and
[parchment](towers/world/map.png) were inspected. These draw counts are not
measured phone FPS. This release intentionally does not claim the remaining
procedural positions have been replaced with a complete historical inventory.
