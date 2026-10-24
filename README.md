# Medieval Wonder — *Abbatia Nebularum*

A walkable, fog-drowned 8th-century walled town in the browser: a Benedictine abbey with church,
cloister and a towered *Aedificium*, an ossuary chapel whose stair leads down into catacombs, and
lamp-lit streets. No downloaded assets: all geometry is generated in code and every surface,
the fog, the sky and the flames are custom shaders.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

**Controls:** click to enter · WASD walk · Shift hasten · mouse look (or drag) · F lantern · Space jump · Esc pause.

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
- **Sound:** fully synthesized with WebAudio: wind, a chant drone near the church, bells, footsteps,
  echo in the catacombs.

`?shot=x,y,z,yaw,pitch` places the camera (used for headless screenshots); `?debug` shows FPS in the title.
