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
