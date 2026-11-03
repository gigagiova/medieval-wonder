# Track B, round 6: the small shards on the priest's back

Each sheet shows Presbyter Iohannes (robe, m_elder) from behind, held walking, in 12 shots 2 frames apart: about two strides. The capture command:

`FORCEWALK=1 FRAMES=12 STEP=2 VIEWS=back WHO=iohannes tools/npc3/game-capture.mjs`

`FRAMES` and `STEP` are new in `game-capture.mjs`.

| Sheet | What it shows |
|---|---|
| `walk-cycle-main.webp` | Main (e437a69). Tiny dark specks at the lower edge of the shoulder cape in several frames. |
| `walk-cycle-shells.webp` | The fix with `?npcdbg=shells`: red is the cape, cyan the robe body. Small robe-body specks show on the cape in the **same places in every frame**, so they are present in the bind pose. They are not caused by the arm swing. |
| `rejected-drop-outside-cape.webp` | Rejected attempt: drop robe-body points that have the cape within 3 cm on their body side. It cut a black hole in the upper back, because there the robe body is the outer surface and the cape's lower part lies under it. Reverted. |
| `walk-cycle-fix.webp` | Kept: no inner-shell margin at the cape's edge (it was 2 cm) and a cape depth bias of 2 cm (was 1.2 cm). No holes, and about the same as main. The tiny specks remain in a few frames. |

**Why the specks are still there.** The cape and the robe body interleave in the source mesh: the cape is on top in some places and under the robe body in others. The ray rules cannot tell which surface should win there.

**Not done: a multi-pose coverage test.** The bake has no animation. The clips are retargeted from UAL and CMU in the browser (`src/npc/rig.ts`) and are not available to the Python bake. Doing it would mean exporting posed vertex positions from the browser for a few walk frames per body, then running the cover test against them.
