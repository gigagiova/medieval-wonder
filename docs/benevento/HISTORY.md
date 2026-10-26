# Benevento, AD 700: historical reconstruction notes

The game's town is Benevento (Beneventum) in **AD 700**, under **Duke Gisulf I** (689–706), a generation
after Bishop **Barbatus** (bishop 663–682) and Duke **Romuald I** (662–687) and his Catholic wife
**Theodorada**. Everything below is checked against that date: what existed, what was ruined, what was
not yet built. Scratch map: `scratch-map.svg` / `scratch-map.png` (the reconstruction drawn over the
user's plan, in plan pixels). Mysteries and readable texts: `SECRETS.md`.

## 1. Sources

Primary and scholarly (consulted directly or through the encyclopaedic syntheses that quote them):

- G. Bertelli Buquicchio, "Benevento", *Enciclopedia dell'Arte Medievale* III (Treccani, 1992):
  https://www.treccani.it/enciclopedia/benevento_(Enciclopedia-dell'-Arte-Medievale)/ — walls, gates,
  circuit lengths, the Civitas nova, churches and their dates, cathedral of 600, houses and pontili.
- M. Rotili, "L'Europa tardoantica e medievale. I Longobardi: Benevento", *Il Mondo dell'Archeologia*
  (Treccani, 2004): https://www.treccani.it/enciclopedia/l-europa-tardoantica-e-medievale-i-longobardi-benevento_(Il-Mondo-dell'Archeologia)/ ;
  M. Rotili, *Benevento romana e longobarda. L'immagine urbana* (Napoli 1986); *La necropoli longobarda di Benevento* (1977).
- A. Meomartini, *I monumenti e le opere d'arte della città di Benevento* (1889), pp. 244–254 (Wikisource):
  https://it.wikisource.org/wiki/Pagina:Meomartini_-_I_monumenti_e_le_opere_d%27arte_della_citt%C3%A0_di_Benevento.djvu/270
  — position of Porta S. Lorenzo (between palazzi Pacca and Pedicini), baths between Porta S. Lorenzo
  and Port'Arsa, the theatre (long mistaken for the amphitheatre), "Porta delle Calcare", bridges.
- Paul the Deacon, *Historia Langobardorum* (late 8th c.), IV–VI (siege of 663, Sesuald, perticae V 34).
- *Vita Barbati* (9th c.): the tree and the golden viper (legend).
- *Edictum Rothari* (643), c. 376 (*masca*).
- Wikipedia (it): "Storia di Benevento", "Ducato di Benevento", "Teatro romano di Benevento",
  "Centro storico di Benevento", "Arco di Traiano (Benevento)", "Rocca dei Rettori" (starting points).
- Geometry: OpenStreetMap (© OSM contributors, ODbL) for monuments, walls, rivers; EU-DEM 25 m via
  OpenTopoData for the ground; the user's plan `urban-plan-reference.webp` for the town's internal layout.

## 2. The date and its consequences

| Thing | Date | In AD 700? |
|---|---|---|
| Lombard circuit restoring the late-antique wall (excludes the ruralised west) | late 6th–early 7th c. | **yes** |
| Torre della Catena (fort guarding theatre, amphitheatre, Appia) | 7th c. | **yes** |
| First cathedral of S. Maria, on the forum | consecrated 15 Dec 600 | **yes** |
| Nunnery of S. Pietro *extra muros* (Theodorada) | before 687 | **yes** |
| S. Ilario a Port'Aurea (two domes in line) | late 7th/early 8th c. (masonry) | **yes (new)** |
| Curtis ducis in the Roman praetorium (*planum curiae*, Piano di Corte) | since 6th c. | **yes** |
| S. Marciano on the Calore (reused temple) | attested 724 | no (excluded; may already exist) |
| S. Sofia a Ponticello (Romuald II) | 706–731 | **no** |
| S. Benedetto ad Caballum with xenodochium | attested 742 | **no** |
| S. Sofia (Arechis II, 758–760) and its nunnery | 758–768 | **no** — its site is the dukes' orchard |
| Civitas nova of Arechis II (theatre, baths recovered) | after 758, by 774 | **no** — theatre and baths outside |
| Sacrum Palatium of Arechis II | 758–787 | **no** — the older curtis stands |
| S. Modesto, Ss. Lupolo e Zosimo, churches of the Civitas nova | 758+ | **no** |
| Porta Somma at the Rocca (east annex) | by 926 | **no** — the old gate is ~150 m further west |
| Cathedral rebuilt by Bishop David / Sico; its crypt frescoes | 782–832 | **no** |
| S. Bartolomeo (relics of 838) | 838+ | **no** |
| Rocca dei Rettori | from 1321 | **no** |
| Cloister of S. Sofia, Romanesque cathedral façade, campanile | 12th–13th c. | **no** |
| Jews documented | 9th c. | not shown as a quarter (noted only) |

## 3. Scale and registration

- World frame: metres, x east, z south; origin 41.1305 N, 14.7745 E (equirectangular). Heights from
  EU-DEM 25 m, smoothed, with the river channels carved to their water level (Calore 114.5 → 107.8 m,
  Sabato 117.6 → 109.7 m asl, falling downstream); the game works 100 m below sea level.
- The plan was registered by **7 control points** (plan pixel ↔ OSM position): Arch of Trajan, Arch of
  Sacramento, Roman theatre (centre of the cavea), Rocca dei Rettori, NE wall corner (Torre del Santo
  Panaro), the road to Ponte Vanvitelli at the north wall, the west tip at Port'Arsa.
  **Affine fit: RMS 14.9 m; residuals 4.8 / 7.1 / 15.6 / 19.1 / 18.2 / 21.8 / 8.7 m.**
  Scale 0.989 × 0.978 m per plan pixel; the plan is turned 9.0° from north.
  A thin-plate spline through the same points (exact at them) maps the plan onto the ground.
- **Is the plan's internal geometry exact?** No. A test that fitted modern OSM street centrelines to the
  plan's corridors (see `tools/benevento/streetfit.py`, `brute.py`) found no transformation that puts
  them in the plan's streets better than chance (line-overlap 0.23 vs 0.27 random). The plan is
  schematic in detail, so it is treated as **the authority for the town's internal layout** (streets,
  blocks and open spaces), placed on the real ground through the spline; OSM/DEM provide scale,
  orientation, the wall circuit, rivers, heights and landmark positions. With the spline the cathedral
  falls on the plan's long block and S. Sofia beside the plan's square cloister.
- Distances: Arch of Trajan to Arch of Sacramento 493 m; the later medieval town (the plan's outline)
  1.2 km east–west; the circuit of 700 is **2.83 km** long and encloses **30.6 ha** (Bertelli: 2750.5 m).

## 4. The walls and gates in 700

The late-antique circuit, rebuilt by the Lombards around 600 with stones from the amphitheatre and
Roman tombs (opus incertum with spoil, ~12 m high, square and round towers), drawn as the plan's outline
minus the Civitas nova (the plan's shaded area 1) and minus the small east annex finished by 926. Its
inner west line runs from the NW corner past the remains still standing (OSM ways 373786220,
373759266) to the Arch of Sacramento and on to Porta Rufina.

Gates: **Porta Aurea** (the Arch of Trajan, on the Via Traiana), **Arcus Sacramenti** (the arch at
the forum, reused as a gate), **Porta Sancti Laurentii** (NW, where the decumanus leaves for the
Appia and the Calore), **Porta Gloriosa** (north, at the bridge of S. Onofrio), **Porta Rectoris**
and a **postern** on the north side, **Porta Rufina** (south; the older one, displaced later), and the
east gate at the end of the decumanus (**Porta Summa**, in its older position). Uncertain: the exact
line of the east side before the 926 annex (I cut it ~85–150 m west of the Rocca), and the old
position of Porta Rufina.

## 5. Places (position; what survives; how it is shown in 700)

World coordinates in metres (x, z).

- **Curtis Ducis** (506, −140) — Piano di Corte, the plan's shaded circle 5. Nothing of the Lombard
  residence survives. Shown with the old gastald's-palace module (a walled court, hall with hearth,
  frescoes, stables), as the dukes' residence before Arechis' Sacrum Palatium.
- **Episcopium**: cathedral of **S. Maria** (−14, −98), consecrated 600: a modest basilica with atrium
  (the 8th-c. atrium is attested by tomb slabs), built with the old abbey-church module, the bishop's
  books in the library module beside it (its "secret cabinet" of Hermetic texts stays as fiction).
  Today's cathedral is a 1950s rebuild over the 12th-c. one; the first church survives as the crypt.
- **Forum** (−40, −168): a market among the remains of a temple; a statue base (illustrative).
- **Arch of Trajan / Porta Aurea** (389, −224): complete then as now (AD 114); part of the walls.
- **Arch of Sacramento** (−76, −61) with the late-antique pentagonal tower beside it (OSM "Torre
  tardoantica"): stripped of marble, a gate.
- **Roman theatre** (−229, −8): Hadrianic, ~90 m across, cavea on vaulted substructures behind an
  outer arcade of 25 arches per order; outside the walls in 700; houses in its arches (reuse certain
  from archaeology), huts on the upper seats, the stage wall broken. The cavea is built block by block
  (`theatrum.ts`): 12 rows of the ima cavea, a walkway (praecinctio) and a parapet wall (balteus), 10
  rows of the media cavea, a second walkway and balteus, 6–7 rows of the summa; 5 radial stairs below and
  11 above, two steps to every row of seats; every seat block with tread, riser and worn nose. Ruined
  for 700: the orchestra silted over the first row and a half, the top rows robbed for lime (unevenly
  round the curve), two sectors slumped where the vaults beneath fell in (rubble slopes, fallen blocks,
  the upper arcade gone over them), single blocks missing, shifted and tipped, earth and weeds in the
  joints.
- **Thermae** (−419, −140): the baths between Porta S. Lorenzo and Port'Arsa (Meomartini), outside the
  circuit; shown with the ruined-baths module (pool, mosaics, collapsed vaults).
- **Amphitheatre** (−593, −214): abandoned since the late antique ruralisation of the west; quarried
  for the walls (blocks in their footings) and burnt for lime ("Porta delle Calcare"): stumps of radial
  walls, a few standing bays, spoil heaps, a lime kiln.
- **Santi Quaranta** (−548, −392): the great Roman complex (cryptoporticus) outside the walls;
  shown with the catacomb module as hypogea used for burial, an ossuary chapel and a martyr's memoria.
  The church "of the Forty" in it is medieval but undated: shown only as a chapel.
- **Torre della Catena** (−517, −27): the 7th-c. fort (today isolated by 1943 bombing); enterable.
- **S. Ilario a Port'Aurea** (429, −285): the little church with two domes in line on the Via Traiana.
- **Ponte Leproso** (axis from (−736.8, −143.4) to (−788.5, −61.4), OSM way 59431406, 97 m: the whole
  modern bridge with its 18th-c. additions and approaches): the Appia over the Sabato, "pons marmoreus quod
  dicitur de Leprosis" in a charter of 1077, named Leproso first in 830. **Size, re-checked (2026)** against
  the only survey, A. Meomartini, *I monumenti…* (1889), pp. 277–283 and Tav. XL–XLI (Wikisource, pages
  djvu/303–308), and it.wikipedia "Ponte Leproso" (which summarises him and notes that Galliazzo's entry has
  "svariate imprecisioni"):

  | | Meomartini (measured) | game before | game now |
  |---|---|---|---|
  | arches | 5 equal, radius 4.35 (span 8.70) | 5 × 8.70 | 5 × 8.70 |
  | arch centre | on the **lower** line of the impost band | on its upper line (+0.60 m) | lower line |
  | impost band | 0.60 high, standing out 0.32 | 0.60 / 0.25 | 0.60 / 0.32 |
  | piers | 5.00 thick, 7.50 long (= width of the bridge) | 5.00 × 7.50 | same |
  | cutwater | triangular, upstream only, stands out 2.50 | 2.90 | 2.50 |
  | voussoirs of the face rings | 1.20 long | 0.95 | 1.20 |
  | pier above the footing (platea) | 4 courses, 2.58 m visible (more buried) | 4.4 m, but buried by the silt | ~0.25 m above the gravel bed + band |
  | bridge between abutments | 5 × 8.70 + 4 × 5.00 = **63.5 m** | 63.5 m | 63.5 m |
  | roadway | level over the bridge | 7.0 m above the water | **6.4 m** above the water (crown extrados + 0.35 m of fill and paving) |
  | approach, town side | walls of bossed blocks ~62 m long, the road falling steeply, then gently, then level | 45 m at 9–10 % | 62 m, 55 % of the fall in the first 22 m, the rest by 50 m, level after |
  | approach, far side | not known | 51 m walled ramp at 10 % | the same fall; bossed walls only to 12 m past the abutment, then an earth bank (agger) |
  | ground under the bridge | (1889: the river pushed to the left bank by the mills, three arches silted) | the 1889 state: three arches silted to 0.4–0.6 m *above* their springing | a gravel bed at 12.75 (water 12.5) under all five arches (see below) |

  So the arch module was right (and the world scale is: equirectangular metres from OSM, checked); what made
  the bridge read as "way too big" was the way it sat in the land: the modern (DEM) ground, raised by the
  silt the mills caused after 1077, buried the three northern arches above their springing, so from the
  meadow one saw a solid wall ~5.5 m high and ~170 m long (ramp foot to ramp foot) with only the tops of
  the openings showing; the deck was 0.6 m too high (arch centre on the wrong line of the band); the far
  ramp was walled in bossed blocks for its whole invented length. Now the ground under the bridge is cut
  down to the Sabato's own gravel bed of 700 (`sites.ts`, a "cut" terrace that only lowers the DEM), so the
  five arches stand open on their piers as Roman bridges do, the river in the southern two; the deck is at
  the surveyed height; only the town approach has its attested walls. Why the real bridge looks smaller
  today: only one Roman pier and parts of two Roman arches survive, both narrowed (to ~8 m and 4.55 m) and
  hidden by the mills; the other three openings are Nauclerio's lower segmental brick arches of 8.30–8.36 m
  (1712); the platea and the banks have risen. Other features after Meomartini: the arches spring from the
  band, all in pseudisodomic work of big, roughly bossed limestone blocks (whence "marmoreus"), the rings of
  great wedge-shaped voussoirs; tuff footings. Restored under Valentinian, Valens and Gratian (367–375),
  whose names were on the parapet (a readable; the wording after the names is reconstruction). Left out as
  later: Nauclerio's four southern arches (1712), the widened mill pier and the mills (after 1077), the
  hospice (830). One downstream ring relaid in brick stands for the late-antique repair. The Appia and the
  lane from the town run to the ramp feet; trees are kept off the bridge, the ramps and the meadow upstream
  on the town bank (the view from the lane). **Pons S. Onuphrii** (−86, −372) over the
  Calore at Porta Gloriosa (today's Ponte Vanvitelli, medieval core).
- **S. Pietro extra muros** (−858, −6): Theodorada's nunnery across the Sabato on the Appia.
- **Iseum** (−33, −73): Domitian's temple of Isis (AD 88/89), its remains in the square before the
  bishop's church. The temple itself has never been found; the evidence: (1) one obelisk was standing
  in front of the cathedral by 1597 (now Piazza Papiniano; its twin is in the Museo del Sannio; both name
  Domitian and the dedicant Rutilius Lupus); (2) H. W. Müller (*Der Isiskult im antiken Benevent*, 1969;
  Ital. tr. 1971) put the temple near the cathedral; (3) a red-granite sphinx was found in the
  Superintendency's excavations in the cathedral area in 2009 (Pirelli, "The Imperial Iseum in Benevento
  and its Zoomorphic Gods", 2023, n. 42); (4) most of the ~50 Isiac pieces came out in 1903 (Meomartini,
  Marucchi, Savignoni, *NSc* 1904) from the foundations of the late-antique/Lombard town walls, i.e. as
  spolia, so their findspot does not give the temple's site — Meomartini himself preferred the
  north-east near the Arch of Trajan, others the theatre. Since the temple stood inside the Roman town
  and its spolia are in the walls of the 4th–7th c. circuit, the most defensible place is the centre,
  by the cathedral (also the user's view). Shown as remains worked into the episcopal quarter: the
  podium with a house on it, granite columns of the pronaos, a fallen and a broken obelisk, two
  sphinxes set up at the atrium gate, a pharaoh walled into a house, the Apis bull (survives, Viale
  San Lorenzo; findspot unknown) sunk at the corner of the square. **Reconstruction** of the
  arrangement; the location is a scholarly hypothesis, not proven. Earlier versions of the game put
  it outside the east gate; that was wrong (a temple of the colony stood inside its walls).
- **Lombard cemetery** (238, 286): the necropolis excavated south of the town (Rotili 1977); poles with
  wooden doves (perticae, Paul the Deacon HL V 34).
- **The walnut** (−330, 478): legend only. The *Vita Barbati* tells of the sacred tree; the later
  witches' walnut was "by the Sabato". Placed by the Sabato south of the town.
- **Mill** (−692, 2) on a leat of the Sabato: mills and baths on the rivers appear in charters of the
  early 8th c. (inferred).
- **Hortus Curtis / site of S. Sofia** (566, −16): S. Sofia was founded c. 760 by Gisulf II and
  Arechis II (Chronicon S. Sophiae), the Lombards' national church: a star-shaped wall round a ring of
  eight pillars and a central hexagon of six Roman columns. No earlier church is attested on the site,
  so in 700 it is the dukes' orchard with a Roman cistern under it (the cistern is invented) and, as a
  foreshadowing, six Roman columns stacked in a rough ring, two carrying a vine (reconstruction; a
  readable tells what will rise here). Teleports "Hortus Curtis" and "Sancta Sophia".
- **Castellum Aquae** (622, 160): the height where the Rocca dei Rettori stands (1321), just outside
  the circuit of 700 beyond Porta Summa (the annex that takes it in is 10th-c.). Excavations of 1998
  found a Samnite rampart and necropolis and a Roman bath building / castellum aquae of the aqueduct from
  the Serino; the Lombard Torrione is of 871/875, a Benedictine nunnery here is 8th-c. (later than 700),
  the papal Rocca from 1321 (Rete museale della Provincia di Benevento, "Rocca dei Rettori"; it/en
  Wikipedia). Shown as the Roman water-castle: a brick hall of two barrel vaults over a cistern (enter
  by the broken arch; water still stands in it), the distribution tank on the roof (climb the stair of
  reused blocks), the last arches of the aqueduct from the east-south-east (two fallen), tombs on the
  slope, and a Lombard timber watch platform over the Via Summa (**inferred**). Readables: the
  water-castle, and what the height will carry (Torrione, castrum, Rocca).

## 6. The town in 700

- **Streets and blocks are the plan's, exactly** (see `layout-vs-plan.png`: A the plan as vectorised and
  registered, B the generated town, C the plan's block outlines over it). The plan's white spaces were
  split into blocks and lanes by shape (narrow and long = lane); where a block's outline has a gap in the
  drawing and it leaked into the lane network, the parts wider than 9.2 m were cut back out as blocks
  (morphological opening, `plan_classify.py`). Result: 679 blocks/open spaces inside the circuit, lanes
  as drawn (median width ~5 m). The ink line between a block and a lane is shared half and half; a line
  between two blocks is their party wall. **Houses stand only inside the plan's blocks**, their fronts on
  the block edge where it meets a lane; nothing is built in the street space. Medieval narrowness shows
  in jetties, pontili, stalls and the worn band along the fronts; the middle of the wider street spaces
  is left as trodden grass.
- **Why the outline differs from the plan's**: the plan draws the later medieval town. The circuit
  standing in 700 (red on the maps) leaves out the Civitas nova of Arechis II (SW, after 758) and the
  annex towards the later Porta Somma (SE, 10th c.). Those parts of the plan exist in the game as ground,
  ruins and roads outside the wall, not as town.
- The decumanus (*platea publica maior*) cannot be traced as one corridor in the plan; it is the cheapest
  path through the plan's lane graph that stays near the line of the later Via Magistrale (Dijkstra in
  `gen_geo.py`), paved at 3.3 m with the old Roman slabs.
- **Built and open: the plan decides.** The user's plan is the authority for what was built and what
  was open in 700, and it draws the buildings themselves: inside the blocks its lines divide the cells
  that are houses. **Every drawn cell of a block is one building with the drawn footprint** (irregular
  outlines kept, simplified to at most ~10 corners, roofs hipped to follow them; the front is the side
  on a lane). Where the plan draws a cell inside another: if what is left of the outer cell is a thin
  band (under 9 m), the outer cell is a ring of buildings (a cloister, a courtyard house) and the inner
  one its courtyard, left open; otherwise the outer cell is a yard with the inner buildings standing in
  it. Cells too big for one house (blocks drawn without inner lines, over ~420 m²) are built up wall to
  wall: houses along every lane edge, back ranges behind them, then the rest tiled with buildings on the
  block's grain. Only the plan's green open spaces are gardens (*orti*), vines, pens (*stabula*),
  meadows and ruins; its street spaces stay open (with pontili and arches over the narrow lanes). The
  exceptions are blocks taken by a landmark the game builds (the curtis, the episcopium and the Iseum
  before it, the forum's precinct) and the 3–4 m band kept clear inside the curtain. An earlier version
  thinned the plan's blocks into gardens by a "density" field following the *città ad isole* model
  (islands of houses among fields and ruins, as Brogiolo and Gelichi describe for many north-Italian
  towns, and the "strong penetration of the countryside inside" Bertelli notes for Benevento); that
  contradicted the plan and was dropped. A ducal capital and bishop's see c. 700 can carry a dense core (on
  Lombard cities staying the political and social centres of their territories: Wickham, *Framing the
  Early Middle Ages*, 2005; on the continuity of urban living under the Lombards: C. La Rocca's work on
  Lombard towns; the *isole* model itself is argued case by case, not as a rule), and the plan's
  own open spaces keep the countryside inside the walls. `tools/benevento/test_layout.ts` reports the
  match: about 80% of the plan's block area lies under house walls (about 90% under their roofs, eaves
  included; the rest is the drawn courtyards, joints under 1 m and small yards) and over 99% of the
  plan's open ground is left open; `layout_vs_plan.py` writes zoomed overlays of the plan's cell
  outlines on the generated footprints. Houses of stone (*casae fabritae*, single or with an upper storey, outside stair) and of
  wood; pontili bridge some lanes (attested later, e.g. *pontile de aurificibus*, and surviving
  examples). The density field now only sets how tall the houses are and where wells and arches go.
- Quarters exposed to the game (`getMapData().districts`) with certainty flags: curtis and Lombard
  quarter (attested), episcopium (attested), forum market (inferred), Latin quarters along the decumanus
  and in the west (inferred), an eastern/Greek household by Porta Aurea (**hypothesis**: churches "de
  Grecis" are attested later), the theatre settlement (attested), mills on the Sabato, lime-burners at
  the amphitheatre, the nunnery, the cemetery.

## 7. Uncertainties

- The plan is schematic: houses are placed in its blocks, not on surveyed 8th-century plots.
- East end of the circuit and Porta Summa's old position; the old Porta Rufina.
- The Iseum's exact site (placed by the cathedral, see §5); the walnut (legend); the cistern (invented); the Santi Quaranta hypogea used
  as catacombs (a reconstruction choice: the complex was a Roman cryptoporticus).
- The 700 ground level was several metres below today's in places; the DEM is modern.

## 8. How it is built (for whoever continues)

- Data: `src/benevento/geo.json` (terrain, rivers, circuit, plan blocks and lanes), made by
  `tools/benevento/*.py` (see each script's header); `sites.ts` (landmark frames, gates, roads,
  districts, explorable targets); `layout.ts` (the 0.5 m town raster: blocks, lanes, lots, plots,
  pontili); `fabric.ts` + `fabric.worker.ts` + `stream.ts` (32 m chunks built in workers, 128 m LOD
  super-chunks of plain prisms beyond 48–68 m); `monuments.ts`, `interiors.ts`, `lore.ts`, `secrets.ts`.
- `theatrum.ts` builds the theatre's cavea block by block (seat blocks are 12–14-triangle shells
  showing tread, riser, worn nose, ends and, where the row behind is gone, the back; a stepped core
  shows where blocks are missing; collision is a smooth ramp through the treads). `pons.ts` builds the
  Ponte Leproso in world coordinates from its OSM axis (bossed ashlar faces in uneven courses with the
  arch openings cut out, voussoir rings, barrels, cutwaters, cornice, basoli, kerbs, parapets; collision
  is the roadway, the side walls and the piers). Masonry is emitted through the arch kit (`Acc`).
- Check the town against the plan: `tools/benevento/test_layout.ts` (writes the raster), then
  `tools/benevento/layout_vs_plan.py` (writes `layout-vs-plan.png`).
- Measured in headless Chromium (SwiftShader, CPU rendering), phone viewport 390×844: world build
  16–23 s, title to *Enter* 40–75 s; at the busiest places 220k–640k triangles and 100–190 draw calls
  per frame; JS heap ~340–365 MB after GC (it was ~900 MB before the CPU copies of the meshes were
  freed). Collision is one merged proxy mesh (boxes and prisms) with a BVH.
- Performance (phone first): `?debug` shows a HUD (`src/perf.ts`) with fps, frame time, CPU ms per
  system, draw calls, triangles, GPU textures / geometries, resolution scale and JS heap. Culling in
  `main.ts` `cull()`: zones, draw distance, cells wholly inside the fog (`src/fogcull.ts`, a CPU twin of
  the shader's height fog: keep its constants in step), and above ground a conservative software
  occlusion buffer of the nearby houses (`src/occlusion.ts`). The stream keeps three details: full
  chunks within 48–68 m, middle chunks within 88–104 m (the same houses built with `DETAIL.mid`
  in `builder.ts`: no small pieces, tiles or bevels, coarse tessellation, about a fifth of the
  triangles), plain blocks beyond. Props are one InstancedMesh per kind and part, refilled per
  instance by range and frustum (`commitProps`). World textures ship as KTX2 (`*.ktx2.wasm`,
  because the host refuses `.ktx2`; `tools/encode-ktx2.mjs`), with the WebP as fallback (`?noktx2`).
- Secrets, explorables and easter eggs: `SECRETS.md`.

## 9. Ponte Fratto (Pons Maior)

**What is known.** The ruins of a Roman bridge over the **Calore at Cellarulo**, the plain north-west of
the town where the Calore turns south to meet the Sabato. Meomartini (1889, *I monumenti*, pp. 250-251,
on the Via Latina) puts it upstream of the confluence, "at the end of the contrada Cellarulo, where one
still sees the ruins of a bridge, which is therefore called *Ponte Fratto*, that is broken bridge", and
notes the Roman road still under the fields from the bridge to S. Maria delle Grazie; he thought the
visible ruins later than the first Roman bridge, but the crossing itself certain
(https://it.wikisource.org/wiki/Pagina:Meomartini_-_I_monumenti_e_le_opere_d%27arte_della_citt%C3%A0_di_Benevento.djvu/276).
The Treccani *Enciclopedia dell'Arte Antica*, "Benevento"
(https://www.treccani.it/enciclopedia/benevento_(Enciclopedia-dell'-Arte-Antica)/) gives it to the
second Roman artery, the branch of the **Via Latina** from Teanum by Allifae and Telesia: "the remains
of the piers of a bridge, the so-called Ponte Fratto, which crossed the Calore in contrada Cellarulo",
next to Republican-to-Imperial kilns and workshops. Local archaeology calls it the **Pons Maior** of the
texts and says it fell after the Middle Ages and was not rebuilt (Archeomedia, "Salviamo e valorizziamo
il Parco archeologico di Cellarulo"; Anteprima24 on the LIPU paths); today only pier stumps show, worn by
floods (Meer, "I ponti della provincia di Benevento"). It is often confused with Ponte Leproso (the Appia
over the Sabato). Torelli brings the Via Latina in by this bridge, Rotili by the bridge of S. Onofrio.
Position: OpenStreetMap node 3734199956 "Ponte Fratto" (41.13920 N, 14.75850 E), on the Calore's real
course (OSM way 838750109). No survey of its spans or masonry was found.

**What the game shows (a reconstruction).** Five round arches of 8.8 m clear span on piers 3.2 m thick,
with pointed cutwaters upstream (the Calore runs south here) and blunter ones downstream; a deck 6.4 m
wide about 7.4 m over the water; abutments into the banks and low embankments (*aggeres*) carrying the
road down to the plain; faced with large limestone blocks over a rubble core (the "massi lapidei a bozze"
reported for the ruins), voussoir rings of dressed stone. In AD 700 it is drawn **damaged but in use**: a
flood has carried off the middle arch (its blocks lie in the river, one with the end of the building
inscription), the gap is spanned with timber on a trestle in the stream, the next arch has lost its
upstream half, the parapets are broken, the road's paving robbed for building, weeds and shrubs grow on
the piers. "Fratto" is the later name; the game calls it Pons Maior, with the modern name in the
teleport. Dimensions, damage and repair are inferences; the two readables there are invented.

**How it is built.** The bridge lies 160 m north of the edge of the baked map (z < -800), so
`src/benevento/cellarulo.ts` supplies the ground there: EU-DEM 25 m from OpenTopoData sampled every
12.5 m, blended into the map's last row over 30 m, with the Calore's real course carved the way
`gen_geo.py` carves the rivers; `geo.ts` `baseHeight()` defers to it north of the map.
`pontefratto.ts` draws that ground and its collision, the water along the real course (trimming the baked
course's shortcut beyond the map edge), the bridge, the road remnants and a wood along the banks (a second
`buildForest` call bounded to the patch, kept off the bridge and roads). Teleport "Pons Maior (Ponte
Fratto)"; region name "Pons Maior"; map landmark.

## 10. Spolia: Roman sculpture in the walls and the ruins

Benevento's late-antique and Lombard walls are known for the Roman material built into them: funerary
portraits and reliefs, inscriptions, altars, heads and column pieces, and Egyptian sculpture of the
Iseum (sphinxes, an Apis bull and other pieces in the Museo del Sannio came out of walls and later
buildings: Treccani EAA "Benevento"; Bertelli Buquicchio 1992; Rotili 1986; H. W. Müller, *Il culto di
Iside nell'antica Benevento*, 1971). The game places 23 scanned pieces (photogrammetry of real Roman and
Egyptian sculpture in museums, CC BY / CC0, credited in `public/models/spolia/CREDITS.md`; none is from
Benevento, so which scan stands for which kind of piece is illustrative):

- **in the outer face of the curtain** all round, thickest by Porta Rufina, the Arcus Sacramenti and Porta
  Summa (where a sphinx and a ram of Amun lie in the footing as building blocks); stelae sometimes upside
  down, torsos laid on their sides as blocks; an epitaph to read by Porta Rufina;
- **in gate jambs** (low, on the gates' outer faces) and **in house fronts** (small heads and a stele, at
  the ends of a front where no opening is cut);
- **lying broken**, half sunk, in the theatre, amphitheatre, baths, Santi Quaranta, by the Arcus
  Sacramenti and S. Ilario, and along the Appia by Ponte Leproso (the roads' tombs);
- **reused**: a headless cuirassed emperor still on a base at the forum (readable "The iron man"), a
  Roman sarcophagus for a burial in the bishop's atrium and another for a Lombard grave (both practices
  attested), a sarcophagus as the mill's trough, a lion and a capital by the church, an altar set up as a
  milestone at Ponte Fratto, a torso as a mounting block inside Porta Summa;
- **Egyptian pieces round the Iseum** (sphinx, seated king, Isis, Apis, ram, a dark sarcophagus lid),
  placed relative to `SITES.iseum`, so they follow the site if it moves.

Placement (`src/benevento/spolia.ts`) is computed at load from the wall plan, the gates, the lots and the
sites, and every spot is tested against the collision already built (1 m occupancy cells), so the pieces
follow the layout when it changes. The scans are packed by `tools/fetch-spolia.ts` (decimated to 5-12k
triangles with ~1-2k far versions, scaled to real sizes, colour greyed); a shader adds grime in the
hollows, rain streaks, lichen, moss on the tops and soil at the foot, and the common fog.
