# Dramatic realism on a phone: techniques adopted

Research notes behind the lighting / shading / atmosphere / post work, with
what each technique fixes, what it costs on a phone, and where a published
implementation exists. "Adopted" items are in the code (file named); the rest
are candidates.

## Why surfaces read as plastic or clay (diagnosis)

Plastic is rarely specular in this game (world specular is already ~0):

- **Flat, shadowless, ambient-dominated light.** Under even IBL, normal maps
  and scanned relief barely change the shading, so a stone wall reads as a
  smooth moulded skin. Real overcast dusk still has a direction (the bright
  part of the sky) and strong *occlusion* (alley floors, joints, eaves).
- **Albedo too uniform, roughness too uniform.** Polycount critiques of
  "plastic" materials repeatedly point at missing large/medium-scale tone and
  roughness variation and wear that ignores the surface (dirt where water and
  dust collect, clean where exposed) — e.g.
  [polycount 1](https://polycount.com/discussion/comment/2297215),
  [polycount 2](https://polycount.com/discussion/comment/2650004).
- **AO applied like a tint, not like occlusion.** Multiplying albedo by AO
  darkens direct and indirect light equally and flattens contrast. Engines
  separate: full AO (with multi-bounce) on indirect diffuse, *specular
  occlusion* on reflections, and *micro-shadowing* on direct light.

## Lighting

| Technique | Fixes | Phone cost | Implementation | Status |
|---|---|---|---|---|
| Top-down height map "world AO" + heightfield sun shadow, baked around the player | street floors dark, upper walls lit; interiors/arches dark; soft directional shadows with no shadow-map pass per frame | 2 fetches/pixel; bake (1 top-down draw + 1 quad) every ~30 m | home-made (`src/lightfield.ts`), after the top-down "world AO" idea used in AAA open-world games | adopted |
| Low key light from the bright west of the overcast (directional, ~19°) | gives normal maps and relief something to respond to | free (one light) | three.js DirectionalLight | adopted |
| Micro-shadowing from the AO map on *direct* light, `saturate(abs(NoL) + 2·ao² − 1)` | relief shadows itself under the key light; no flat "painted" AO | ~4 ALU | Naughty Dog, [Technical Art of Uncharted 4](https://advances.realtimerendering.com/other/2016/naughty_dog/index.html); Unity HDRP [Micro Shadows](https://docs.unity3d.com/Packages/hdrp/manual/Override-Micro-Shadows.html) | adopted |
| Multi-bounce AO (GTAO polynomial per albedo) on indirect diffuse | dark materials' crevices go properly dark, light ones keep some bounce | ~6 ALU | Jimenez et al., [Practical Real-Time Strategies for Accurate Indirect Occlusion](https://www.activision.com/cdn/research/Practical_Real_Time_Strategies_for_Accurate_Indirect_Occlusion_NEW%20VERSION_COLOR.pdf) | adopted |
| Specular occlusion from AO, NoV and roughness | no sky sheen inside crevices and joints (one of the plastic tells) | ~5 ALU | Lagarde & de Rousiers, [Moving Frostbite to PBR](https://careers.ea.com/frostbite/news/moving-frostbite-to-pb) §4.10.2; Lygia [specularAO.glsl](https://git.gay/kaneraZh/lygia/src/branch/main/lighting/common/specularAO.glsl) | adopted |
| Screen-space AO (N8AO) at half res, depth-aware upsample | contacts, creases | existing pass | `n8ao` | kept; per-frame transparency detection and its two extra scene renders removed |

## Shading

| Technique | Fixes | Phone cost | Implementation | Status |
|---|---|---|---|---|
| Height-blended layers (dirt/moss/damp settle in the low parts of the height map first) | crisp joints, dirt in crevices, wet bases of walls | 0 extra fetches (height already in the packed map) | Unreal "HeightLerp" / [Unigine blend by height](https://developer.unigine.com/ch/docs/2.16/content/materials/graph/samples/blend_by_height/) | adopted |
| Cavity darkening of albedo from the scanned height | joints and pores read deep | free | — | adopted |
| Per-stone / per-patch tone and roughness variation at several scales | uniform "painted" surfaces | 0–1 fetch (existing noise texture) | polycount advice above | adopted |
| Stronger normals for stone near the camera | relief responds to the key light | free | — | adopted |
| Wet only where water lies (gutters, puddles in low spots, film between cobbles, damp wall bases): low roughness and full specular there, matte elsewhere | the "wet street" read of A Plague Tale / TLOU2 without plastic dry stone | free (mask from existing height + town maps) | — | adopted |
| Decaying lime render over rubble (height-blended patches with a dark lip) | smooth plaster read as clay | +1 planar sample set on plaster only | — | adopted |
| Less metre-scale geometric displacement on masonry (bulge/lean kept) | smooth-normal dents read as moulded clay | free (load-time) | — | adopted |
| River: two-fetch drifting ripples, mud-coloured shallows (no shoreline seam), Fresnel (Schlick F0 0.02) reflection of our own sky | invisible / plastic water | 2 fetches | — | adopted |
| Skin: wrapped diffuse with a red-shifted terminator (cheap pre-integrated SSS) | waxy/plastic faces | a few ALU | NVIDIA [GPU Gems ch.16](https://developer.nvidia.com/gpugems/gpugems/part-iii-materials/chapter-16-real-time-approximations-subsurface-scattering); Penner, [Pre-Integrated Skin Shading](https://www.slideshare.net/slideshow/penner-preintegrated-skin-rendering-siggraph-2011-advances-in-realtime-rendering-course/13966747) | already in `src/npc/scan.ts`; tuned |
| Cloth: rough dielectric base, energy-compensated Charlie sheen, subtle weave normals | bright artificial rims and exaggerated faceting | physical sheen ALU; no extra draw pass | [Three.js physical lighting](https://github.com/mrdoob/three.js/blob/dev/src/renderers/shaders/ShaderChunk/lights_physical_pars_fragment.glsl.js); [Filament cloth model](https://github.com/google/filament/blob/main/shaders/src/surface_shading_model_cloth.fs) | implemented in `src/npc/fabric.ts`; [controlled comparison](npc-audit/README.md#material-control-comparison) |

## Atmosphere

| Technique | Fixes | Phone cost | Status |
|---|---|---|---|
| Analytic height fog (closed-form integral), world-anchored density | flat grey veil; noise "slapped on" the screen | ~2 fetches | adopted (`applyAtmos`) |
| Ray-marched shadowed in-scattering of the key light through the light field, half res | light shafts, layered depth | 12 fetches at ¼ of the pixels | adopted (`src/shafts.ts`) |
| Analytic lamp halos (1/(h²+t²) integrated in closed form) | warm pools in the cold mist | per lamp ALU, skipped for dark lamps | kept |
| Mist dimmed by sky visibility | interiors not filled with outdoor haze | 1 fetch | adopted |

## Sky

- Domain-warped cloud deck from the shared noise texture (3 fetches), with
  dense dark bellies against a paler deck and a grey (not warm) glow in the
  west; swept side by side for value structure (bright sky vs dark streets).

## Tone and grade

- **AgX** instead of ACES: no hue skew in lamps, greyer highlights, better for
  grading ([three.js tone mapping overview](https://discourse.threejs.org/t/tone-mapping-overview/75204)).
  Khronos PBR Neutral keeps colours "true" but deep shadows darker and light
  colours saturated — not wanted for a desaturated dusk.
- No film grain or chromatic fringe (they read as an old filter); a dither
  below one 8-bit step only.
- FXAA in the grade pass (the scene target is single-sampled).
- Film-still grade: S-curve, split toning (cold shadows, faint warm
  highlights), colour muted except warm firelight, vignette; bloom only
  above 0.95 (lamps, fire).

## Character reconstruction

The [NPC audit](npc-audit/README.md) separates material effects from incorrect
geometry and rigging. The [cloak research](npc-audit/CLOAKS.md) records retrieved
Blender and NVIDIA guidance on textile patterns, clasps, draping, moving-body
collision, motion constraints and simulation resolution. The replacement cloak
must pass visual and phone-budget checks before it is described as adopted.
