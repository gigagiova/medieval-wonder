# Houses of Benevento, c. 700: evidence and how the game builds them

This note backs the town's ordinary buildings (`src/town.ts`, `src/arch/*`):
what the archaeology says early-medieval houses in a southern Italian town
looked like, what game artists do to make procedural or modular towns read
as lived-in, and what was built from both. Monuments, walls and interiors
have their own notes (HISTORY.md, REALISM.md).

Certainty flags as in HISTORY.md: **attested** (a source or excavation says
so), **inferred** (from comparable towns of the period), **hypothesis** (a
plausible reading, flagged in the game as such).

## 1. What the houses were like

### Materials: reuse first

- Early-medieval Italian towns were built **out of the Roman town**: rubble
  walls of broken stone, tuff and **reused Roman brick and tile**, set in
  earth or poor lime mortar; dressed blocks, column drums and inscribed slabs
  taken from ruins went into corners, door jambs and thresholds (spolia).
  In Rome the 9th-century houses excavated in the Forum of Nerva were built
  of blocks and material salvaged from the imperial fora (**attested**:
  R. Meneghini, R. Santangeli Valenzani, *Roma nell'altomedioevo*, 2004; the
  Forum of Nerva excavations of 1995-2000; the Wikipedia summary of the
  forum's history notes "houses built on the site, with materials salvaged
  from the ruins"). Benevento's own Lombard buildings (Santa Sofia, 760s;
  the walls of the *civitas nova*) are full of Roman spolia, so the same is
  **inferred** for its houses.
- **Timber and perishable materials** were the norm for much of the early
  middle ages in Italy; masonry for load-bearing walls spreads unevenly and
  is general in civil building only later (**attested** as a broad trend:
  P. Galetti, *Abitare nel Medioevo. Forme e vicende dell'insediamento
  rurale nell'Italia altomedievale*, 1997; *Uomini e case nel Medioevo tra
  Occidente e Oriente*, 2001; G. Bianchi, "La manera de construir, habitar
  y percibir las casas particulares de la alta Edad Media en Italia",
  *Arqueología de la Arquitectura* 9, 2012, 195-212). In a former Roman
  city of the south with plenty of ruins to quarry, mixed buildings are the
  likeliest picture: a stone (rubble and brick) ground floor, a timber or
  timber-framed upper floor, outbuildings of wood (**inferred**).
- Wall faces: in Rome and Campania, rubble faced with courses of reused
  brick ("lacing courses") and patched with whatever came to hand; render
  of lime survives in patches (**inferred** from standing early-medieval
  fabric, e.g. the Lombard phases of Santa Sofia and the walls).

### Form: the *casa solarata* and the *casa terrinea*

- Early-medieval charters of Rome and central-southern Italy distinguish
  the **domus terrinea** (one storey, ground floor only) from the **domus
  solarata** (with an upper floor, *solarium*), the living floor upstairs
  reached by an **outside stair** of stone or timber, the ground floor for
  storage, animals or a workshop (**attested** for Rome from the 9th-10th
  centuries: R. Santangeli Valenzani, "Residential building in early
  medieval Rome", in J. M. H. Smith (ed.), *Early Medieval Rome and the
  Christian West*, 2000; for Naples and the Campanian duchy, the *domus*
  with *solarium* and *scala* of the 10th-century charters, discussed in
  P. Arthur, *Naples, from Roman town to city-state*, 2002). Benevento's
  houses c. 700 are **inferred** to be the same kind.
- The Forum of Nerva houses: **two storeys**, built along the line of the
  old Argiletum street, one of them with a **portico on the street**
  (**attested**, Meneghini & Santangeli Valenzani; FastiOnline AIAC_95;
  Turismo Roma: "ground floor with portico and first floor").
- Roofs: in the Lombard kingdom the *Memoratorium de mercedibus magistri
  commacinorum* (laws of Liutprand's time, early 8th century, MGH Leges IV)
  prices building work by the piece, including roofs of **tiles** and of
  **shingles** (*scandulae*) (**attested**; quoted from the standard
  edition, not re-checked online in this session). Low-pitched roofs of
  curved tiles (*coppi*, Roman *imbrices* over *tegulae*, later coppi over
  coppi) are the Roman and later Italian norm, so tile for the better
  houses and shingle for sheds and poorer houses is the game's split
  (**inferred**). Thatch is attested for rural houses; the game has no
  thatch material yet (see §4).
- **Tower houses** (*case-torri*) of the urban elite are attested in
  Italian towns mostly from the 10th-11th centuries on; for Benevento c. 700
  they are a **hypothesis**, kept rare and only near the duke's curtis and
  the main street.
- Towns of the period were full of **ruins**: houses abandoned and fallen
  in, gardens on their sites (the *città ad isole* debate: G. P. Brogiolo,
  S. Gelichi, *La città nell'alto medioevo italiano*, 1998; HISTORY.md §6).
- Ground-floor **workshops** opening on the street, with counters and
  shutters, are well known from Roman Ostia and Pompeii (*tabernae*) and
  from the later medieval *botteghe*; for c. 700 their continuity in a
  ducal capital is **inferred**.

## 2. How games and artists make towns read as real

- **Modular kits with variation built in**: walls, openings, roofs and
  trims as pieces, with many variants per piece; the big studios dress them
  with **trim sheets** and **decals** and **vertex-painted grime and wear**
  to hide repetition (general practice; e.g. Quaternius' CC0 Medieval
  Village MegaKit, Fab "Medieval Modular Building Kit" trim-sheet kits,
  artist write-ups on ArtStation and Polycount).
- **Silhouette first**: under fog and dusk light, outline and depth read
  before texture. Jetties, galleries, stairs, eaves with rafters, chimneys
  and smoke holes, uneven ridges and roofs at different heights break the
  skyline; flat walls with painted-on detail read as cardboard.
- **Irregularity at the junctions**: Oskar Stålberg (Townscaper, Bad North)
  says the craft of procedural building is in "what happens when things
  change": where two materials meet, where a wall bends at a corner
  (Game Developer, "How Townscaper works"; IndieCade Europe 2019 talk
  "Organic Towns from Square Tiles").
- **Clutter tells the story**: woodpiles, carts, jars, benches, washing,
  hanging baskets, a shop counter, a stair with its rail: the things people
  leave about make a street lived-in (Kingdom Come: Deliverance, A Plague
  Tale, The Witcher 3 villages are all dressed this way; their own
  breakdowns were not found online in this session, so this is the general
  practice, not their pipelines).
- **Merge per material, cull by cell**: modular pieces merged to cut draw
  calls (the game already merges every chunk per material).

## 3. What the game builds (near detail, within ~48 m)

All of it is merged into the chunk's existing per-material meshes (no new
draw calls, no new textures). Big pieces (stairs, counters, shutters,
shingles' underlay, ruins, towers) are built at the middle detail too, the
same shapes; small decoration is full detail only and drawn from its own
random stream (`withStream` in `src/arch/kit.ts`), so the middle detail
still matches the full one piece for piece.

- **Outside stairs** (`planFront` / `buildFront`, `src/arch/dress.ts`): on
  about a fifth of two-storey fronts on lanes of 2.7 m and more, a stone
  flight on a sloping rubble wall up to a landing with a pole rail and the
  upper door; the ground floor's height follows the landing. Planned from
  the lot's seed by a pure function, so the collision pass builds the same
  ramp (walkable).
- **Things in the street**: woodpiles of split logs under a board, stone
  benches on two blocks or a column drum, storage jars, a handcart; also
  planned purely and given simple collision boxes.
- **Workshop fronts**: a wide arch with a masonry counter and slab, the
  dark (now and then firelit) shop behind, the shutter propped out over the
  street on two poles, wares on the counter.
- **Wall dressing**: lacing courses of reused brick in rubble walls
  (broken into lengths, cut by the openings), ragged patches of lime render
  left on rubble and brick, joist heads where the upper floor rests.
- **Washing** on a pole out of an upper window or on a line across a
  narrow lane.
- **Roofs**: the hipped roofs over the plan's irregular footprints (529 of
  ~6,000 houses, many on the streets) now carry real coppi rows in lapped
  courses up to the hips, hip and ridge tiles, boards under the overhang
  and rafter ends (before: a flat tile-textured surface). Shingled roofs
  (*scandulae*) on sheds and poorer back houses; older roofs sag more along
  the ridge.
- **Ruins**: about 3% of back buildings are roofless shells with broken
  walls, a doorway, rafters fallen in and rubble heaps (collision and far
  stand-ins follow: lower prism, no roof).
- **Tower houses**: rare, near the curtis and on the main street; one mass
  of stone, 12.5-17 m, low hipped roof (**hypothesis**).

## 4. Not done / next

- No thatch or moss material (the shaders and materials belong to the
  visual work; a straw material would be the next addition).
- Vertex-colour grime and drip stains need a vertex-colour path in the
  surface shader (not changed here).
- Downloadable assets: the scanned Poly Haven props already in the game
  (`src/props.ts`, barrels, baskets, buckets, stools) are placed by the
  monuments and on the main thread; streamed chunks build in workers and
  merge per material, so the house dressing above is procedural.
