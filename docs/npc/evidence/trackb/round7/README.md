# Track B, round 7: pushing the shoulder cape outside the robe body (experiment, not shipped)

Each sheet shows Presbyter Iohannes (robe, m_elder) held walking in 12 shots 2 frames apart. The capture command:

`FORCEWALK=1 FRAMES=12 STEP=2 VIEWS=back,front WHO=iohannes tools/npc3/game-capture.mjs`

Compare with round 6 (`../round6/walk-cycle-main.webp`, `walk-cycle-fix.webp`).

**Method** (`cape_on_top` in `tools/npcb/bake.py`, behind `CAPE_ON_TOP`):
- Every cape vertex below the cape's top seam that lies at or inside the robe body, measured along the robe body's normal, is pushed out to 4.5 mm outside it.
- The push is smoothed over the cape (never less than needed). It touched about 180 vertices directly and about 700 after smoothing on m_elder.
- The cover test then runs as before.

| Sheet | Result |
|---|---|
| `walk-cycle-shells-seam4cm.webp` | Seam band 4 cm (`?npcdbg=shells`). Most of the cape is clean; robe-body specks remain inside the 4 cm band below the seam. |
| `walk-cycle-back-seam4cm.webp` | The same, plain render. The dark specks moved up into the seam band; there are about as many. |
| `walk-cycle-back-seam1cm.webp` | Seam band 1 cm. Specks are still present on the upper shoulder-back, about the same amount as round 6. |
| `walk-cycle-front-seam1cm.webp` | Front. No bulges and no new defects. |

**Verdict.** No visible improvement over round 6, so it is not shipped: `CAPE_ON_TOP = False`, and the assets are those of round 6.
