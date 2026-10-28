# Handover: state of the game (26 October 2026)

This is the state of `main` (fast-forwarded from `claude/medieval-town`) at handover. Read `AGENTS.md` for the rules and the build commands.


## Porta Aurea perimeter correction (28 October 2026)

The old22.6m return-wall solution is superseded. Porta Aurea now lies on a
continuous curtain, with annotation-contaminated wall samples52–54 straightened
between their neighboring samples. Its plan-relative anchor is(389,-256.218),
not the old marker-centroid(389,-224). This prioritizes the owner's original
plan over an exact modern geographic anchor; see
[benevento/AUREA-ALIGNMENT.md](benevento/AUREA-ALIGNMENT.md) for the explicit
registration tradeoff. The raw outline is used only for deterministic layout
sampling. The current map, curtain and containment share the repaired outline.
All6,019 house footprints remain unchanged; the new gate approach joins an
existing lane and Via Traiana follows the relocated passage.

## Missing churches and Pacca burials (28 October 2026)

San Modesto is reconstructed at the old Via Episcopio/Triggio cloister parcel,
not the modern Rione Libertà church. Its small standalone chapel is outside
the retained AD700 circuit and within a registered built parcel. The649
tradition conflicts with the parish's758–774 date; the early chapel is a
reconstruction, not a secure chronological assertion. San Pietro uses existing
lot873 near the former delle Monache site in Piazza Cardinal Pacca; the
user's ad Forum identification remains unverified. Four closed cist graves
in a compact reused underground room are accessible beside its west frontage.
The reported2023 discovery is real, but this700 plan/date/access is inferred.

All6019 existing lot footprints remain unchanged. The new church assignment
is applied after procedural layout so it cannot shift later lots/randomness.
Teleports: Sanctus Modestus, Sanctus Petrus ad Forum, Ad Sepulcra Sancti Petri,
Sepulcra Sancti Petri. The original Triggio burials remain separate. Source
notes: docs/benevento/MISSING-CHURCHES.md and PIAZZA-PACCA.md. Pacca's real-player
descent/interior/return check passes; church entry and parcel containment checks
are recorded with the capture tools. Full-world review: missing-sites-world/.

## Current worktree correction: underground sites

The live Santi Quaranta landmark now represents Roman vaulted passages. Its
unsupported catacomb network, ossuary, martyr shrine, two underground entrances
and funerary teleports have been removed; NPC directions were updated. The site
anchor and town plan are unchanged. Passage dimensions and survival in 700 remain
reconstruction hypotheses. See `docs/benevento/UNDERGROUND-RESEARCH.md` and the
latest HISTORY sections. The older isolated `catacomb-test.html` is a development
scene, not part of the historical map. Modern Triggio/Sabariani/cathedral visitor
routes have not been transplanted into the AD 700 city.

## Current worktree additions: synagogue and urban burials

The owner authorized plausible AD 700 reconstruction where direct evidence is
incomplete. A small synagogue uses existing lot 795 near the later Jewish quarter:
plain scroll cupboard, reading table, benches and lamps. A compact burial chamber
with six slab graves sits beneath existing lot 965 in Triggio, reached by a stair
beside the building. Its inspiration is the Benevento Longobarda Living Museum's
burial layers, not a copy of its modern visitor route. The chosen entrance is about
100 m northeast of the modern museum pin to respect the registered urban plan.
See `JEWISH-PRESENCE.md`, `UNDERGROUND-RESEARCH.md`, `INTERIOR-ANALOGUES.md` and
`HISTORY.md` in `docs/benevento/` for evidence and explicit reconstruction choices.

Teleports: `Synagoga`, `Ad Sepulcra` (stair entrance), and
`Sepulcra Langobardorum` (underground room). Readable objects retain their source
and certainty metadata in code/developer notes; the in-game cards show the object
text and translation without research-status badges. Hebrew uses RTL layout.

Validation: production build passes; the actual capsule controller can descend,
cross the burial room and return to the street. Whole-city captures and both
reading-card checks pass. See `docs/benevento/triggio-validation/`,
`synagogue-validation/`, and `world-interiors-validation/`. The underground
full-world view is dark and offers the existing lantern prompt; no iPhone frame
time measurement was made in the software-rendered capture environment.

## Current worktree correction: Porta Aurea

The Arch of Trajan is rebuilt with broad carved piers, Corinthian pilasters,
relief registers, attic dedication and coffered vault. Its centre is unchanged;
its axis now follows Via Traiana, and local curtain returns connect the piers
to the registered wall circuit. The generated gate approach uses the same
orientation. See `docs/benevento/TRAJAN-ARCH.md` for references, explicit
photo-based dimension estimates and architectural validation. Gate connection
checks are recorded in [gate-validation](benevento/gate-validation/README.md),
and production screenshots in [gate-world-validation](benevento/gate-world-validation/README.md).
The production build passes; passage/barrier checks pass and all 6,019 generated
lot footprints, IDs and explorable selections remain unchanged.
The main narrative decorations now use 14 distinct licensed photographs of the
actual monument on shallow relief geometry, replacing the primitive figures.
One compressed atlas and distance LOD keep the combined release gate view at
136,009 triangles / 81 draws. Capitals and minor motifs remain simplified.
See `docs/benevento/TRAJAN-RELIEF-CANDIDATE.md` and the source credits for limits.
San Lorenzo is connected in the current geometry and all three inspected
full-world approach views; the reported separate gap was not reproduced.

## What exists

- **The city.** Benevento inside its walls at 1:1 scale, from the owner's urban plan:
  - walls, gates and the Calore and Sabato rivers;
  - about 81% of the plan's blocks are built, with the streets narrowed by encroachment as the sources describe (shops, walled yards, gardens);
  - landmarks:
    - the ducal curtis;
    - S. Maria (episcopium) and its library;
    - the Iseum in the centre, near today's Duomo;
    - the forum and cryptoporticus;
    - the reused theatre and the abandoned amphitheatre and baths;
    - the castellum aquae, the Rocca dei Rettori area and the S. Sofia site;
    - Ponte Leproso at its surveyed size (Meomartini 1889) and Ponte Fratto;
    - Ad Caballum: the broken equestrian statue and S. Petrus ad Caballum;
    - about 122 scanned Roman spolia and statues, some set into the walls;
    - monasteries, underground burial chambers and cisterns.
- **Explorables and secrets.** Interiors with readable texts and easter eggs are listed in `docs/benevento/SECRETS.md`. Lore is in `src/benevento/lore.ts`, `readables.ts` and `secrets.ts`.
- **People.** Townsfolk with period roles (`src/npc/population.ts`, documented in `docs/benevento/PEOPLE.md`) and spoken lines (`src/npc/lines*.ts`). The default bodies are v2: MakeHuman bodies with scanned faces, wearing modelled garments that swing on spring "cloth bones".
- **Rendering:**
  - **Light field** (`src/lightfield.ts`): a top-down height map gives the key-light shadow, sky occlusion and the roof test.
  - **Shafts and grading:** light shafts (`src/shafts.ts`), N8AO ambient occlusion, AgX tone mapping, and FXAA in the grade pass.
  - **Fog culling** (`src/fogcull.ts`).
- **Performance:**
  - **Occlusion:** a software depth-buffer occlusion test (`src/occlusion.ts`).
  - **Town streaming:** the town streams in chunks built in a worker (`src/benevento/fabric.ts`, `fabric.worker.ts`), with a middle level of detail out to 80–96 m.
  - **Clusters:** each mesh is split into house-sized clusters (`src/clusters.ts`).
  - **One draw call per material** for the whole town (`src/benevento/pool.ts`), using WebGL2 buffer copies and `GLBufferAttribute`.
  - **Props:** instanced, with a simplified far version made at load by meshoptimizer.

## Map of the code

| Area | Files |
|---|---|
| Entry and frame loop | `src/main.ts`, `src/world.ts` (assembles the world, teleports, landmarks), `src/player.ts` |
| City layout from the plan | `src/benevento/geo.json`, `geo.ts`, `layout.ts` (blocks, lots, encroachment §7b), `sites.ts` (landmark sites, terraces, floor masks) |
| Town buildings | `src/benevento/fabric.ts` and its worker, `src/arch/*` (facades, roofs, dressing), `src/town.ts` |
| Landmarks | `src/benevento/monuments.ts`, `theatrum.ts`, `pons.ts` (Leproso), `pontefratto.ts`, `spolia.ts`, `cellarulo.ts`, `interiors.ts`, `src/palace.ts`, `src/library.ts`, `src/baths.ts`, `src/catacombs.ts` |
| Terrain, water and vegetation | `src/displace.ts`, `src/benevento/rivers.ts`, `src/vegetation/*`, `src/forest.ts` |
| Materials and shading | `src/shaders.ts`, `src/materials.ts`, `src/ktx2.ts`, `src/lights.ts`, `src/fire.ts` |
| People, v1 | `src/npc.ts` (switches between v1 and v2, spawns and updates), `src/npc/*` (scan bodies, procedural garments, population, lines) |
| People, v2 | `src/npc2/kit.ts` (loading), `dress.ts` (outfits), `springs.ts` (cloth-bone solver with 15 m distance LOD), `arms.ts` (smaller backward arm swing under cloaks), `audit.ts` |
| v2 asset pipeline (offline) | `tools/npc2/*`: headless Blender 4.2 with MPFB2. Read `tools/npc2/README.md` before touching it |
| Other offline tools | `tools/fetch-*.ts` (download scans, textures and models; the Sketchfab ones need `SKETCHFAB_TOKEN`), `tools/encode-ktx2.mjs`, `tools/bake-*.ts` |
| Research notes | `docs/benevento/HISTORY.md`, `ARCHITECTURE.md`, `PEOPLE.md`, `SECRETS.md`, `docs/REALISM.md` |

## Owner feedback that drove the recent work

- The townsfolk read as "broken puppets":
  - long necks, faces detached from bodies, floating hands;
  - rigid, synthetic-looking clothes;
  - crumpled faces, broken cloak appendages.

  This led to the v2 pipeline and its rounds of fixes.
- The town inside the walls was too empty. The streets were narrowed, following Arthur, Santangeli Valenzani, Brogiolo and Gelichi, and Bertelli and Rotili on Benevento.
- Ponte Leproso looked too big. Its dimensions were already right; the terrain buried the arches. The 700 riverbed is now restored with a "cut" terrace.
- Earlier rendering bugs, all fixed:
  - impossibly dark shadow bands on facades;
  - cracks in facades;
  - water not rendering, caused by triangle winding;
  - a grainy fog overlay;
  - an iPhone crash from texture memory.

## Open defects and next steps

For the active native-character rebuild and parallel clothing experiments, read
[the continuation record](npc-audit/CONTINUATION.md). It distinguishes validated
raw simulation from rejected thickness finishing and unfinished production rollout.


1. **Real-phone check.** No change since the latest performance pass has been checked on an iPhone. That pass measured, headless at 390×844:

   | View | Triangles | Draw calls |
   |---|---|---|
   | Curtis Ducis | 334k | 116 |
   | Episcopium | 326k | 102 |
   | Other street views | 157–266k | 46–91 |

   Risks: the WebGL2 buffer-copy path in `pool.ts`, index re-uploads while turning, and spring cost (about 0.6 ms on the headless CPU with 15 m LOD).
2. **Cloaks.** While walking, thin slivers of tunic and belt show at the cloak's side edges. The cloak's edge also looks ragged near the collar from the front.

   The hide mask (`tools/npc2/hide.py`) can't reach these, because the cloak does not hang behind them in the rest pose. Options:
   - wrap the cloak further round the sides;
   - also limit how far the arms swing out to the side.
3. **Hoods.** The face-opening lining is now dark and matte. A tiny skin patch still shows at the shoulder edge in the talk pose from behind.
4. **Ad Caballum church.** S. Petrus ad Caballum should have two domes on square drums, like S. Ilario. From the street it reads as a plain box. Showing it as standing in 700 is itself a hypothesis.
5. **Landmarks are the next performance lever.** They draw 139–152k triangles at Curtis Ducis and Episcopium. Coarser wall subdivision on landmarks would save 12–18%.
6. **Loading.** The v1 bodies still load as a fallback in v2 mode, which adds load time.
7. **README.** Bring the intro up to date with the Benevento setting.

## Hosting

The game is published at https://gigagiova.github.io/medieval-wonder/ through
the GitHub Pages workflow on pushes to main. On phones, drag the view to look
and use the on-screen stick to move. Device-orientation controls and their
permission prompt/button have been removed.
