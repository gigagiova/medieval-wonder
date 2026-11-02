# Track B townsfolk: each outfit baked into one surface

The default townsfolk since b171fcc (`?npc=v2` gives the older layered ones,
`?npc=c` track C).

The v2 people wear separate layered garment meshes that are fitted, hidden and
pushed at run time (spring cloth bones, capsule pushes, rim darkening, hide
masks). Every patch to that machinery exposed a new artefact (torn capes,
cloth through cloth, gashes in robes). Track B removes the run-time machinery
instead: every body × outfit is baked offline into the visible outer surface
only, with one skin-weight field over all of it, and drawn plainly skinned and
single-sided.

```sh
python3 tools/npcb/bake.py public/models/npc2 <out_dir> [body ...]   # numpy + scipy, no Blender; ~2.5 min a body
cp <out_dir>/*.json public/models/npcb/ && cp public/models/npc2/*.webp public/models/npcb/
```

The input is the shipped v2 bodies (with the belts and facings of
`tools/npc3/wardrobe_build.py`). The steps, per body (details in the
docstring of `bake.py`):

1. **Clean shells.** Each connected shell of each garment is wound and shaded
   to face away from the body. Saw-tooth "ear" triangles (two open edges)
   along cut hems are peeled off. Linings, facings and inner tubes are
   dropped whole: a shell lying (90%) within 3.5 cm inside a larger shell of
   the same garment, or one that 80% of straight rays from it meet another
   shell within 12 cm (the under-skirt tube of the knee tunic). Their rims
   came out under hems in the stride; every open edge gets its own band
   (step 5) instead.
1b. **Collar.** A hood worn with a tunic goes into the tunic's collar: the hood
   below the collar's rim (per angle round the neck) is cut away, so the
   collar's finished edge shows, not the two cloths crossing.
2. **Clearance (offline).** Where a surface lies on another garment worn under
   it, or on another shell of the same garment nearer the body (a robe's
   shoulder cape over its body), the outer one is moved out to 6 mm above
   it. Moves are at most 15 mm and spread smoothly. Only the cloth's outward
   face is moved.
3. **One weight field.** Garment vertices take the body's skin weights:
   - within 2 cm of the body, from the nearest body points, fading out by 8 cm;
   - elsewhere, inpainted harmonically over the cloth, with the near points
     fixed (Abdrashitov et al., "Robust Skin Weights Transfer via Weight
     Inpainting", SIGGRAPH Asia 2023);
   - **by region:** each bit of cloth belongs to the left arm, the right
     arm or the rest of the body, by distance along the cloth from where it
     touches the skin, and takes weights from that region only (a bell sleeve
     hanging by the hip follows the forearm, not the hip);
   - **long skirts** (hem below the knee): from the pelvis at the crotch towards the
     legs at the hem (70% legs at the hem, rising as t^1.5), each half following its own leg
     there, shared softly across the middle (σ 9 cm), so the skirt reads as a
     skirt in the stride, not as trousers; short skirts follow the thighs;
   - **layered:** cloth within 2.5 cm of cloth worn under it (another garment, or
     another shell of the same garment nearer the body: the cape on the robe,
     the belt on the tunic) copies that cloth's weights, so the two move as one.

   The cloth bones and finger bones are not used. The body's own weights,
   and the head and face, are byte-for-byte the v2 ones.
4. **Visible surface only.**
   - **Covered:** a vertex of the skin, or of an inner garment, is covered
     when five rays (its normal and four at 35° round it) all meet something
     worn over it within 30 cm. That includes other shells of the same
     garment.
   - **Crossing:** an inner vertex lying *outside* an outer garment is
     dropped as well, when a ray inward meets the outer garment within
     2.5 cm (7 cm under hoods, cowls and veils).
   - **Dropped:** a triangle goes when all three of its corners are covered
     or crossing.
   - **Covered by a lower layer too:** any garment worn counts, not only those
     over it (a hood's edge tucked under a collar).
   - **Always kept:** neck and head skin, and shoes. Under robes that reach
     the ankle, the shoes' small strap pieces are dropped instead.
   - **Legs and feet:** skin inside a shoe or boot (below its top less 1.5 cm)
     goes, so no heel shows through it; under a skirt to the ankles all the
     leg skin goes (it came through the skirt's front in the stride).
   - **Specks:** dropped groups of fewer than six triangles are kept.
5. **Thick edges.** Every open edge of a garment gets a turned-in band. The
   cloth within 6 cm of the edge is copied 4 mm inward with the winding
   reversed and shaded as the cloth's inside (`_SHADE` 0.8). It is joined to the
   edge by a rim with its own corners, shaded with the edge's own normal
   (along the cloth, outward), so the rim reads as the cloth's thickness and
   not as a dark crease.

Output: `public/models/npcb/<body>.json`, with the same skeleton, materials and
webp images as v2. Every outfit (a set of garments, belt styles included, no
cloaks) is its own nodes `body|<outfit>` and `G_<garment>|<outfit>`. They share
the vertex data; only the triangle lists differ. `<outfit>` is the outfit's
garment ids, sorted and joined by `+`. `bake-report.json` gives the triangles
per outfit.

At run time (`src/npc2/kit.ts`, `dress.ts`, `src/npc.ts` under `NPC_B`):
- only the person's outfit nodes are kept;
- no `_hide` masks, spring bones (`springs.ts`), capsule pushes (`push.ts`) or
  back-face rim darkening;
- garments are drawn `FrontSide`;
- the layer depth bias of `dress.ts` is kept (a view-space depth offset, not a
  geometry change).

## Cloaks

Cloaks are left off, as in v2 (`UNCLOAKED` in `src/npc.ts`). A cloak skinned
with the trunk's weights alone cannot follow the arms. With the arms' weights
it tears at the sides in the walk. Neither bakes cleanly as part of one
surface over the swinging arms.

## Known limits

- **Robes swing as the legs do.** With no cloth simulation and no spring
  bones, the skirt between the legs stretches like wide trousers in the
  stride.
- **The peasant's hood is short.** It ends just under the tunic collar. Its
  lower edge shows as a jagged line where it passes into the collar.
- **Defects in the source assets show as in v2:** the painted wear patches on
  the robe texture, and the open heel of the boots and shoes.
