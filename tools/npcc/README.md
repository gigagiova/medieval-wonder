# Townsfolk, track C: already-clothed single surfaces, auto-rigged

`?npc=c` in the game. The default townsfolk (v2) are unchanged.

Instead of layering garments on a body at runtime (v1, v2), each person is one model that already
wears its clothes, from Sketchfab (CC BY 4.0, `public/models/npcc/CREDITS.md`). Blender fits a
Mixamo-named skeleton to it and skins it; the game retargets its usual clips onto it
(`src/npcc/kit.ts`, `src/npc.ts`). There are no garments, cloth bones or hide masks: the clothes are
part of the skinned surface, so they cannot tear apart from the body or poke through each other.

## Sources looked for (November 2026)

Sketchfab searches (downloadable, any licence, then filtered to CC BY / CC0): "medieval peasant scan",
"monk scan", "reenactor photogrammetry", "medieval photogrammetry person", "tunic scan", "medieval
woman scan", "viking reenactor scan", "nun scan", "medieval costume", "historical costume scan",
"viking scan", "robe 3d scan", "medieval rigged peasant", "shepherd scan", "pilgrim", "re-enactment",
"living history", "medieval man", "medieval woman", "peasant", "villager realistic", "monk character",
"friar", "priest character", "hooded robe character", "old man scan full body", "farmer scan",
"scanned human cc0", "medieval villager", "tunic man", "dark ages", "anglo saxon", "lombard",
"t-pose medieval", "monk t-pose", "nun", "medieval peasant woman", "byzantine".

Result: no downloadable photogrammetry scan of a person in period costume. "Monk" scans are statues.
What exists are artist models and AI-generated (Meshy) single-surface characters; seven were taken
(see CREDITS). Renderpeople's free rigged people wear modern clothes (the v1 bodies already use them).

## Pipeline

```sh
# Blender 4.2 LTS portable, headless
SKETCHFAB_TOKEN=... # download each uid in specs.py as glb (Sketchfab download API) to DL/<uid8>/model.glb
blender -b --factory-startup --python tools/npcc/build.py -- c_villager DL/b8da7ee4/model.glb work/c_villager.glb [debug]
npx tsx tools/npcc/pack.ts work c_villager
```

`build.py`:
1. import, transforms baked, metres, feet on z=0, facing -Y; rescaled to the height in `specs.py`;
2. multi-part models: faces of a part covered by another part within 4 cm along the normal are
   deleted (eyes excepted), then all parts are joined;
3. decimated to the triangle budget; models with several textures get one atlas: each source
   texture copied whole into a power-of-two cell (cells sized by the surface they cover, faces
   boosted), the UVs moved into the cell (no re-bake: the artists' texels are kept);
4. skeleton (Hips, Spine-Spine2, Neck, Head, HeadTop_End, Shoulder/Arm/ForeArm/Hand/HandMiddle1,
   UpLeg/Leg/Foot/ToeBase/Toe_End) from landmarks: spine and legs from body proportions and slices
   of the mesh, arms measured on T-posed meshes; for the others the arm joints are given by hand in
   `specs.py`, read off front and side renders with a metric grid (`debug`);
5. bone-heat weights computed on a closed voxel remesh of the low mesh (1.2 cm), transferred to it
   by nearest-face interpolation (every layer of cloth gets the weights of the surface around it);
6. robes and long skirts (`skirt`): vertices away from the leg bones blend towards weights shared by
   the pelvis and both thighs/shins according to their side (Hips 0.35-0.5), so cloth between the
   legs stretches instead of tearing; weights smoothed, at most 4 per vertex, normalised.
