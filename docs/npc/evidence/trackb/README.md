# Track B (`?npc=b`) against default main, in the built game

Captured on 2 November 2026 with `tools/npc3/game-capture.mjs` at Forum,
Episcopium and Porta Aurea. One production build, served once; the default
townsfolk are unchanged by this work. 14 people, 5 of them walking. Sheets
from `tools/npc3/game-pairs.py`, one per person: main front, B ("fix") front,
main side, B side. Method: [tools/npcb/README.md](../../../../tools/npcb/README.md).

`?debug` HUD at 390×844, headless SwiftShader (rendering budget only, not
phone frame times):

| View | main tris / draws | B tris / draws | springs ms/frame (main → B) |
|---|---|---|---|
| Forum | 248k / 97 | 246k / 97 | 0.43 → 0 |
| Episcopium | 259k / 88 | 258k / 88 | 1.16 → 0 |
| Curtis Ducis | 295k / 145 | 294k / 145 | 0.29 → 0 |

Draw calls at Curtis Ducis were 145 in both builds, above the 130 budget;
this was not caused by Track B.

Triangles per person, including props, across all 43 population groups
(`tools/npc3/tris.mjs`): B mean 13.9k (12.4k–16.9k), main 12.9k (11.4k–16.1k).
Per outfit: `tools/npcb/bake-report.json`.
