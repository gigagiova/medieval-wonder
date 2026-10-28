# Medieval Wonder — *Abbatia Nebularum*

A walkable Lombard town of around AD 750 at dusk on a foggy, overcast day, packed inside what is left
of a Roman circuit. Houses of river cobble and reused Roman brick stand wall to wall along a couple of
crooked lanes and dozens of 1.3–2 m alleys. Rooms bridge the alleys on arches (*pontili*), and flying
arches brace facing walls apart. The old forum temple has houses grown against it, and a Roman arch
straddles the main lane. In the north-west stands the abbey: an early-Christian basilica on mismatched
spolia columns with a half-fallen atrium, and an ossuary chapel whose stair leads down into catacombs
carved out of the rock. Outside the gate are a dry aqueduct and tombs along the road.

Nothing is flat or symmetric. Every surface is bent by a continuous displacement field and carries
parallax relief. The catacombs are a single carved surface (an SDF polygonized with surface nets), with
loculi, arched burial niches, side chambers and a crypt. Lighting follows the period: braziers, pitch
torches, Roman horn lanterns, clay *lucernae*, and *polykandela* in the church. There is no street lighting.

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

**Controls:** on phones, use the on-screen stick to walk and drag the view to look around. Motion sensors are not used. On desktop: click to enter · WASD to walk · Shift (or push the stick to the edge) to hasten · mouse look / click-drag · F lantern · Space jump. Gamepad: left stick move, right stick look, triggers run, A jump, X/Y lantern.

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
- **Town** (`src/town.ts`): streets are random walks rasterized onto a 0.5 m occupancy grid. Lots are packed
  along every frontage with irregular depths, and every leftover scrap of land gets a back building.
  Pontili and flying arches go wherever both sides of an alley are built. A texture of the grid tells the
  ground shader where the river cobbles, the surviving Roman basalt paving and the central gutter are.
- **Catacombs** (`src/catacombs.ts`): one signed distance field of carved air (galleries along meandering
  polylines, a stair, side chambers, loculi, lamp niches, collapses), spatially hashed, sampled on a 0.2 m grid.
- **Fire** (`src/fire.ts`): instanced upright billboards with domain-warped noise mapped through a
  blackbody ramp, layered tongues, and rising embers.
- **Bones** (`src/bones.ts`): signed-distance-field anatomy polygonized with marching cubes, baked
  occlusion in vertex colours, two levels of detail, instanced.
- **Culling:** the world is merged into 36 m cells per material and per zone. Each frame, cells are
  culled by zone (underground vs. street level, which handles the biggest occluder, the earth itself),
  by fog distance, and by occlusion: rays from the eye to each cell's bounds against the collision
  BVH, with hysteresis. Inside a cell, triangles are sorted into 8-9 m clusters and an index buffer
  lists only the clusters in the frustum, out of the fog and not behind the houses of a small software
  depth buffer (`src/clusters.ts`). The streamed town shares one vertex buffer per material, so all
  its chunks are one draw call per material (`src/benevento/pool.ts`); props get a simplified far level.
- **Sound:** fully synthesized with WebAudio: wind, a chant drone near the church, bells, footsteps,
  echo in the catacombs.

`?shot=x,y,z,yaw,pitch` places the camera (used for headless screenshots); `?debug` shows FPS in the title.

Terrain data: TINITALY 1.1, INGV (Tarquini et al., 2023),
[doi:10.13127/tinitaly/1.1](https://doi.org/10.13127/tinitaly/1.1), CC BY 4.0.
See [terrain attribution and adaptations](public/licenses/tinitaly.txt).
