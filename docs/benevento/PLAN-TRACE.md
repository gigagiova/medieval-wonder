# Tracing the owner's plan cell by cell (28 October 2026)

This note records how the game now copies `urban-plan-reference.webp`: the drawn
building footprints, the lanes, the courtyards and open spaces, and the walls. It
replaces the earlier pipeline (`plan_classify.py`, `outline.py`, procedural lots)
and its 6,019 generated houses. Reconstruction uncertainty is recorded here, not in
the game.

## Pipeline

```sh
# in a scratch directory holding ref.png (the plan as PNG), osm.json, osm-inventory.json
python tools/benevento/register.py registration.json      # control points -> TPS (v2)
python tools/benevento/plan_trace.py ref.png               # plan_trace.json (+ plan_trace.png)
python tools/benevento/gen_plan.py                         # plan.json, world metres
python tools/benevento/gen_geo.py path/to/src/benevento/geo.json   # only the plan keys
npx tsx tools/benevento/dump_layout.ts layout.json
python tools/benevento/trace_overlay.py layout.json overlay.png    # evidence image
```

`gen_geo.py` no longer rebakes terrain or rivers: the TINITALY terrain
(`bake_tinitaly.py`, TERRAIN.md) and the river data in `geo.json` are kept byte for byte.

## What is excluded, and what is not

Only **Civitas Nova**, the grey wash labelled 1, is left out (it is after 758). The
earlier pipeline also cut:

| Former cut | Now |
|---|---|
| a "legend" box `[540:, 640:1100]` | removed: only the legend's glyphs (ink components wholly inside the legend's box) are masked. The south-east edge between x 640 and 1250 below row 540 is traced. |
| everything above row 150 | removed: the north curtain reaches row ~130. Only the two road stubs north of the town (thin appendages, removed by a morphological opening), the "3" glyph and a dead-end stroke continuing the north road east of x 595 (row 137, x 597-647) are left out. |
| the east annex towards the later Porta Somma and the Rocca (a polygon cut in `gen_geo.py`) | removed: the drawn east end, including the Rocca drawing, is inside the circuit. The Castellum Aquae landmark (HISTORY.md §5) stands there with a 17 m precinct; drawn cells it covers are not built. |
| the grey circle 5 (the Lombard curtis area) | was not excluded, and is not: its lines are read with a threshold suited to the darker wash, and the circle's wash where it bulges past the town's north line is not counted as town. |

## Reading the drawing

- **Ink.** A pixel is ink when darker than 150 on white, 101 in the curtis wash (grey
  141), 115 in the Civitas Nova wash (grey 160). The former fixed 120 lost faint lines
  (cores 140-160) so blocks leaked into the lanes; a looser 184 made strokes so wide
  that the narrowest lanes (1-3 px of white) closed and the lane network fell apart.
- **Washes.** A wash pixel is grey with no white paper within 2 px (anti-aliased line
  edges on white are grey too); pieces of 1,500 px or more, closed over 25 px gaps
  (dense line work interrupts the wash), holes filled.
- **Line breaks.** Line ends whose stroke points at other ink within 2.6 px are joined
  (181 joins).
- **Triangles 3 and 4.** The markers' thick strokes are removed. Each hides a stretch of
  the edge, which is taken as the straight line between the points where the visible
  edge enters and leaves the triangle: (912,161)-(946,180) under 3 (the north edge at
  the Arch of Trajan), (453,433)-(492,461) under 4 (the edge of Civitas Nova at the
  Arch of Sacramento). *Inference*: what the markers hide cannot be read; the cells
  under them merge into one open cell or lane.
- **Cells.** Every closed region of paper is a cell. Each ink pixel goes to the
  nearest cell, so neighbours meet on the centre of the line they share, and a cell on
  the outer line owns that line out to its outer edge. Cells mostly (> 50%) in the
  Civitas Nova wash are dropped; lanes are cut at its edge.

## Classification rules (and how sure they are)

Plan pixels are about a metre (registration: 1.00 × 0.96 m/px). Widths are measured
on the skeleton of each cell.

| Rule | Class | Certainty |
|---|---|---|
| Long and thin: mean width < 7.5 px and length > 6× width, or width < 11 px and length > 12× width, or > 25,000 px² | lane | good: the drawing has no other long thin white spaces, except... |
| ...a thin cell (< 7 px, < 1,200 px²) that rings other cells (filling it adds > 25% area) | building (a range round a court) | fair |
| Wide parts of the lane spaces (> 5.2 px from both sides, ≥ 150 px²) | square: open lane ground (grass where not trodden). The large ones are probably blocks whose outline is broken in the drawing; they are neither built nor walled, so as not to invent buildings or cut lanes | **hypothesis** for the large ones |
| Small narrow cell (≤ 160 px², ≤ 9 px wide) touching two separate lane pieces at its two ends | lane (a piece cut off by lines drawn across the lane) | fair |
| Open cell that joins two otherwise separate parts of the lane network | square (a lane whose line has a gap has merged with the block beside it) | fair |
| Enclosed cell ≤ 520 px² | building footprint | good for ordinary cells; a few small cells may be yards |
| Enclosed cell > 520 px² | open space (garden, vineyard, meadow, pen or ruin; kind chosen at random) with rubble walls on the sides facing a lane or open ground | **hypothesis**: the drawing does not say whether a large undivided cell was built; the owner's instruction is to read large enclosed cells as open |
| Cell touching no lane, ringed only by buildings, ≥ 100 px²; or the hole of one ring cell | courtyard | fair |
| Cell touching no lane, < 100 px² | building (a back room) | fair |

Result: 672 building footprints, 59 gardens/open cells, 93 squares, 11 courtyards and
14.5 km of lane centre lines (14.3 km of them one connected network) inside a circuit
of 3.05 km enclosing 32.4 ha. In the game 653 houses (8.1 ha of roofs) stand on the
footprints; the others lie under landmark precincts (curtis, episcopium, forum, Ad
Caballum, Iseum, Castellum Aquae, Hortus), plus the back rooms behind houses one can
enter. `tools/check-plan-access.ts` checks that every gate, every enterable door, the
two burial stairs and the forum and Ad Caballum squares reach the main lane network.

Known weak points: the classification is per cell, so a garden drawn with one inner line
becomes two cells; rounded edges where a wide lane part was split off; ring buildings are
cut into ranges through each court's centre (`gen_plan.py`), so they can be built with
the existing roof kit. Buildings are clipped 1.6 m inside the curtain line.

## Buildings on the footprints

`layout.ts` builds each footprint as drawn (simplified to ≤ 12 corners, ~0.3-1.4 m),
with the existing kit (`src/arch/*`, `town.ts`): the street front is the longest side
with a lane before it; heights follow footprint size (sheds 3-4.8 m, small houses
4-7.5 m, larger ones 5-10 m, up to 10.5 m on the decumanus). There is no encroachment
pass any more: no house is brought forward into a lane, and no shop, yard or garden is
added in a lane. Lanes are as wide as drawn.

**Houses one can enter** use the drawn front of a traced house and a rectangle as deep as
the footprint allows; the footprint behind the rectangle stays a building of its own.
Rectangle and back room cover ≥ 90% of the drawn footprint for most; where no such house
is within 45 m of a target, ≥ 75%. The houses one enters now stand 7-60 m from their
former points (the potter by Porta Rufina is the farthest); San Pietro ad Forum is 37 m
from its former point. The Pacca and Triggio burial stairs follow the new host
fronts (`tools/benevento/anchor_burials.ts`); San Modesto stays where it was, outside the
circuit, clear of every traced cell.

## The curtain and its towers

The circuit of 700 is the outer boundary of the traced town less Civitas Nova, on the
centre of the outer line. It is used for the rendered curtain, collision, containment and
the parchment alike.

**Registration v2** (`register.py`): the former control for the Arch of Trajan was the
centroid of triangle 3, 18 px inside the town's edge, which pulled the drawn north edge
about 20 m north of the arch and forced the old 22 m return walls and then the 32 m
plan-relative move of the arch (AUREA-ALIGNMENT.md). Now the arch's OSM footprint centroid
(way 122652341) is matched to the edge under the triangle; the Arch of Sacramento likewise
to the edge of Civitas Nova under triangle 4. Four surviving towers mapped in OSM are
matched to projections on the outer line: Torre della Biffa, OSM 1016982302, OSM
480303640 and OSM 1015674809. Affine RMS 15.5 m over 11 points (the TPS is exact at
them); plan features move by 7 m (median) and up to 18 m against v1; local area scale
0.88-1.20. **Porta Aurea stands at its mapped position, 2.1 m from the traced curtain**;
the Arch of Sacramento is 1.4 m from it.

**Towers** are only those traced from the plan (`gen_plan.py` TOWERS, reviewed against
`towers/plan-projections.json` and `towers/osm-inventory.json`):

| Id | Plan px | Evidence | World offset from curtain |
|---|---|---|---|
| Biffa | (240.7,132.1) | small projection; OSM Torre della Biffa | 0.6 m |
| N02 | (336,167) | small rectangular projection | 0.8 m |
| N04 | (653,154) | small rectangle drawn on the line | 0.7 m |
| N05 | (767,145) | pentagonal projection (drawn as round tower) | 2.3 m |
| N06 | (843.9,134.4) | projection; OSM 1016982302 | 0.2 m |
| N07 | (1047.9,172.4) | projection; OSM 480303640 | 0.8 m |
| Panaro | (1205,216) | rounded NE corner; OSM 248001579 (registered, `tower-sites.ts`) | 3.6 m |
| E01 | (1209.5,359) | slight projection; OSM 1015674809 | 0.0 m |

Not added: N03 (an elongated 28 × 7 m projection: a building on the wall; it is traced
as a footprint), S01 (a building corner), the late-antique tower by the Sacramento arch
(OSM 423814415: 6.8 m outside the inferred edge under triangle 4; adding it would mean a
detached tower or an invented link), Torre della Catena (a separate landmark), the
Civitas Nova and Rocca towers. The 40-55 m procedural towers are gone; nothing is snapped
to the curtain along its length. Bumps on the Civitas Nova edge are cell outlines, not
towers.

## Gates

Each gate opens where a lane of the connected network reaches the traced curtain,
nearest its former position. Porta Summa is put at the opening the plan draws in the
east line beside the Rocca, (1233,477)-(1235,486) px, world (648,117): the circuit is
closed across the opening and the gate cut into it. *Hypothesis*: the drawing does not
label it; its 700 position "150 m west of the 10th-c. gate" (HISTORY.md §4) no longer
has a wall to stand in once the east end is drawn in. The decumanus is the cheapest lane
path between Porta S. Lorenzo and Porta Summa that stays near the line of Corso
Garibaldi.
