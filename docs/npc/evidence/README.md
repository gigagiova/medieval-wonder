# Townsfolk wardrobe: evidence (29 October 2026)

"Main" is the published build (`df5b806`, the bodies as baked by `tools/npc2`).
"Now" is this branch. Both were measured with the same tools, the same audit
code (`src/npc2/audit.ts` copied into the main tree for the run) and the same
people (`src/population-test.ts`, fixed seeds).

## Close-ups, main against now

`sheets/<group>-<n>.webp`: one sheet per person. Rows: idle, walk, talk (0.4 s
into the loop after a 1.5 s warm-up). Columns: front, side, back, neckline,
waist (belt), hands, feet. In each pair, main is on the left, now on the right.

| Role | Sheet | Belt now |
|---|---|---|
| Lombard freeman, armed | `arimannus-0` | leather strap, bronze buckle, multi-part set |
| Lombard retainer, cloak | `gasindus-0` | leather strap, bronze buckle |
| Lombard officer, cloak | `sculdahis-0` | leather strap, bronze buckle, set |
| Half-free, hood / cloak | `aldius-0`, `aldius-1` | leather strap, iron buckle |
| Slave | `servus-0` | hemp cord |
| Latin merchant, robe / mantle | `negotiator-0`, `negotiator-1` | leather strap, iron buckle |
| Notary | `notarius-0` | woven sash |
| Priest, robe / mantle | `presbyter-0`, `presbyter-1` | white linen cingulum |
| Monk, cowl / bare | `monachus-0`, `monachus-1` | hemp cord |
| Lombard woman | `langobarda-0` | woven girdle |
| Latin townswoman | `mulier-1` | woven girdle |
| Nun of St Peter's | `sanctimonialis-0` | dark woven girdle |
| Greek merchant | `graecus-0` | woven sash |

What to look at: the walk feet and legs (main: slivers of shin and empty
shoes under skirts and robes; now: covered shins, the skirt carried over the
striding leg), the backs of mantles (main: holes; now: closed), the belts
(cinched cloth, ends hanging straight), the hands (wrists straight).

## Per-frame crossing audit

`crossings-main.json`, `crossings-now.json`: for 15 people, every frame of one
full loop of idle, walk and talk at 30 fps (2955 frames each): the crossing
vertices per layer pair, the wrist bend of each hand (degrees), and where the
crossings are (by bone). Method: [../WARDROBE.md](../WARDROBE.md#measuring).

| | main | now |
|---|---|---|
| Frames with any crossing | 2866 / 2955 | 2390 / 2955 |
| Crossing vertices per frame (mean) | 43.5 | 24.5 |
| Largest wrist bend, any frame | 152° | 0.2° |

Per person and clip:

| clip | person (outfit:body) | frames with crossings, main | now | mean vertices/frame, main | now | worst frame, main | now | wrist max °, main | now |
|---|---|---|---|---|---|---|---|---|---|
| idle | arimannus (soldier:m_young) | 75/75 | 75/75 | 13.5 | 19.0 | 14 | 39 | 147 | 0.0 |
| idle | gasindius ducis (soldierCloak:m_young) | 75/75 | 75/75 | 40.6 | 64.2 | 49 | 122 | 147 | 0.0 |
| idle | sculdahis (soldierCloak:m_mid) | 75/75 | 75/75 | 27.0 | 41.4 | 37 | 48 | 40 | 0.0 |
| idle | aldius (peasantHood:m_old) | 75/75 | 75/75 | 37.0 | 12.5 | 45 | 16 | 17 | 0.0 |
| idle | aldius (peasantCloak:m_mid) | 75/75 | 75/75 | 21.1 | 40.6 | 32 | 47 | 17 | 0.0 |
| idle | servus (peasantHood:m_young) | 75/75 | 75/75 | 32.9 | 13.3 | 37 | 14 | 17 | 0.0 |
| idle | negotiator (robe:m_elder) | 75/75 | 75/75 | 70.5 | 11.0 | 138 | 22 | 17 | 0.0 |
| idle | negotiator (robeCloak:m_young) | 75/75 | 75/75 | 48.8 | 36.1 | 89 | 83 | 17 | 0.0 |
| idle | presbyter (robe:m_old) | 75/75 | 73/75 | 87.9 | 27.0 | 131 | 38 | 17 | 0.0 |
| idle | presbyter (robeCloak:m_old) | 75/75 | 75/75 | 41.1 | 58.6 | 68 | 77 | 17 | 0.0 |
| idle | monachus (monk:m_mid) | 75/75 | 58/75 | 98.5 | 11.9 | 126 | 47 | 17 | 0.0 |
| idle | monachus (monkBare:m_elder) | 75/75 | 75/75 | 76.7 | 13.0 | 132 | 26 | 17 | 0.0 |
| idle | femina Langobarda (woman:w_mid) | 75/75 | 0/75 | 18.5 | 0.0 | 34 | 0 | 38 | 0.0 |
| idle | mulier Beneventana (womanShawl:w_mid) | 75/75 | 4/75 | 20.9 | 0.1 | 35 | 1 | 38 | 0.0 |
| idle | ancilla Dei (woman:w_young) | 75/75 | 58/75 | 39.9 | 4.6 | 61 | 13 | 17 | 0.0 |
| walk | arimannus (soldier:m_young) | 33/33 | 30/33 | 27.7 | 8.2 | 51 | 32 | 152 | 0.0 |
| walk | gasindius ducis (soldierCloak:m_young) | 33/33 | 33/33 | 68.5 | 148.5 | 126 | 261 | 152 | 0.0 |
| walk | sculdahis (soldierCloak:m_mid) | 33/33 | 33/33 | 49.5 | 99.2 | 96 | 233 | 60 | 0.0 |
| walk | aldius (peasantHood:m_old) | 33/33 | 33/33 | 71.6 | 10.4 | 158 | 14 | 60 | 0.0 |
| walk | aldius (peasantCloak:m_mid) | 33/33 | 33/33 | 92.4 | 157.5 | 182 | 262 | 60 | 0.0 |
| walk | servus (peasantHood:m_young) | 33/33 | 33/33 | 57.3 | 17.8 | 122 | 31 | 60 | 0.0 |
| walk | negotiator (robe:m_elder) | 33/33 | 33/33 | 65.2 | 12.4 | 138 | 87 | 60 | 0.0 |
| walk | negotiator (robeCloak:m_young) | 33/33 | 33/33 | 90.7 | 93.2 | 158 | 176 | 60 | 0.0 |
| walk | presbyter (robe:m_old) | 33/33 | 30/33 | 76.7 | 17.5 | 212 | 112 | 60 | 0.0 |
| walk | presbyter (robeCloak:m_old) | 33/33 | 33/33 | 108.7 | 146.9 | 229 | 272 | 60 | 0.0 |
| walk | monachus (monk:m_mid) | 33/33 | 31/33 | 75.6 | 21.3 | 145 | 82 | 60 | 0.0 |
| walk | monachus (monkBare:m_elder) | 33/33 | 33/33 | 72.7 | 10.5 | 161 | 33 | 60 | 0.0 |
| walk | femina Langobarda (woman:w_mid) | 33/33 | 13/33 | 30.8 | 2.7 | 71 | 25 | 60 | 0.0 |
| walk | mulier Beneventana (womanShawl:w_mid) | 33/33 | 13/33 | 28.2 | 4.2 | 73 | 34 | 60 | 0.0 |
| walk | ancilla Dei (woman:w_young) | 33/33 | 27/33 | 39.7 | 9.2 | 98 | 41 | 60 | 0.0 |
| talk | arimannus (soldier:m_young) | 0/89 | 31/89 | 0.0 | 0.5 | 0 | 2 | 27 | 0.2 |
| talk | gasindius ducis (soldierCloak:m_young) | 89/89 | 89/89 | 9.5 | 8.8 | 23 | 15 | 28 | 0.0 |
| talk | sculdahis (soldierCloak:m_mid) | 89/89 | 89/89 | 25.5 | 39.8 | 34 | 75 | 31 | 0.0 |
| talk | aldius (peasantHood:m_old) | 89/89 | 89/89 | 21.5 | 11.8 | 30 | 14 | 28 | 0.0 |
| talk | aldius (peasantCloak:m_mid) | 89/89 | 89/89 | 17.2 | 23.5 | 28 | 32 | 28 | 0.0 |
| talk | servus (peasantHood:m_young) | 89/89 | 89/89 | 30.8 | 12.9 | 37 | 19 | 28 | 0.0 |
| talk | negotiator (robe:m_elder) | 89/89 | 89/89 | 62.9 | 7.8 | 123 | 14 | 28 | 0.0 |
| talk | negotiator (robeCloak:m_young) | 89/89 | 89/89 | 19.0 | 36.0 | 29 | 66 | 28 | 0.0 |
| talk | presbyter (robe:m_old) | 89/89 | 89/89 | 88.1 | 28.7 | 129 | 36 | 28 | 0.2 |
| talk | presbyter (robeCloak:m_old) | 89/89 | 89/89 | 34.8 | 47.3 | 44 | 56 | 28 | 0.0 |
| talk | monachus (monk:m_mid) | 89/89 | 85/89 | 102.0 | 6.0 | 121 | 26 | 28 | 0.0 |
| talk | monachus (monkBare:m_elder) | 89/89 | 89/89 | 69.1 | 11.5 | 121 | 19 | 28 | 0.0 |
| talk | femina Langobarda (woman:w_mid) | 89/89 | 0/89 | 12.8 | 0.0 | 16 | 0 | 38 | 0.0 |
| talk | mulier Beneventana (womanShawl:w_mid) | 89/89 | 0/89 | 14.8 | 0.0 | 19 | 0 | 38 | 0.0 |
| talk | ancilla Dei (woman:w_young) | 89/89 | 0/89 | 12.1 | 0.0 | 14 | 0 | 28 | 0.0 |

Reading it:

- **Not a like-for-like count for cloaked outfits.** On main the tunic or robe
  under a cloak was hidden below the shoulders (and the shins under long
  skirts), so it could not be counted crossing anything; it showed as holes
  in the walk instead. Now it is drawn, and its crossings through the cloak
  are counted: those rows rise. They are the main open defect (below).
- **Robes and gowns, uncloaked:** crossings fall by 70–100 %; the women's
  gowns are clean in idle and talk.
- **What remains in the "now" totals**, by layer pair (vertex-frames):
  `shirt>cloak` 20821, `shoes>longrobe` 15244, `body>cloak` 11588,
  `longrobe>cloak` 7802, `body>shirt` 3898, `shoes>robe` 3105,
  `tunic>hood` 2730. The `shoes>robe` and `shoes>longrobe` counts are shoe
  vertices at the hem edge; close-ups with the cloak hidden
  (`capture.mjs` with `HIDE=cloak`) show the hem clear of the shoe, so they are
  counted near the open edge rather than seen. `body>shirt` is mostly the
  fingertips of the armed man's left fist on the sword's pommel, against the
  tunic's skirt.

## Rendering budget

Headless (SwiftShader) numbers, so relative only, not phone frame times.

Triangles per person, all visible meshes and held props (`tools/npc3/tris.mjs`,
all 43 group/outfit combinations): mean 12 102 on main, 13 210 now (max
15 780 → 16 810). By outfit (mean on main, mean now, max now):

| Outfit | main | now | max now |
|---|---|---|---|
| monk | 13 725 | 15 470 | 15 470 |
| monkBare | 12 398 | 14 332 | 14 332 |
| peasantCloak | 12 261 | 13 277 | 13 853 |
| peasantHood | 12 464 | 13 446 | 14 341 |
| robe | 11 863 | 13 677 | 13 838 |
| robeCloak | 12 209 | 14 189 | 14 872 |
| soldier | 12 673 | 12 681 | 13 641 |
| soldierCloak | 13 001 | 14 018 | 16 810 |
| woman | 11 044 | 11 680 | 12 740 |
| womanShawl | 11 105 | 11 740 | 11 848 |

The increase is the shins and under-cloak garments now drawn, the neckline
facings and the belts.

`?debug` HUD at 390×844, `?at=Templum`, after 25 s (`tools/npc3/perf.mjs`):
main 110 draw calls, 176k triangles; now 114 draw calls, 164k triangles (the
crowd around the camera differs between runs). Spring (cloth bone) CPU time,
15 people walking in `population-test.html`: 0.100 ms per person-frame on main,
0.106 now; a whole step of 15 people: 4.64 ms on main, 5.64 now (straight
wrists, grasp search and the push capsule update). The push itself runs in the
vertex shader: up to 16 capsules per garment vertex.
