# Townsfolk v2

Baked by `tools/npc2/build.py` (Blender 4.2 LTS with the MPFB 2 extension, run headless) and packed by
`tools/npc2/pack.ts`. One JSON glTF per body (`m_young`, `m_mid`, `m_old`, `w_young`, `w_mid`) with its
`.webp` textures: the rigged body and every garment it can wear, fitted and skinned to it.

## Bodies

- **MakeHuman base mesh, Mixamo-named rig and weights, skins** (young/middle-aged/old caucasian male and
  female): MakeHuman system assets, **CC0 1.0**, Data Collection AB / the MakeHuman team,
  https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html
  (MPFB 2 itself is GPL; what it outputs is CC0, see https://static.makehumancommunity.org/about/license.html).
- **Faces and hair**: each head is reshaped into, and re-skinned with, a Renderpeople photogrammetry scan,
  **CC BY 4.0**, via Sketchfab (the same scans as `public/models/npc`, see `public/models/npc/CREDITS.md`):
  m_young — "Nathan Animated 003" (https://sketchfab.com/3d-models/143a2b1ea5eb4385ae90a73657aca3bc),
  m_mid — "Eric Rigged 001" (https://sketchfab.com/3d-models/a46bc9f67aaa415bb4f3241eef900e7f),
  m_old — "Manuel Animated 001" (https://sketchfab.com/3d-models/e65e0fef4e0743868c8d5bff36d61116),
  w_young — "Claudia Rigged 002" (https://sketchfab.com/3d-models/c659bd0accab47c6bbe390cf822a2b92),
  w_mid — "Sophia Animated 003" (https://sketchfab.com/3d-models/dc448c3be0e74f96a55fb475a13433cf),
  all by Renderpeople.

## Garments (MakeHuman community assets, fitted by MPFB)

- Monk's robe (with its rope belt; the knee-length tunic is cut from it), monk's hood up and down:
  **Donitz**, **CC0**, asset pack "Suits 02", https://static.makehumancommunity.org/assets/assetpacks/suits02.html
- Viking tunic (lengthened to the knee here; its belt), viking pants (hose), viking boots (with leg wraps):
  **Rehman Polanski**, **CC0**, asset pack "Suits 02" (as above)
- Medieval boots (turnshoes) and medieval dress (gown): **punkduck**, **CC BY 4.0**, asset packs
  "Shoes 03" (https://static.makehumancommunity.org/assets/assetpacks/shoes03.html) and
  "Dress 03" (https://static.makehumancommunity.org/assets/assetpacks/dress03.html)
- Charity veil: **Elvaerwyn**, **CC BY**, asset pack "Hats 03",
  https://static.makehumancommunity.org/assets/assetpacks/hats03.html
- Cloaks and shawls: modelled and cloth-draped in `tools/npc2/drape.py` (this project).

The garments' own colour maps are used as grey wear/seam detail under the game's dyes and scanned
weaves (`src/npc/fabric.ts`, Poly Haven, CC0); their normal maps as modelled.
