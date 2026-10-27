# Brazier containment, charcoal surface and fire

The old coal cylinder exceeded the sloping inner bowl before placement. The
Builder then displaced iron at full strength and ember material at 20%, moving
the two parts differently. A visible slab emerged through one side. The old
ember shader made almost the whole cylinder emissive and drew a regular Voronoi
pattern; its reversed-edge smoothstep also had undefined GLSL behavior.

The replacement keeps the bowl, tripod and fuel surface in one rigid placement.
A common base field sample and constant terrain lift prevent their relative
separation. The flame and point light align with that same placement. The fuel
is a single low, recessed surface; its two radii fit the sloping cavity. There
are no separate low-poly charcoal chunks. The owner rejected that intermediate
approach because the modeled pieces reduced perceived realism.

The 512² charcoal image is **generated, not photographed or scanned**. Neutral
normal and packed maps keep this an honest flat-surface treatment rather than
pretending to contain measured PBR depth. See the texture source manifest for
provenance. The surface stays matte and opaque. Restrained red heat follows only
the image's darkest gaps; there is no Voronoi or procedural glowing vein web.
Existing animated flame tongues, rising sparks and the warm point light remain.
No simulation or additional animation library was added.

Material approach follows the separation of base color, roughness and emissive
radiance in [Filament's PBR reference](https://google.github.io/filament/main/filament.html).
The tripod and bowl remain reconstruction geometry, not an excavated object scan.

## Validation

`npx tsx tools/check-brazier.ts` checks actual Builder output at 12 placements:
world and rotated site frames, multiple coordinates, and a raised fixed floor.
Every fuel vertex must remain below the rim and inside a conservative inscribed
cavity. It also verifies that there is only one fuel part, centered flame/light
positions, tripod feet at the common base, and restoration of the caller's floor.

`python tools/capture-brazier.py` compares published 08079e6 geometry/materials
against the replacement from identical cameras, lighting and time. Run Vite on
port5423. Captures include the tripod, close side, top and active fire. These are
isolated production-material renders, not town or iPhone performance captures.

The fire capture includes the actual point-light intensity conversion in
main.ts. Brazier point-light intensity is reduced to 35% of its old value to
avoid bleaching nearby dark iron and charcoal; flame emission remains intact.
`flame-flow.mp4` samples the live shader over 16 frames at 12 frames per second;
its uTime advances rather than repeating one still.

An initial baseline audit failed because cloning Three's material omitted its
MAT define. That failed capture was rejected and the harness repaired before
final evidence was recorded.

Final shallow-bed validation: all 12 placement cases pass, with at least 16.58 mm
radial clearance. There is exactly one charcoal part at every placement. The
final eight matched images have no browser/shader/texture errors. The image is
512² and the neutral normal/packed maps are 1×1; all three loaded through KTX2.
The full prop submits 452 triangles versus 284 previously (+168), and one extra
material draw. Fire geometry/draw counts are unchanged. All 16 time samples
have different adjacent frames; the final video contains the shallow bed.
