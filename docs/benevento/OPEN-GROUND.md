# The open ground inside the walls (29 October 2026)

The traced plan (PLAN-TRACE.md) left the large undivided cells and the wide lane spaces as
bare ground with a rubble wall round some of them: from above, grey patches with isolated
buildings. The owner: "For sure they weren't really empty." The evidence for what such
ground held in a 6th-8th-century Italian town, and for Benevento in particular, is in
[HISTORY.md](HISTORY.md), "The open ground inside the walls". This note records what the game
now builds there, how, and how sure it is. Uncertainty stays here and in HISTORY.md, not in
the game.

## 1. Cells checked against the drawing first

Every open cell (59 large closed cells, the 9 "squares" that are closed cells joined to the
lanes through a gap in their outline, and the split-off wide lane parts over 400 m²) was
compared with the drawing (contact sheets of each cell on the plan; shape measures:
rectangularity, ink inside the cell, how much of its rim is drawn line).

- **Three cells read as buildings, not gardens** (`PLAN_HALLS` in `layout.ts`; plan-trace ids
  711, 774, 1182): plain rectangles 18-24 × 45 m (rectangularity 0.88-0.89, the highest of
  all open cells, no inner strokes), each in a row of houses beside a drawn court. The plan
  draws gardens as irregular cells; a long clean rectangle among houses is how it draws a
  hall, a church or a range. *Hypothesis*: the drawing has no hatching; these are built as
  large houses on the drawn footprints (720-915 m², 5-10 m tall), on their own random stream
  so no other house changes.
- **The nine closed cells joined to the lanes** (ids 251, 444, 549, 581, 880, 1044, 1181,
  1516, 1694: a square with a drawn cell's id) are open ground of their own, not lane:
  orchards, meadows, threshing floors. They stay unwalled because lanes run through them;
  nothing is put within 1.1 m + half a lane's width of a lane's centre line or 1.6 m of a
  house.
- No other open cell has a building's shape; all keep their class.

### Streets: only the drawn corridors (retrace)

On the drawing a street is a corridor between two lines, 2-6 m wide; nearly everything else
is closed cells. The first trace kept as lane every part of the white lane space up to
~10 m wide (`RW` = 5.2 px in `plan_trace.py`) and left the wider parts as bare "squares", so
about half the walled area read as street. The retrace (`PLAN_RW` = 3.1, `PLAN_MIN_WIDE` =
40 px²) keeps as lane only the parts whose white core is under ~6 m; every wider part of the
lane space is split off as a cell of its own (it opens on a lane where the drawing leaves no
line) and gets open-ground content: orchards, meadows with hay and threshing floors, and on
the larger ones (≥ 500 m²) gardens and a hut or two, unwalled, with the ways through them
kept clear (paths along the lane centre lines that cross them). Two side rules changed with
it: the split-off parts at the edge of Civitas Nova are cut at the grey edge like the lanes
(not dropped), and a small cell is merged into a lane as a "lane piece" only between two
drawn corridors. The circuit moves by at most 6 m along the edge of Civitas Nova; towers,
gates, Porta Aurea and the house footprints are unchanged; `check-plan-access.ts` passes
(30 checks).

Shares of the walled area (32.45 ha), `npx tsx tools/benevento/area_shares.ts`: the drawing is
the traced cells (each owning half of the ink lines round it), the game the layout's raster:

| | drawing, first trace | game before (29 Oct, start) | drawing, retrace | game now |
|---|---|---|---|---|
| buildings | 26.4% | 25.2% | 26.6% | 26.0% |
| courtyards | 0.6% | 0.4% | 0.6% | 0.4% |
| gardens and other closed open cells | 21.3% | 21.4% (bare) | 21.3% | 20.7% (filled) |
| cells opening on a lane | 20.4% | — (bare street) | 30.4% | 29.2% (filled, unwalled) |
| street | 31.3% | 50.2% | 21.2% | 20.8% |
| landmark precincts | — | 2.8% | — | 2.8% |

Buildings were not eroded: houses stand on the drawn footprints and share their party walls
(a cell owns the half of each line next to it); what read as gaps between them were the
over-wide lanes and bare squares.

## 2. What each cell holds

`plotfill.ts` decides, `plotbuild.ts` builds, as a pure function of each plot (its own random
stream: worker, collision, props and tools see the same plan). `layout.ts` §8c assigns the
kinds:

| Rule | Kind | Flag |
|---|---|---|
| The walled cell nearest each church in the walls (cathedral, S. Pietro ad Forum, S. Petrus ad Caballum), within 45 m | *coemeterium*: graves in rows west-east (slab-covered cists, earth mounds, a few head stones), the rest the church's garden | inferred (burials gather round churches by the 8th c.; Triggio, Pacca, Piazza Sabariani) |
| The walled cell nearest the forum and nearest the Castellum Aquae (within 110 m) | *calcaria*: a Roman room standing roofless, a lime kiln, stacks of blocks and broken marble, fuel | inferred (Rome's Calcarario and Crypta Balbi kiln, Naples, Brescia) |
| Nearest the Iseum and the Arch of Sacramento; half the cells within 70 m of a Roman monument | *ruina*: roofless Roman walls (one mostly fallen) as an enclosure, a shed built inside against them, spoil, nettles | inferred |
| Within 170 m of the dukes' curtis | pens, orchards, gardens | hypothesis (the servants and stock of a curtis: Brescia) |
| Steep cells (slope > 0.16) | *vinea* (or orchard) | hypothesis |
| Elsewhere, by a per-cell hash | *orto* 30%, *pomarium* 14%, *casalinum* 18%, *stabulum* 12%, *vinea* 9%, *pratum* 9%, *ruina* 8% | hypothesis (proportions) |
| Unwalled cells (opening on a lane) | under 500 m²: meadow or a few fruit trees; 500 m² and more: orchard 30%, garden 20%, huts 15%, threshing floor and hay 15%, meadow 20% | hypothesis |

Contents (all low; nothing in an open cell is taller than a one-storey hut or a tree):

- *orto*: dug beds 1.6 m apart, edged with boards, with winter greens; a tool shed against
  the wall with its woodpile and vessels; fruit trees along the edges; a midden; sometimes
  a well.
- *vinea*: vine rows 2 m apart on stakes with a pole tied along at shoulder height, the
  last leaves; a watchman's hut.
- *pomarium*: fruit and nut trees about every 55 m², grass, a shed, hay.
- *casalinum*: one to three timber huts (plank walls, shingled roofs) or sunken-floored huts
  (low walls under a steep roof), each with hearth, woodpile and vessels; a wattle-fenced
  patch of greens; a midden.
- *stabulum*: wattle pens, an open shed with a manger, haystacks, the dung heap.
- *pratum* / *area*: grass, hay, a threshing floor ringed with stones, trees.

Garden, vineyard, orchard, meadow and cemetery walls are dry-stone walls 1.25-1.55 m high
(one sees over them); yards, pens and ruins keep walls of 2.0-2.6 m. No animals (no models).

Counts (`npx tsx tools/benevento/open_ground_stats.ts`):

| Kind | Cells (unwalled) | m² | Huts/sheds | Trees | Beds | Vine rows | Pens | Hay | Graves | Ruin walls | Kilns | Threshing floors | Wells |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| orto | 20 (8) | 22,053 | 12 | 68 | 432 | | | | | | | | 6 |
| vinea | 5 | 4,764 | 5 | 7 | | 89 | | | | | | | |
| pomarium | 84 (76) | 48,666 | 8 | 216 | | | | 3 | | | | | |
| casalinum | 14 (7) | 14,004 | 20 | 14 | 32 | | 10 | | | | | | |
| stabulum | 7 | 8,081 | 7 | 9 | | | 9 | 9 | | | | | 1 |
| pratum | 74 (67) | 32,717 | 7 | 59 | | | | 42 | | | | 3 | |
| area | 13 (13) | 19,283 | | 29 | | | | 19 | | | | 3 | |
| ruina | 5 | 5,357 | 5 | 7 | | | | | | 20 | | | |
| calcaria | 2 | 2,758 | 2 | 3 | | | | | | 8 | 2 | | |
| coemeterium | 3 | 5,759 | | 3 | 42 | | | | 84 | | | | |
| **total** | **227 (171)** | **163,442** | **66** | **415** | | | | | | | | | |

Plus 666 houses (the traced footprints, the three halls, the back rooms of the houses one enters).

## 3. Techniques and cost

- Foliage (greens, vine leaves, grass tussocks) is untextured geometry in one new small
  material (`leaf`, MAT 23, merged into each chunk's `misc` draw: no new texture, no new draw
  call): thin double-sided blades and leaves with normals bent upwards, the usual way grass
  geometry is lit so it takes the sky light instead of going black on its shaded side
  (e.g. E. Wohllaib/Sucker Punch, "Procedural Grass in Ghost of Tsushima", GDC 2021;
  K. Jahrmann and M. Wimmer, "Responsive Real-Time Grass Rendering for General 3D Scenes",
  I3D 2017, blades as geometry). A first try with solid octahedral clumps read as black
  rocks and was dropped. Foliage is left out of the middle-detail chunks (40-96 m).
- Huts use the roof kit's shingled gable (`tiledGable`, *scandulae*) and lean-to; walls,
  stakes, boards, logs are plain 12-triangle boxes.
- Trees: the town's fruit and nut trees go into the existing tree field (batched meshes,
  impostors further out: no new draw calls); the oak models stand in for them (see HISTORY).
- Scanned props in the cells are limited to a handful per cell.
- The town's trees are their own kinds in the tree field, drawn as impostors out to 160 m
  (the wood's fade at 95 m), so gardens keep their trees in the views over the roofs.
- Sward: off the street, the blue channel of the town texture (unused there: it carries the
  gutters only on the street) marks turf, 0.04-0.9 by kind; the ground shader mixes a dark
  olive turf, worn through in patches, into the mud there. No new texture, no new draw.

Rendering budget (headless Chromium, SwiftShader, 390×844, `?debug` HUD after the shot
settles; triangles drawn / draw calls; before = the merged plan trace, 0afbe43; after = this
branch with main 94992a6 merged). These are rendering-budget numbers, not phone frame rates.

| View | before | after |
|---|---|---|
| aurea_street | 161k / 73 | 177k / 103 |
| centre_street | 104k / 50 | 112k / 46 |
| east_street (old camera, inside a house) | 107k / 58 | 116k / 54 |
| east_street_new | 133k / 55 | 127k / 54 |
| panaro_street | 64k / 46 | 68k / 54 |
| orto / vinea / pomarium | 99k-153k / 56-64 | 102k-156k / 47-65 |
| stabulum / casalinum / calcaria | 157k-187k / 49-74 | 160k-185k / 49-74 |
| coemeterium (by the curtis) | 249k / 82 | 224k / 86 |
| centre_high (aerial) | 219k / 47 | 260k / 49 |
| east_high (aerial) | 222k / 56 | 207k / 54 |

All street views stay under 350k triangles and 130 draw calls; the heaviest is
aurea_street at 103 calls (+30): a mesh-count diff of that view shows ~20 more town
cluster meshes and a second townsperson's garment set in view (NPC placement varies with the
merged NPC work), plus the tree impostors and the `misc` foliage.

## 4. Evidence

`docs/benevento/open-ground/`:

- `map-town.png`, `map-centre.png`: top-down maps of what each cell holds
  (`tools/benevento/open_ground_map.ts` + `.py`).
- `cells-*.jpg`, `halls-on-plan.jpg`: every open cell on the drawing (the check of §1).
- Before/after pairs from the plan-trace cameras: `aurea_street`, `aurea_high`, `north_high`,
  `north_out`, `east_high`, `east_street`, `panaro_street`, `panaro_high`, `southeast_high`,
  `centre_street`, `centre_high`; `east_street_new` (the east view from a lane, 9 m from the
  old camera); one street-level view per kind (`orto`, `vinea`, `pomarium`, `pratum`,
  `stabulum`, `casalinum`, `ruina`, `calcaria`, `coemeterium`, `area_open`); Porta Aurea
  `aurea_out_w` (outside, the curtain west of the arch) and `aurea_top` (from above). The
  "before" of the kind views is the same camera on the old layout, where the cell held
  whatever the old random kind was.
