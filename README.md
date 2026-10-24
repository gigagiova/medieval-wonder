# Medieval Wonder — *Abbatia Nebularum*

A walkable, fog-drowned Lombard town of the 8th century living inside the shell of a Roman one:
late-Roman brick walls patched with river stone, the basalt-paved cardo and decumanus, a forum of
fallen columns, a broken triumphal arch, a dry aqueduct and roadside tombs outside the gate. In the
middle stands a Benedictine abbey: an early-Christian basilica on reused marble columns, a cloister,
a library tower, and an ossuary chapel whose stair leads down into catacombs.

Lighting follows the period: no street lamps, but braziers at gates and squares, pitch torches,
Roman-type horn lanterns, clay *lucernae*, and bronze *polykandela* with glass oil cups in the church.
No downloaded assets (the sandbox it was built in could not reach asset hosts): all geometry,
including the sculpted skulls and bones, is generated in code, and every surface is a custom shader.
Drop CC0 `skull.glb`, `femur.glb`, `humerus.glb`, `tibia.glb` into `public/models/` and `loadBones()`
will use them instead.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

**Controls:** click to enter · WASD or on-screen stick to walk · Shift (or push the stick to the edge) to hasten · mouse look / drag / right-half touch drag · F lantern · Space jump · gamepad: left stick move, right stick look, triggers run, A jump, X/Y lantern.

## How it's made

- **Three.js + Vite + TypeScript.** The whole world is merged into one draw call per material.
- **Procedural surfaces** (`src/shaders.ts`): ashlar stone, cobbles with puddles, plaster with
  fallen patches, wood, slate roofs, tuff rock, bone, leaded windows. All are projected in world
  space and injected into `MeshStandardMaterial` through `onBeforeCompile`, so PBR lighting and
  shadows still work. Moss, grime and damp are layered on by height and slope.
- **Atmosphere:** exponential height fog with drifting noise, plus a *closed-form* in-scatter integral
  per lamp, which gives cheap volumetric halos. Different fog underground.
- **Lighting:** moonlight with shadows, plus a pool of 10 point lights reassigned each frame to the
  nearest torches, lanterns and candles (with flicker). Flames are procedural point sprites.
- **Post:** bloom → ACES → custom grade (teal shadows / amber highlights), grain, vignette, fringe.
- **Nothing is flat** (`src/displace.ts`): every surface is subdivided, then pushed through one continuous
  world-space vector field. Walls bulge and lean, roofs sag, wall bases ride the uneven ground, and the
  catacombs look hand-hewn. Pieces that touch stay touching because the same point always moves the same way.
  On top of that, parallax occlusion mapping gives real depth to cobbles, mortar joints, dented planks,
  slates, plaster and rock.
- **Collision:** capsule vs. BVH (`three-mesh-bvh`), built from the displaced geometry.
- **Fire** (`src/fire.ts`): instanced upright billboards with domain-warped noise mapped through a
  blackbody ramp, layered tongues, and rising embers.
- **Bones** (`src/bones.ts`): signed-distance-field anatomy polygonized with marching cubes, baked
  occlusion in vertex colours, two levels of detail, instanced.
- **Culling:** the world is merged into 36 m cells per material and per zone. Each frame, cells are
  culled by zone (underground vs. street level, which handles the biggest occluder, the earth itself),
  by fog distance, and by occlusion: rays from the eye to each cell's bounds against the collision
  BVH, with hysteresis. Three.js frustum-culls what remains.
- **Sound:** fully synthesized with WebAudio: wind, a chant drone near the church, bells, footsteps,
  echo in the catacombs.

`?shot=x,y,z,yaw,pitch` places the camera (used for headless screenshots); `?debug` shows FPS in the title.
