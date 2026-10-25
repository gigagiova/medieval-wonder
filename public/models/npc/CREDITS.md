# Townsfolk

Bodies: photogrammetry scans from **Renderpeople**'s free rigged/animated people, published on Sketchfab
under **CC BY 4.0** (https://creativecommons.org/licenses/by/4.0/). Packed by `tools/fetch-people.ts`
(bones renamed to Mixamo's, bind pose, metres, skin atlas repacked to 1024² with normal and roughness
maps, the modern clothes kept only as the shape the period garments are fitted over; lipstick, watches
and rings painted out).

- **eric.json**: "Eric Rigged 001 - Rigged 3D Business Man" by Renderpeople,
  https://sketchfab.com/3d-models/a46bc9f67aaa415bb4f3241eef900e7f — CC BY 4.0
- **nathan.json**: "Nathan Animated 003 - Walking 3D Man" by Renderpeople,
  https://sketchfab.com/3d-models/143a2b1ea5eb4385ae90a73657aca3bc — CC BY 4.0 (its baked clip is not used)
- **manuel.json**: "Manuel Animated 001 - 3D Dancing Man" by Renderpeople,
  https://sketchfab.com/3d-models/e65e0fef4e0743868c8d5bff36d61116 — CC BY 4.0 (its baked clip is not used)
- **claudia.json**: "Claudia Rigged 002 - 3D Rigged Business Women" by Renderpeople,
  https://sketchfab.com/3d-models/c659bd0accab47c6bbe390cf822a2b92 — CC BY 4.0
- **sophia.json**: "Sophia Animated 003 - Animated 3D Woman" by Renderpeople,
  https://sketchfab.com/3d-models/dc448c3be0e74f96a55fb475a13433cf — CC BY 4.0 (its baked clip is not used)

Older faces (worn under hoods and cowls, see src/npc/garment.ts faceSwap), packed by `tools/fetch-faces.ts`
(the face cut from the scanned head, simplified to ~4.5k triangles, its colour re-baked to a 1024² map):

- **face_grandpa.json / .webp**: "Grandpa - RealityScan" by teddygbg,
  https://sketchfab.com/3d-models/35316e9640384a5589ab662a4f4998c8 — CC BY 4.0

Animations: **ual.json**, from Quaternius' **Universal Animation Library** (Standard), CC0 1.0,
https://quaternius.itch.io/universal-animation-library — clips: A_TPose, Idle_Loop, Idle_Talking_Loop,
Idle_Torch_Loop, Walk_Loop, Walk_Formal_Loop, Interact, PickUp_Table, Sword_Idle, Spell_Simple_Idle_Loop,
Fixing_Kneeling, Sitting_Idle_Loop. Packed by `tools/fetch-npc.ts`.

Garments, props and dyes are generated in code (src/npc/garment.ts, src/npc/props.ts), with the
scanned fabrics in public/textures/fabric.
