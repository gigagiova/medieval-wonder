# Tree models

All downloaded from Sketchfab and processed by `tools/trees/build-trees.mjs`
(re-centred, scaled to metres, decimated with meshoptimizer, quantized and
meshopt-coded into `trees.json`; textures repacked into the `bark`/`leaf`
atlases as WebP, ≤1024²). Impostors (`impostor*.webp`) are rendered from these
meshes by `tools/trees/bake-impostors.cjs`.

| In the game | Model | Author | Licence | Source triangles → used |
|---|---|---|---|---|
| `oakL1-3`, `oakB1/3/4`, `oakM1-3`, `oakS1-2` (every oak; bark, late-autumn and early-autumn twig clusters) | [Oak trees pack (17var, LODs, seasons, gameready)](https://sketchfab.com/3d-models/a5e4e64f9f1d4089bdcc6170a9333393) | lolipop_1707 | CC BY 4.0 | 409k (all variants, LODs, seasons) → the author's LOD0-2 of 11 variants, plus one coarser generated LOD |
| `ancient` (old pollard oak) and the crusty bark tile | [Old Oak without Leaves (high-poly)](https://sketchfab.com/3d-models/74064e17b0204be3951e177e5ed4abbc) | Sereib | CC BY 4.0 | 190k → 17.7k / 5.7k / 2.3k |
| `twisted` (dead twisted tree) and the dead-wood bark tile | [Dead tree](https://sketchfab.com/3d-models/3db412498aec432da8687afe37cc32bb) | YN14R | CC BY 4.0 | 232k → 18k / 5.9k / 2.4k |
| `snag` (dead snag) | [Dead tree](https://sketchfab.com/3d-models/ec6a65e8a9c9440d94927a6c15ef4bf5) | YN14R | CC BY 4.0 | 78k → 8.7k / 3.4k / 1.4k |
| `poplar` (river banks) and the poplar bark tile | [Poplar tree](https://sketchfab.com/3d-models/b47ff662f35644638cbf4c95eca4772a) | intice184 | CC BY 4.0 | 26k → 26k / 11k / 5.3k / 2.6k |

Ground cover, stumps, logs and roots under the trees are the Poly Haven scans
listed in `public/models/props/CREDITS.md`.
