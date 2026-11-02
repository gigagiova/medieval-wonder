# Track B, round 4: main (fe14ea6) against the fix

**How it was captured.**
- **Game pair sheets** (`NN-*.webp`): `FORCEWALK=1 WHO=monachus,presbyter,diaconus,negotiator,aldius,rusticus,peregrinus tools/npc3/game-capture.mjs` at Episcopium, Forum and Porta Aurea. 9 people matched across the two builds. Each sheet shows main front, fix front, main side, fix side.
- **Rig sheets** (`rig-*.webp`): idle, walk and talk; front, side, back and neck.
- **`robe-detail-map-flattened.webp`**: the robe's detail texture after flattening.

| Request | Change | In the captures |
|---|---|---|
| Priest's dark vertical streaks | Cause: broad fold stripes painted into the robe's grey detail map (`*_3.webp`), which the shader doubles (`detailMap` in `src/npc2/dress.ts`). The band, depth and normals are not involved. `tools/npcb/flatten_detail.py` pulls the broad part (6 px masked blur) to 20% of its contrast and keeps the weave. Applied to the npcb copies only. | Robe bodies read more even in the rig. In game the priest's front still shows long shading lines down the robe: the stripes are weaker, not gone. |
| Deacon's cape | No turned-in band or rim on open edges lying on cloth (within 2 cm); those edges are lifted 3 mm instead (about 350 vertices per robe). | The cape edge is cleaner in the rig. In game, the close view from behind (01, front) still shows a grey shard at the cape's lower edge, as in main. So that shard is not the band. |
| Hood shards under the jaw | Hood cloth within 5 cm of the tunic moves with the tunic. | The rig neck close-ups still show a few shards at the right side; the in-game peasant (07) looks clean at that distance. |
