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
- **Roman theatre** (−229, −8): outside the walls in 700; houses in its arches (reuse certain from
  archaeology), huts on the upper seats, the stage wall broken.
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
- **Ponte Leproso** (−764, −99): the Appia over the Sabato; **Pons S. Onuphrii** (−86, −372) over the
  Calore at Porta Gloriosa (today's Ponte Vanvitelli, medieval core).
- **S. Pietro extra muros** (−858, −6): Theodorada's nunnery across the Sabato on the Appia.
- **Iseum** (660, 168): Domitian's temple of Isis (AD 88), whose obelisks and statues (the Apis bull)
  survive scattered; its exact site is unknown — placed outside the east gate, where Isiac fragments
  are built into the later walls and the Rocca. **Reconstruction.**
- **Lombard cemetery** (238, 286): the necropolis excavated south of the town (Rotili 1977); poles with
  wooden doves (perticae, Paul the Deacon HL V 34).
- **The walnut** (−330, 478): legend only. The *Vita Barbati* tells of the sacred tree; the later
  witches' walnut was "by the Sabato". Placed by the Sabato south of the town.
- **Mill** (−692, 2) on a leat of the Sabato: mills and baths on the rivers appear in charters of the
  early 8th c. (inferred).
- **Hortus Curtis** (566, −16): the future site of S. Sofia, in 700 the dukes' orchard with a Roman
  cistern under it (the cistern is invented).

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
- Density: houses are dense along the decumanus, round the curtis, the bishop's church and inside Porta
  Aurea; elsewhere blocks are gardens (*orti*), vines, pens (*stabula*), meadows and ruins of Roman
  houses — "strong penetration of the countryside inside" (Bertelli). Houses of stone (*casae
  fabritae*, single or with an upper storey, outside stair) and of wood; pontili bridge some lanes
  (attested later, e.g. *pontile de aurificibus*, and surviving examples).
- Quarters exposed to the game (`getMapData().districts`) with certainty flags: curtis and Lombard
  quarter (attested), episcopium (attested), forum market (inferred), Latin quarters along the decumanus
  and in the west (inferred), an eastern/Greek household by Porta Aurea (**hypothesis**: churches "de
  Grecis" are attested later), the theatre settlement (attested), mills on the Sabato, lime-burners at
  the amphitheatre, the nunnery, the cemetery.

## 7. Uncertainties

- The plan is schematic: houses are placed in its blocks, not on surveyed 8th-century plots.
- East end of the circuit and Porta Summa's old position; the old Porta Rufina.
- The Iseum's location; the walnut (legend); the cistern (invented); the Santi Quaranta hypogea used
  as catacombs (a reconstruction choice: the complex was a Roman cryptoporticus).
- The 700 ground level was several metres below today's in places; the DEM is modern.

## 8. How it is built (for whoever continues)

- Data: `src/benevento/geo.json` (terrain, rivers, circuit, plan blocks and lanes), made by
  `tools/benevento/*.py` (see each script's header); `sites.ts` (landmark frames, gates, roads,
  districts, explorable targets); `layout.ts` (the 0.5 m town raster: blocks, lanes, lots, plots,
  pontili); `fabric.ts` + `fabric.worker.ts` + `stream.ts` (32 m chunks built in workers, 128 m LOD
  super-chunks of plain prisms beyond 48–68 m); `monuments.ts`, `interiors.ts`, `lore.ts`, `secrets.ts`.
- Check the town against the plan: `tools/benevento/test_layout.ts` (writes the raster), then
  `tools/benevento/layout_vs_plan.py` (writes `layout-vs-plan.png`).
- Measured in headless Chromium (SwiftShader, CPU rendering), phone viewport 390×844: world build
  16–23 s, title to *Enter* 40–75 s; at the busiest places 220k–640k triangles and 100–190 draw calls
  per frame; JS heap ~340–365 MB after GC (it was ~900 MB before the CPU copies of the meshes were
  freed). Collision is one merged proxy mesh (boxes and prisms) with a BVH.
- Secrets, explorables and easter eggs: `SECRETS.md`.
