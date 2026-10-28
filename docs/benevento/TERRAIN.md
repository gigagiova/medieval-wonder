# Geographic terrain — 28 October 2026

The landscape now uses **TINITALY 1.1**, the INGV bare-ground digital terrain
model at10m cell spacing. The prior model used EU-DEM25m, resampled to10m and
smoothed. A finer output grid did not add source detail. The new source is a
measured-data terrain product, not manually invented hills or a Google Maps
rendering. Its documented bare-ground character is important in the city.

## Source and coordinates

Tarquini S., Isola I., Favalli M., Battistini A., Dotta G. (2023).
*TINITALY, a digital elevation model of Italy with a10 meters cell size
(Version1.1).* INGV. https://doi.org/10.13127/tinitaly/1.1.
[Publisher](https://tinitaly.pi.ingv.it/),
[WCS documentation](https://tinitaly.pi.ingv.it/wcs_service.html),
[CC BY4.0](https://creativecommons.org/licenses/by/4.0/).
Attribution and adaptations are also shipped in `public/licenses/tinitaly.txt`.

The downloaded WCS coverage is `TINItaly_1_1__tinitaly_dem`, EPSG:32632,
with10m east/north cells. Its crop, DescribeCoverage response and exact request
are preserved in `terrain-audit/tinitaly/`. The crop contains no missing samples.
Latitude/longitude are transformed with PROJ to the source CRS before sampling;
UTM east/north must not be mistaken for the game's local east/south axes.
The game retains its origin41.1305N,14.7745E, and heights stored above sea level,
with a100m offset only for runtime game units. No unverified vertical-datum
conversion is applied; dataset disagreement is not treated as an exact survey
of individual archaeological thresholds.

## Adaptations

`tools/benevento/bake_tinitaly.py` samples the source onto the existing10m game
grid without the former broad smoothing. It preserves the river levels,
channel carving and bank constraints used by the existing bridges. A60m blend
at the data boundary preserves continuity with the regional terrain extension.
Local landmark terraces remain runtime adaptations. Thus this is sourced
terrain with explicit reconstruction adjustments, not an untouched raster.

Modern terrain is not identical to AD700 street or river levels. Changes caused
by accumulated occupation, modern embankments and archaeological excavation
still need site-specific interpretation. These caveats belong in research
notes, not intrusive in-game labels.

## Separation from the historical plan

Only `geo.json.terrain` changes. Street, parcel, river and wall data remain
identical. The supplied historical plan remains the horizontal-layout authority;
Civitas Nova is to be excluded as requested. This terrain update does not claim
the unfinished one-by-one footprint tracing or coordinate registration is solved.
In particular the recent Porta Aurea plan-relative adjustment remains documented
in `AUREA-ALIGNMENT.md`.

The old procedural density raster is preserved in `layout-density.json`, so
terrain replacement cannot randomly regenerate house IDs, heights or room
assignments. This is an interim authoring-stability measure, not a historical
population survey or a reason to retain footprints that disagree with the plan.
`freeze_layout_density.ts` serializes that density field; the checked-in snapshot
was generated before replacing the elevation source.

## Validation and reproduction

- The initial99-point live EU-DEM audit and source response are in `terrain-audit/`.
  Mean difference from the previous baked base was0.405m; the two are based on
  the same source and are not independent validation of actual ground accuracy.
- The TINITALY crop has253×161 cells at10m. Reprojection produces the unchanged
  236×137 game grid. Maximum change from the old terrain is26.03m; mean change
  is−1.314m. Edge samples remain exactly equal before decimetre quantization.
- Source-derived hills are compared in
  [before/after](terrain-audit/tinitaly/before-after.png). Large differences in
  the urban ridge are source disagreement, not a claim of26m historical change.
- All6,019 existing lot footprints remain identical. Gate passage and pier
  barriers, Pacca chamber floors, stair access and bridge clearances are checked
  against the new terrain. Phone captures are saved in `terrain-audit/world/`.

Run with Python dependencies numpy, scipy, matplotlib, rasterio and pyproj:

```sh
python tools/benevento/audit_terrain.py
python tools/benevento/bake_tinitaly.py          # candidate and comparison
python tools/benevento/bake_tinitaly.py --apply  # replace only terrain
npm run build
npx tsx tools/check-gate-connections.ts
npx tsx tools/check-pacca-burials.ts
```

Regional Campania catalog links returned404 and the national portal returned403
in this session. No5m/LiDAR data was retrieved or claimed. TINITALY's documented
10m product and working WCS provide the reproducible upgrade used here.

The final390×844 production captures draw129,948 triangles/71 calls at Porta
Aurea and86,773 triangles/65 calls at Ponte Leproso, with no browser errors.
Both are below the350k/130 rendering budget. Software-rendered capture times
are not measurements of phone FPS. The gate footing and bridge approach were
also inspected visually after the terrain change.
