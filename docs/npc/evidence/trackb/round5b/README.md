# Track B, round 5b: the grey blade on the priest's back

**Main** is 1033c83. **Fix** is c7fefa4 plus the `game-pairs` change for the back view.

## What the blade is

The blade appears in pair 01, the close view from behind of Presbyter Iohannes (robe, m_elder). He stands between the camera and the deacon being captured. Three diagnostics identify it:

- `diag-band-debug.webp` (`?npcdbg=band`): the blade has no red or blue, so it is not the turned-in band or rim.
- `diag-hide-robe.webp` (`HIDEALL=1 HIDE=longrobe`): the blade disappears with the robe, so it belongs to the robe mesh.
- `diag-shells-before.webp` (`?npcdbg=shells`, one colour per island): red is the cape, orange the robe body, cyan the sleeve. Orange and cyan show through the red cape on the back. The grey blade is the robe body crossing the cape near the right shoulder blade, darkened by the cape's shadow.

**Root cause.** The bake decided which shell lies on which by comparing their median distance from the body. A long skirt and a wide sleeve hang further from the body on average than a shoulder cape, so the cape was never treated as lying over them. As a result, the cape did not copy their weights, they were not dropped under it, and they did not follow it.

**Why round 5 made it longer.** Round 5 made the cape near the sides copy the sleeves, so it followed the arm and opened further.

## Fix (tools/npcb/bake.py)

- **Local test.** "Lies on" is judged locally: a shell lies on another where that shell's nearby points are closer to the body (`lies_on`).
- **Cape follows the robe body.** The cape copies the robe body's weights within 6 cm. The round-5 sleeve copying is reverted.
- **Inner shells follow the cape.** Robe body and sleeve vertices under the cape take the cape's weights. Over the 4 cm above the cape's edge they blend back to their own.
- **Inner shells dropped.** Where a ray straight out from the body, or along the vertex normal, meets the cape within 8 cm, the inner shell is dropped. A 2 cm margin is kept at the cape's edge.
- **Depth bias.** Cape shells are drawn 1.2 cm nearer the eye (baked `_BIAS`, a view-space depth offset only).

## Result

**The blade is reduced, not gone.** In the same walking frame, the long blade in main becomes two small grey shards (`blade-closeup-main-vs-fix.webp`). In another walk phase it was gone entirely (`blade-diagnosis-before-shells-after.webp`, right).

**Other robe wearers.** I captured every robe wearer from behind while walking: priest, deacon, two monks, two merchants, the Jew, the doctor, two pilgrims in robes, and a peasant pilgrim (`NN-*.webp`; back and front, main then fix). No other blade appears from behind.
