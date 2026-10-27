# Walking motion

`walk-cmu.json` is a compact, looped derivative of **CMU Graphics Lab Motion
Capture Database, subject 07, trial 01 (walk)**. It is genuine recorded walking,
not a new claim of historical movement reconstruction.

The data used in this project was obtained from mocap.cs.cmu.edu. The database
was created with funding from NSF EIA-0196217.

- Original database: http://mocap.cs.cmu.edu/
- BVH conversion: Bruce Hahne, cgspeed, MotionBuilder-friendly release (2010).
- Retrieved source: https://github.com/una-dinosauria/cmu-mocap/blob/09a07f54f3bbb58797325f009282d0b2048a2871/data/007/07_01.bvh
- Usage statement: https://github.com/una-dinosauria/cmu-mocap/blob/09a07f54f3bbb58797325f009282d0b2048a2871/READMEFIRST.txt

> CMU places no restrictions on the use of the original dataset, and I
> (Bruce) place no additional restrictions on the use of this particular
> BVH conversion.

CMU's accompanying statement permits research and commercial use worldwide.

## Reproduce

Download the pinned BVH source above, then run from the repository root:

```sh
node tools/convert-npc-walk.mjs /path/to/07_01.bvh
```

The converter keeps the first-frame reference pose, takes frames 51–181
(one left-foot contact to the next), samples at approximately 30 Hz, removes
capture-floor offsets, and closes the small residual capture drift smoothly.
The glTF stores only joints and animation; no new runtime BVH parser or
textures are required. The existing retargeter adjusts body proportions and
foot contact. Individual fingers use the already-credited UAL idle pose,
because this capture does not record detailed finger motion.
