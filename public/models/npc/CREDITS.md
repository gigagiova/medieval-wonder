# Townsfolk

- **man.json**: Ready Player Me sample avatar, as shipped with the three.js examples
  (`examples/models/gltf/readyplayer.me.glb`, MIT-licensed repository). Ready Player Me's own terms apply.
- **woman.json**: "Michelle", a Mixamo character shipped with the three.js examples
  (`examples/models/gltf/Michelle.glb`). Mixamo terms: free to use in projects, not to be redistributed as standalone assets.
- **tpose.json**: T-pose of the Mixamo "Soldier" rig (three.js examples), used only as a retargeting reference.
- **ual.json**: animations from Quaternius' **Universal Animation Library** (Standard), CC0 1.0,
  https://quaternius.itch.io/universal-animation-library — clips: A_TPose, Idle_Loop, Idle_Talking_Loop, Idle_Torch_Loop, Walk_Loop, Walk_Formal_Loop, Interact, PickUp_Table, Sword_Idle, Spell_Simple_Idle_Loop, Fixing_Kneeling, Sitting_Idle_Loop.

Garments, props and dyes are generated in code (src/npc.ts). Packed by `tools/fetch-npc.ts`.
