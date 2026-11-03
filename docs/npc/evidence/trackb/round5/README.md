# Track B, round 5: main (1033c83) against the fix (a34e335)

**How it was captured.**
- **Game pair sheets** (`NN-*.webp`): `FORCEWALK=1 WHO=presbyter,diaconus,peregrinus,aldius,mulier,rustica,anus,sanctimonialis tools/npc3/game-capture.mjs` at Episcopium, Forum and Porta Aurea. 9 people matched across the two builds. Each sheet shows main front, fix front, main side, fix side.
- **Rig sheets** (`rig-*.webp`): idle, walk and talk; front, side, back and neck.

| Request | Change | In the captures |
|---|---|---|
| Deacon's cape shard | A cape now copies the weights of the nearest shell under it, body or sleeve, blended where the source changes. | **Not fixed.** The shard in pair 01 (front) is not on the deacon. It is on the bald elder in robe standing between the camera and the deacon, so the earlier `HIDE` test, which hides only the captured person, could not confirm it. In this frame the elder raises his arm, and the grey blade across his back is longer than in main. |
| Women's pink neck | Skin below the jaw is toned to the face's mean colour (baked per-vertex `_TINT`, a ramp over 5 cm below the jaw; the face is unchanged). | Throat and neckline are closer to the face. A salmon band remains behind the jaw and ear in close-ups. At in-game distance (02, 04, 06) the difference is small. |
| Hood shards, right of the jaw | The hood no longer cuts the tunic; the tunic's shoulder stays whole under the tucked hood. | The rig neck close-ups are cleaner. Small bits remain at the far right in the walk. The in-game pilgrim (07) looks clean. |
