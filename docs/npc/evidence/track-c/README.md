# Track C evidence: already-clothed single-surface townsfolk (`?npc=c`)

Pipeline and sources: `tools/npcc/README.md`, credits `public/models/npcc/CREDITS.md`.

## Captures (2 November 2026)

`tools/npc3/game-capture.mjs` on the production build with `QS=&npc=c`, places Forum, Episcopium,
Porta Aurea, 14 asked, 12 captured (walking, talking, idle, kneeling; `people.json`). Baseline:
the default (v2) townsfolk of `main` 4610839 captured with the same tool and places.

- `pairs/NN-<name>.webp`: `tools/npc3/game-pairs.py` sheets, default (labelled "main") against track C
  (labelled "fix"), front and side, for the 9 people present in both runs.
- `pairs/c-only-*.webp`: track C people with no baseline twin (different crowd at Porta Aurea).
- `stride/`: Blender stress pose (`tools/npcc/stride.py`: thighs 32° / 22° apart, knee 35°).
  `stride-all.webp` is from before the feet were kept out of the skirt weighting; the trailing feet
  there are wrong. `stride-robes-zoom.webp` is after that fix.

## `?debug` HUD at 390x844 (headless SwiftShader on a loaded shared machine: ms are meaningless)

| View | default (v2) | track C |
|---|---|---|
| Forum | 97 calls, 247k tris, tex 132, heap 326 MB, npc 45.6 ms | 59 calls, 243k tris, tex 78, heap 307 MB, npc 1.0 ms |
| Episcopium | 88 calls, 260k tris, tex 111 | 70 calls, 254k tris, tex 73 |
| Curtis Ducis | 146 calls, 303k tris, tex 151 | 118 calls, 292k tris, tex 130 |

Per person: one draw call (two for the nun), 4.5k-14k triangles (villager 12k, man 10k, eastern 12k,
soldier 14k, woman 14k, nun 4.5k, friar 12k), one 1024² webp (80-150 KB). Default v2 people measured
12.5k-16k triangles in several draws each.

## Defects seen (full-size inspection)

- The woman's long belt end swings out from the hip as a stiff strap in the walk (skinned to a thigh).
- The friar holds a cord in his left hand; in the clips it sticks out sideways as a rigid rod.
- Pale specks on the woman's dark gown sleeves (texture), a dark fold at her left hip.
- Variety: seven bodies only; every woman is the same white-haired woman, every Greek/Jew/merchant the
  same bearded man. No skin tinting per person (each model keeps its own tone: fair to light olive).
- Period: the "eastern" model wears a fez-like cap and salvar trousers (Ottoman look, anachronistic);
  the man's leather jerkin with frog fastenings reads later medieval; the soldier is an Anglo-Saxon
  reconstruction (close to, but not, Lombard); the friar's habit is a later mendicant habit. Monks of
  700 (Benedictine) wore a similar cowled tunic, but the friar also stands for priests and deacons.
- Three of the seven are AI-generated (Meshy): softer, smoothed textures with baked lighting; the
  friar's habit had to be desaturated.
- The friar's face is pale and young under grey hair; the nun's eyes are blank white (her source model).
- No props: track C people carry nothing (gear and belt fittings are hung on v1/v2 garments).
- Auto-rig limits: no finger bones (hands stay as modelled), shoulders weighted by bone heat (no
  twist bones), arms of the woman and nun placed by hand.
