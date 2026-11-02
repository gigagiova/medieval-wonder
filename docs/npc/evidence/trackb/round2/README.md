# Track B, round 2: main (b171fcc) against the fix

**How it was captured.**
- **Game sheets** come from `tools/npc3/game-capture.mjs` at Forum, Episcopium
  and Porta Aurea (15 people per build). `game-pairs.py` matched 8 people
  across the two builds; the others differ because walkers arrive in a
  different order.
- **Pair sheets** (`NN-*.webp`): main front, fix front, main side, fix side.
- **Fix-only views** (`fix-only-*.webp`): the people captured only in the fix
  build. They include a walking woman (anus) and two walking soldiers.
- **Isolated rig** (`rig-*.webp`, `tools/npc3/capture.mjs`): rows are idle,
  walk and talk; columns are front, side, back, neck and feet.

**What changed.** Method: [tools/npcb/README.md](../../../../../tools/npcb/README.md).

| Defect | Change |
|---|---|
| Robe cape gashes | Cloth lying on cloth now copies that cloth's weights, so the cape and robe move together. Lining and facing shells are dropped. The cover test also counts the garment's own shells. |
| Peasant-hood edge and tunic flecks | The hood is cut at the collar rim. The knee tunic's inner skirt tube and its hem lining are dropped, and saw-tooth "ear" triangles are peeled off. |
| Skirt like trousers | Long skirts blend from the pelvis at the waist towards the legs at the hem (70% legs at the hem), with a soft split between the legs. |
| Gown neckline line | The rim has its own vertices, shaded with the edge's normal. The inside band is lighter (0.8). |
| Bell-sleeve flaps | Each piece of cloth takes weights from one region only (left arm, right arm, or the rest), found by distance along the cloth. |
| Pink heels | Skin inside shoes is dropped. Under skirts that reach the ankle, all leg skin is dropped. |
