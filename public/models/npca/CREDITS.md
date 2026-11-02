# Track A townsfolk (`?npc=a`)

All CC0 1.0 (public domain dedication, https://creativecommons.org/publicdomain/zero/1.0/), by
**Quaternius** (https://quaternius.com), free "Standard" editions downloaded from itch.io:

- **Modular Character Outfits - Fantasy** (Standard),
  https://quaternius.itch.io/modular-character-outfits-fantasy: the Peasant and Ranger outfits,
  male and female (tunic, sleeves and hands, hose, boots, leather jerkin, belt, hood). The
  "Dark" body-skin map of the pack is a light-tan skin.
- **Universal Base Characters** (Standard), https://quaternius.itch.io/universal-base-characters:
  the heads and necks (cut from the Superhero full bodies, light skin maps), eyes, eyebrows,
  hair (simple parted, long, buns, buzzed) and beard.
- Animations: the game's existing Universal Animation Library clips and CMU walk
  (see ../npc/CREDITS.md and ../npc/CMU-WALK-CREDITS.md), retargeted at load.

Changed by `tools/npca/build.py` and `tools/npca/simplify.mjs`: bones renamed to Mixamo's,
parts recombined per outfit, the ankle-length skirts of robes and gowns added (generated,
not by Quaternius), textures packed into two 1024² atlases (cloth turned to grey for
dyeing at run time), meshes simplified.
