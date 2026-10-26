# Townsfolk v2 — rebuilding the bodies

`public/models/npc2/*.json|webp` are baked offline from MakeHuman assets and the Renderpeople scans.
The game only loads the results (`src/npc2/kit.ts`); nothing here runs in the browser.

## What you need (not in the repo)

`bash tools/npc2/setup.sh [DIR]` fetches and installs all of it (Blender, MPFB, the packs, the scans) and prints the environment to set.

| what | where from | notes |
|---|---|---|
| Blender 4.2 LTS (portable) | https://download.blender.org/release/Blender4.2/ (`blender-4.2.x-linux-x64.tar.xz`) | ~350 MB, runs headless (`-b`) |
| MPFB 2 extension | https://files.makehumancommunity.org/plugins/mpfb2-latest.zip | `blender -b --command extension install-file -r user_default -e mpfb2-latest.zip` |
| MakeHuman asset packs | https://static.makehumancommunity.org/assets/assetpacks/ | `makehuman_system_assets`, `suits02`, `dress03`, `shoes03`, `hats03` (zips under `https://files.makehumancommunity.org/asset_packs/<pack>/<pack>_<licence>.zip`) — unzip into MPFB's user data dir (`<BLENDER_USER_RESOURCES>/extensions/.user/user_default/mpfb/data`), asset files only |
| scipy for Blender's Python (optional) | `blender/4.2/python/bin/python3.11 -m pip install --target pylib "scipy<1.15"` | put `pylib` on `PYTHONPATH` |
| the scanned heads | `public/models/npc/{eric,nathan,manuel,claudia,sophia,face_grandpa}.json` + their `.webp` | copy each `.json` to `<scans>/<id>.gltf` next to its webp files |

Environment for `build.py`:
- `NPC2_ASSETS` — the MPFB user data dir with the unzipped packs;
- `NPC2_SCANS` — the dir with the `.gltf` copies of the scans and their webp;
- `BLENDER_USER_RESOURCES` — a private Blender config (where MPFB is installed).

## Steps

```sh
# one body: bake (Blender) then pack (node)
blender -b --python tools/npc2/build.py -- m_mid work/m_mid.glb
npx tsx tools/npc2/pack.ts work m_mid
```

Bodies: `m_young m_mid m_old m_elder w_young w_mid` (`specs.py`). A body takes 2–5 minutes.
`build.py` options: `blend` (also save the .blend), `nohead` (keep MakeHuman's head),
`only=a,b` (just those garments), `stop` / `prebake` (save a .blend at that point and quit).

## The stages

- `specs.py` — bodies (phenotype, skin, scan), garments (MakeHuman `.mhclo`, derived, or draped), outfits.
- `headfit.py` — the scanned head: MakeHuman's head drawn onto the scan (landmarks, then surface projection, front projection in the eye sockets), its own UVs, the scan's skin baked/copied onto it, gaps filled with the tone-matched painted skin, the neck blended into the body.
- `derive.py` — garments cut from others (knee tunic and long robe from the monk's robe, shirt and belt from the viking tunic), collars, hems, hoods lifted off the brows with the face opening cut clear, the veil relaxed.
- `drape.py` — cloaks and shawls: cut to the body's hanging outline with folds, skinned from the body.
- `hide.py` — per outfit, which triangles of the body and of lower layers are hidden under what is worn over them (the `_hide` bit mask); layers pushed apart.
- `exportprep.py` — plain glTF materials. `pack.ts` — decimation to the triangle budget, webp textures, JSON glTF.

Credits and licences: `public/models/npc2/CREDITS.md`.

## Why cloth bones (research and decision)

What games and films do for believable clothed crowds, and what fits a phone browser:

- **Vertex Animation Textures (VAT)** — every vertex of a cloth-simulated loop baked into a texture (SideFX, "Vertex Animation Textures for Crowds", https://www.sidefx.com/learn/talks/vertex-animation-textures-for-crowds/; Blender "VAT" add-on for three.js, https://extensions.blender.org/add-ons/vat/; three.js demo of Houdini VAT, https://discourse.threejs.org/t/bringing-soft-and-fluid-body-vertex-animations-from-houdinifx-to-threejs/7411). Zero CPU, but memory grows with vertices x frames x clips x (body, outfit) pairs: ~8k vertices x ~200 frames x 8 bytes = ~13 MB per pair, ~50 pairs here — far beyond what a phone holds (the iPhone already crashed on texture memory). It also freezes the cloth to the clip: no blending between clips, no gear IK, no look-at, no foot planting on uneven ground. Rejected.
- **Runtime cloth (PBD) on the garment mesh** — believable but costs per vertex; affordable for one or two people near the camera only (src/npc/cloth.ts did this for v1).
- **Spring ("dynamic", "jiggle") bones** — skirts, capes and hair skinned to chains of extra bones that a tiny solver swings with inertia, gravity and capsule collisions: the standard for mobile and web characters (VRM SpringBone in three-vrm, https://github.com/pixiv/three-vrm; Unity/Unreal "dynamic bone" assets; Unreal's AnimDynamics; Reallusion's spring bones). Cost is per bone (here 50-80 per person), the garments keep their modelled shape and folds, clips still blend, and the gear IK, look-at and foot planting are untouched. **Chosen.**

So: the bodies and fitted garments are baked in Blender (MPFB fitting and skinning, as before); `cloth_bones.py` adds chains of bones round the hips (skirts, robes, gowns: 12 chains of 3-5 bones) and behind the shoulders (cloaks, shawls: 9 chains of 4-6) and skins the loose cloth to them; `src/npc2/springs.ts` swings them each frame — Verlet tips with velocity relative to the animated hang (a steady walk doesn't make the cloth trail; starting, stopping and turning swing it), damping, a pull back to the hang, capsules round thighs, shins, pelvis, trunk and arms (a striding leg pushes the skirt), and ring constraints between neighbouring chains (the cloth can't fold through itself).

Heads: MakeHuman's head is drawn onto the scanned head by Laplacian surface editing (Sorkine et al., "Laplacian Surface Editing", SGP 2004) — the head keeps its own differential coordinates while soft constraints pull it to the nearest scan surface; constraints are released wherever a face would flip — so the face is a smooth deformation of a clean head mesh, continuous with the neck and body, and its photographed skin is copied onto it. Skin weights of garments come from MakeHuman's own fitting (artist offsets and reference vertices); for a weight transfer where none exists see "Robust Skin Weights Transfer via Weight Inpainting" (Abdrashitov et al., SIGGRAPH Asia 2023, https://github.com/rin-23/RobustSkinWeightsTransferCode).
