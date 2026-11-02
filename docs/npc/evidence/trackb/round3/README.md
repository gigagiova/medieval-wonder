# Track B, round 3: main (83b0082) against the fix

**How it was captured.**
- **Game pair sheets** (`NN-*.webp`): `FORCEWALK=1 WHO=monachus,presbyter,diaconus,negotiator tools/npc3/game-capture.mjs` at Episcopium, Forum and Porta Aurea, with the same people in both builds.
  - `FORCEWALK` holds each captured person on their own walk clip, walking in place. The front view's label is recorded before the clip takes hold, so it reads "walk 0.00" though the person is walking.
  - Each sheet shows main front, fix front, main side, fix side.
- **Rig sheets** (`rig-*.webp`, `tools/npc3/capture.mjs`): idle, walk and talk; front, side, back, neck and feet.
- **`diag-hem-patch-is-shoe-cuff.webp`**: the priest's hem with the shoes hidden. The "torn patch" is gone, so it was not painted on the texture.

| Request | Finding and change |
|---|---|
| Wear patch on the robe hem | The patch is not in any texture: the robe's base and normal maps contain no such square. It was the shoe's light folded cuff coming through the hem. Under long robes, shoe parts covered by the robe, or coming through it within 5 cm, are now dropped. |
| Peasant hood edge | The hood is no longer cut at the collar. Below the collar rim it is drawn in to 1 cm inside the collar's radius, so its edge lies under the tunic. Only cloth more than 6 cm below the rim is cut away. The tunic is no longer trimmed by the hood (5137 of 5481 triangles kept, before 5481 → 4605). |
| Robe inside showing at the hem | The robe's skirt is double-walled. The inner wall, found by a ray pointing away from the body hitting the same shell within 3 cm, now copies the outer wall's solved weights: about 450 vertices per robe and about 550 per cowl. |
| Deacon cape nicks | Each shell now copies the weights of only the one nearer shell it mostly lies on: the cape copies the robe body, not the sleeves as well. |
