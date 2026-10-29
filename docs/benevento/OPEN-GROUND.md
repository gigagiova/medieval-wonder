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
lanes through a gap in their outline, and the 38 split-off wide lane parts over 400 m²) was
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
- No other open cell has a building's shape; all keep their class. The split-off wide lane
  parts stay lane ground; those of 600 m² or more get a few unwalled things at their edges
  (trees, hay), clear of the ways through them.

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
| Unwalled ground | *pomarium*, *area* (threshing floor and hay), *pratum* | hypothesis |

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

Counts (`npx tsx tools/benevento/open_ground_stats.ts`): COUNTS

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

BUDGET

## 4. Evidence

`docs/benevento/open-ground/`: EVIDENCE
