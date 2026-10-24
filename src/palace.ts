import * as THREE from 'three';
import { Builder, rng } from './builder';
import type { MatName } from './materials';
import { shared } from './materials';
import { noiseGLSL, atmosGLSL } from './shaders';
import { displace } from './displace';
import { arcadeGeo, arcade, ruin, column, gable, leanTo, pyramidRoof, wellHead } from './shapes';
import { torch, brazier, hornLantern, bracketLantern, lucerna, candle } from './lights';
import { placeProp, commitProps, type PropId } from './props';

// The seat of the gastald, the king's man in the city: a late-Roman house
// taken over and rebuilt piecemeal. Ranges of rooms in river stone and
// reused brick around an internal courtyard that was once a peristyle;
// the great hall (sala) where pleas were heard, with a central hearth,
// faded Roman frescoes patched with plain plaster, shields and spears of
// the arimanni on pegs; a guardroom and strongroom; stables; a tiny
// oratory with an apse; and a squat tower the Lombards added at the corner.
//
// Footprint x 28..52, z -36..-10. The gate is in the front range at
// z = -10 (facing +z, towards the cross lane), x ≈ 39.6.

const rand = rng(31337);
const R = (a: number, b: number) => a + (b - a) * rand();
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Eye-level arrival spot just outside the gate, looking in. */
export const PALACE_SPOT = { x: 39.6, z: -5.6, yaw: 0 };

const Y0 = -0.3; // walls start a little below grade
const GX = 39.6; // gate axis

interface Door { u: number; w: number; s: number }

/** A straight wall from a to b with arched doorways at arc-lengths u. */
function wall(b: Builder, m: MatName, ax: number, az: number, bx: number, bz: number, h: number, t: number, doors: Door[] = []) {
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
  const ex = dx / L, ez = dz / L, ry = Math.atan2(-ez, ex);
  let u = 0;
  for (const d of [...doors].sort((p, q) => p.u - q.u)) {
    const u0 = d.u - d.w / 2 - 0.45;
    if (u0 > u + 0.05) b.box(m, u0 - u, h, t, ax + ex * (u + u0) / 2, Y0, az + ez * (u + u0) / 2, ry);
    // Doorway: the wall piece with the arch, and a brick arch ring proud of it.
    arcade(b, m, d.w + 0.9, h, t, 1, d.w, d.s, ax + ex * d.u, Y0, az + ez * d.u, ry);
    b.geo('brick', arcadeGeo(d.w + 0.55, d.s + d.w / 2 + 0.3, t + 0.12, 1, d.w, d.s), ax + ex * d.u, Y0, az + ez * d.u, ry, false, 0, 0, true);
    u = d.u + d.w / 2 + 0.45;
  }
  if (L > u + 0.05) b.box(m, L - u, h, t, ax + ex * (u + L) / 2, Y0, az + ez * (u + L) / 2, ry);
}

/** A small window: a dark recess (or shutters with firelight leaking) and a reused stone lintel. */
function win(b: Builder, x: number, y: number, z: number, ry: number, t: number, lit = false) {
  b.box(lit ? 'window' : 'iron', 0.5, 0.8, t + 0.08, x, y, z, ry, false);
  b.box('marble', 0.85, 0.16, t + 0.12, x, y + 0.8, z, ry, false);
  if (lit && rand() < 0.5) b.lamp('window', v(x + Math.sin(ry) * 0.7, y + 0.4, z + Math.cos(ry) * 0.7));
}

// ------------------------------------------------------------- custom paint

/** Matte custom material whose colour comes from `paint(uv, soot)` and which goes through the world fog. */
// Real lime plaster (scanned) under the paint: its grain, trowel marks and
// relief show through, as a fresco is painted into the wet plaster itself.
let plasterTex: { a: THREE.Texture; n: THREE.Texture } | null = null;
function plaster() {
  if (plasterTex) return plasterTex;
  const tl = new THREE.TextureLoader();
  const a = tl.load('textures/plaster_a.webp'), n = tl.load('textures/plaster_n.webp');
  a.colorSpace = THREE.SRGBColorSpace;
  for (const t of [a, n]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.55, 0.55); t.anisotropy = 4; }
  return (plasterTex = { a, n });
}

function paintMaterial(key: string, paintGLSL: string): THREE.MeshStandardMaterial {
  const P = plaster();
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: THREE.DoubleSide, normalMap: P.n });
  m.normalScale.set(1.1, 1.1);
  m.customProgramCacheKey = () => 'palace-' + key;
  if (key === 'fresco') (m as unknown as { defines: Record<string, string> }).defines = { SHOW_STONES: '' };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared, { tPlaster: { value: P.a } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float soot;\nvarying vec3 vWPos;\nvarying vec2 vPUv;\nvarying float vSoot;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n vWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\n vPUv = uv;\n vSoot = soot;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform sampler2D tPlaster;\nvarying vec3 vWPos;\nvarying vec2 vPUv;\nvarying float vSoot;\n${noiseGLSL}\n${atmosGLSL}\n${paintGLSL}`)
      .replace('#include <map_fragment>', `vec2 puv = vPUv * 0.55;
        vec3 pl = texture2D(tPlaster, puv).rgb;
        vec3 plMean = texture2D(tPlaster, puv, 7.0).rgb;
        float plL = dot(pl, vec3(0.299, 0.587, 0.114)), mL = dot(plMean, vec3(0.299, 0.587, 0.114));
        // The paint lies in the plaster: its grain modulates the colour; where the
        // render has fallen away the stones of the wall show through, unpainted.
        vec3 painted = paint(vPUv, vSoot) * clamp(1.0 + 2.2 * (plL - mL), 0.55, 1.4);
        #ifdef SHOW_STONES
          float stone = smoothstep(0.07, 0.15, length(pl - plMean)) * step(plL, mL);
          painted = mix(painted, pl * 1.1 * (1.0 - vSoot * 0.6), stone * 0.85);
        #endif
        diffuseColor.rgb *= painted;`)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n reflectedLight.directSpecular *= 0.2;\n reflectedLight.indirectSpecular *= 0.2;')
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWPos);');
  };
  return m;
}

// Late-Roman wall painting in a reused room: a dado of painted fake marble,
// a main zone of red and ochre panels framed with fine lines and slender
// candelabra, a green frieze with a running garland. Faded, flaked to the
// plaster, patched with plain lime by later hands, blackened by the hearth.
const FRESCO = /* glsl */ `
vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }
vec3 paint(vec2 uv, float soot){
  float y = uv.y;
  float n = fbm(vec3(uv*2.5, 1.));
  vec3 plaster = vec3(0.6,0.55,0.47);
  vec3 col;
  if (y < 1.0) {
    // Dado: fake giallo antico / pavonazzetto slabs in dark red frames.
    float px = fract(uv.x/1.45 + 0.13);
    float vein = smoothstep(0.03, 0.0, abs(fbm(vec3(uv*vec2(1.6,3.1), 5.)) - 0.5 + 0.1*sin(uv.x*3.+uv.y*7.)));
    vec3 slab = mix(vec3(0.7,0.58,0.36), vec3(0.62,0.5,0.46), step(0.5, fract(uv.x/2.9)));
    slab = mix(slab, vec3(0.42,0.18,0.15), vein*0.7);
    float frame = step(px, 0.035) + step(0.965, px) + step(y, 0.06) + step(0.94, y);
    col = mix(slab, vec3(0.35,0.08,0.06), clamp(frame,0.,1.));
  } else if (y < 3.15) {
    // Main zone: wide red panels and narrow ochre interpanels with candelabra.
    float cyc = 2.75, x = mod(uv.x + 0.4, cyc);
    bool narrow = x > 2.05;
    float lx = narrow ? (x - 2.05)/0.7 : x/2.05;
    float ly = (y - 1.0)/2.15;
    vec3 base = narrow ? vec3(0.66,0.47,0.2) : vec3(0.5,0.12,0.08);
    col = base;
    // Inner frame: a fine white line inset, a black border.
    float ix = min(lx, 1.-lx) * (narrow ? 0.7 : 2.05), iy = min(ly, 1.-ly) * 2.15;
    float inset = min(ix, iy);
    col = mix(col, vec3(0.08,0.05,0.04), smoothstep(0.035, 0.02, inset));
    col = mix(col, vec3(0.86,0.8,0.68), smoothstep(0.012, 0.0, abs(inset - 0.16)));
    if (narrow) {
      // A slender candelabrum: stem, little calyxes, a tendril.
      float stem = smoothstep(0.03, 0.0, abs(lx - 0.5) * 0.7);
      float buds = smoothstep(0.07, 0.0, length(vec2((lx - 0.5)*0.7, mod(ly, 0.22) - 0.11)) - 0.035);
      col = mix(col, vec3(0.25,0.12,0.06), max(stem, buds) * step(0.08, ly) * step(ly, 0.92));
    } else {
      // A faint floating figure-ghost in the middle of some panels: lost to time.
      float id = floor((uv.x + 0.4)/cyc);
      float ghost = smoothstep(0.32, 0.0, length(vec2(lx - 0.5, (ly - 0.5)*1.6))) * step(0.5, fract(id*0.618));
      col = mix(col, vec3(0.7,0.55,0.4), ghost * 0.35 * smoothstep(0.4, 0.7, fbm(vec3(uv*6., id))));
    }
  } else {
    // Frieze: green ground, an ochre garland that rises and falls.
    float gy = (y - 3.15);
    col = vec3(0.24,0.33,0.22);
    float wave = 0.32 + 0.16*sin(uv.x*2.4);
    col = mix(col, vec3(0.7,0.55,0.25), smoothstep(0.05, 0.0, abs(gy - wave)));
    col = mix(col, vec3(0.5,0.1,0.07), smoothstep(0.05, 0.0, length(vec2(mod(uv.x, 1.31) - 0.65, gy - wave)) - 0.02));
    col = mix(col, vec3(0.08,0.05,0.04), step(gy, 0.04));
  }
  col = srgb(col);
  // Faded towards the plaster, uneven.
  col = mix(srgb(plaster), col, 0.4 + 0.25*n);
  // Losses: flaked down to the arriccio, ragged edges.
  float loss = smoothstep(0.64, 0.67, fbm(vec3(uv*1.3, 9.)) + 0.14*fbm(vec3(uv*9., 2.)));
  col = mix(col, srgb(vec3(0.55,0.5,0.43))*(0.8+0.3*fbm(vec3(uv*9.,3.))), loss*0.85);
  // Later patches of plain lime, cruder.
  float patchP = smoothstep(0.69, 0.71, fbm(vec3(uv*0.33 + 3., 4.)));
  col = mix(col, srgb(vec3(0.63,0.6,0.53))*(0.85+0.2*n), patchP);
  // Damp at the foot, streaks, soot.
  col *= 0.6 + 0.4*smoothstep(0.0, 0.9, y);
  col *= 0.85 + 0.15*vnoise(vec3(uv.x*4., uv.y*0.3, 7.));
  col *= 1. - clamp(soot*(0.75 + 0.35*n), 0., 0.92);
  return col;
}
`;

// A tablet-woven wall hanging: madder red with bands of weld yellow and
// woad blue, lozenges, worn and dusty.
const TEXTILE = /* glsl */ `
vec3 srgb(vec3 c){ return pow(c, vec3(2.2)); }
vec3 paint(vec2 uv, float soot){
  vec3 col = vec3(0.42,0.09,0.07);
  float y = uv.y;
  float band = step(0.08, mod(y, 0.3)) * step(mod(y, 0.3), 0.15);
  float loz = smoothstep(0.02, 0.0, abs(abs(fract(uv.x*6.)-0.5) + abs(fract(y*20.)-0.5) - 0.32));
  col = mix(col, vec3(0.65,0.5,0.16), band);
  col = mix(col, vec3(0.16,0.2,0.32), band * loz);
  col = mix(col, vec3(0.1,0.05,0.04), step(fract(uv.x*60.), 0.12) * 0.25);
  col = srgb(col);
  col *= 0.65 + 0.35*fbm(vec3(uv*vec2(8.,3.), 2.));
  col *= 1. - 0.5*smoothstep(0.85, 1.0, y);
  return col;
}
`;

let frescoMat: THREE.MeshStandardMaterial | null = null;
let textileMat: THREE.MeshStandardMaterial | null = null;

/**
 * A painted plaster skin on the inside face of a wall: centre (x, z),
 * length L along the wall, from height y0 for h metres, facing direction
 * (nx, nz). UVs are in metres (u along the wall, v = height above floor).
 * Bent by the same field as the masonry so it hugs it.
 */
function fresco(scene: THREE.Scene, x: number, z: number, L: number, h: number, y0: number, nx: number, nz: number, hearth: THREE.Vector3, u0 = 0) {
  const g = new THREE.PlaneGeometry(L, h, Math.ceil(L / 0.45), Math.ceil(h / 0.45));
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * L, y0 + uv.getY(i) * h);
  g.translate(0, y0 + h / 2, 0.06);
  g.rotateY(Math.atan2(nx, nz));
  g.translate(x, 0, z);
  // Soot from the hearth, and smoke pooling under the roof.
  const p = g.attributes.position as THREE.BufferAttribute;
  const soot = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const d = Math.hypot(p.getX(i) - hearth.x, p.getZ(i) - hearth.z);
    const hy = p.getY(i);
    soot[i] = Math.max(0, 1 - d / 7.5) * THREE.MathUtils.smoothstep(hy, 0.8, 4.5) * 0.6 + THREE.MathUtils.smoothstep(hy, 3.6, 6.0) * 0.5;
  }
  g.setAttribute('soot', new THREE.BufferAttribute(soot, 1));
  displace(g, 'plaster');
  frescoMat ??= paintMaterial('fresco', FRESCO);
  const mesh = new THREE.Mesh(g, frescoMat);
  scene.add(mesh);
}

/** A woven hanging from a rod, sagging and folded, a hand's breadth off the wall. */
function hanging(b: Builder, scene: THREE.Scene, x: number, z: number, w: number, h: number, top: number, nx: number, nz: number) {
  const g = new THREE.PlaneGeometry(w, h, 24, 12);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / w + 0.5, vv = 0.5 - p.getY(i) / h;
    p.setZ(i, 0.05 * Math.sin(u * Math.PI * 9 + 0.6) * (0.4 + vv) + 0.06 * Math.sin(Math.PI * u) * vv);
  }
  g.setAttribute('soot', new THREE.BufferAttribute(new Float32Array(p.count), 1));
  g.translate(0, top - h / 2, 0.18);
  g.rotateY(Math.atan2(nx, nz));
  g.translate(x, 0, z);
  displace(g, 'plaster');
  textileMat ??= paintMaterial('textile', TEXTILE);
  scene.add(new THREE.Mesh(g, textileMat));
  b.box('wood', w + 0.3, 0.06, 0.06, x + nx * 0.2, top + 0.02, z + nz * 0.2, Math.atan2(nx, nz), false);
}

// ------------------------------------------------------------- furniture

/** Round Lombard shield (lime-wood boards, iron boss), hung on a peg against a wall facing (nx,nz). */
function shield(b: Builder, x: number, y: number, z: number, nx: number, nz: number, r: number) {
  const ry = Math.atan2(nx, nz);
  b.geo('wood', new THREE.CylinderGeometry(r, r, 0.04, 20), x + nx * 0.06, y, z + nz * 0.06, ry, false, Math.PI / 2);
  b.geo('iron', new THREE.SphereGeometry(r * 0.24, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), x + nx * 0.08, y, z + nz * 0.08, ry, false, Math.PI / 2);
  b.geo('iron', new THREE.TorusGeometry(r, 0.015, 4, 24), x + nx * 0.06, y, z + nz * 0.06, ry, false);
}

/** A spear leaning against a wall: ash shaft and a long leaf-shaped iron head. */
function spear(b: Builder, x: number, z: number, lean: number, ry: number) {
  const L = R(2.3, 2.7);
  const g = new THREE.CylinderGeometry(0.018, 0.022, L, 6);
  g.translate(0, L / 2, 0);
  b.geo('wood', g, x, 0, z, ry, false, lean);
  const hd = new THREE.ConeGeometry(0.035, 0.38, 4);
  hd.scale(1, 1, 0.35);
  hd.translate(0, L + 0.19, 0);
  b.geo('iron', hd, x, 0, z, ry, false, lean);
}

/** A scanned prop, or (if the scans are not loaded) nothing: returns success. */
function prop(b: Builder, id: PropId, x: number, y: number, z: number, ry: number, s = 1, collide = false, stretch?: [number, number, number], tilt?: [number, number]) {
  return placeProp(null, id, x, y, z, ry, s, { collide: collide ? b : undefined, stretch, tilt }) !== null;
}

function bench(b: Builder, x: number, z: number, len: number, ry: number) {
  // A plain old plank bench (scan), stretched to the wall's length.
  if (prop(b, 'WoodenTable_01', x, 0, z, ry, 1, true, [len / 1.8, 0.85, 0.62])) return;
  b.box('wood', len, 0.08, 0.38, x, 0.4, z, ry, false);
  const ex = Math.cos(ry), ez = -Math.sin(ry);
  for (const s of [-0.42, 0.42]) b.box('wood', 0.08, 0.42, 0.32, x + ex * s * len, 0, z + ez * s * len, ry);
}

/** An iron-bound chest. */
function chest(b: Builder, x: number, z: number, ry: number, w = 1.1) {
  if (prop(b, 'treasure_chest', x, 0, z, ry, w / 0.96, true)) return;
  b.box('wood', w, 0.62, 0.62, x, 0, z, ry);
  for (const s of [-0.32, 0, 0.32]) b.box('iron', 0.05, 0.66, 0.66, x + Math.cos(ry) * s * w, 0, z - Math.sin(ry) * s * w, ry, false);
}

// ------------------------------------------------------------- the palace

export function buildPalace(b: Builder, scene: THREE.Scene): void {
  const T = 0.75; // outer wall thickness
  const t = 0.55; // inner walls
  const hearth = v(39.3, 0, -32.6);

  // Outer walls. Front (gate), irregular and slightly bent.
  const frontH = 7.2;
  wall(b, 'rubble', 28.2, -10.75, 46.9, -10.35, frontH, T, [{ u: GX - 28.2, w: 3.0, s: 2.9 }]);
  // A reused brick frame round the gate and a marble slab over it (a Roman inscription, upside down).
  b.geo('brick', arcadeGeo(4.6, 5.1, T + 0.3, 1, 3.0, 2.9), GX, Y0, -10.5, 0.021);
  b.box('marble', 1.6, 0.5, 0.12, GX - 0.2, 5.3, -10.1, 0.02, false, 0, Math.PI);
  // West outer wall, back wall, east outer wall.
  wall(b, 'rubble', 28.5, -10.4, 28.2, -36.0, 6.2, T);
  wall(b, 'brick', 28.0, -35.75, 50.95, -35.35, 7.4, T);
  wall(b, 'rubble', 50.75, -35.6, 50.55, -16.2, 5.9, T, [{ u: -22.75 + 35.6, w: 2.4, s: 2.2 }]);

  // ---- Front range: stables (west), the gate passage, a storeroom (east).
  const fz = -16.35;
  wall(b, 'rubble', 28.5, fz, 46.7, fz, 6.6, t, [
    { u: 32.4 - 28.5, w: 2.3, s: 2.2 },
    { u: GX - 28.5, w: 3.0, s: 2.9 },
    { u: 44.4 - 28.5, w: 1.1, s: 1.9 },
  ]);
  wall(b, 'rubble', 37.65, -10.5, 37.65, fz, 6.5, t);
  wall(b, 'rubble', 41.55, -10.5, 41.55, fz, 6.5, t);
  gable(b, 18.9, 6.6, 1.25, 37.55, frontH - 0.4, -13.45, 0.015, 'rubble', 0.55);
  // Gate leaves: one shut, one swung back against the passage wall; iron straps.
  b.box('wood', 1.5, 2.95, 0.12, GX - 0.76, -0.1, -10.95, 0.02);
  for (const y of [0.4, 1.4, 2.4]) b.box('iron', 1.46, 0.07, 0.15, GX - 0.76, y, -10.95, 0.02, false);
  b.box('wood', 0.12, 2.95, 1.5, 41.12, -0.1, -11.85, 0.08);
  for (const y of [0.4, 1.4, 2.4]) b.box('iron', 0.15, 0.07, 1.46, 41.1, y, -11.85, 0.08, false);
  // Torches either side of the gate, outside; a horn lantern inside the passage.
  torch(b, GX - 2.4, 2.9, -10.15, 0);
  torch(b, GX + 2.35, 2.9, -10.05, 0);
  hornLantern(b, GX + 0.2, 3.4, -13.3);
  // Front windows, upper floor, irregular.
  for (const [x, lit] of [[30.6, false], [34.9, true], [44.1, false], [45.6, true]] as const) win(b, x, 4.4 + R(-0.2, 0.25), -10.55, 0.02, T, lit);
  // Stables: stall partitions, a manger, straw, a cart wheel against the wall.
  for (const x of [30.4, 32.4 + 1.7, 35.8]) b.box('wood', 0.08, 1.4, 2.6, x, -0.1, -12.3, 0.03 * (x - 32));
  b.box('wood', 6.6, 0.55, 0.55, 33.0, 0.5, -11.45, 0.01);
  b.geo('ground', new THREE.SphereGeometry(1.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 29.8, -0.2, -14.6, 0, false);
  b.geo('wood', new THREE.TorusGeometry(0.62, 0.05, 5, 16), 36.6, 0.66, -15.95, 0.2, false, 0.1);
  for (let i = 0; i < 8; i++) b.box('wood', 0.04, 1.2, 0.04, 36.6, 0.06, -15.95, 0.2, false, 0, (i / 8) * Math.PI);
  // Tubs, buckets, a basket of feed.
  prop(b, 'wooden_bucket_02', 31.2, 0, -14.9, 0.4, 1, true);
  prop(b, 'wooden_bucket_01', 32.0, 0, -15.4, 1.2, 1, true);
  prop(b, 'wooden_bucket_01', 34.6, 0, -12.0, 2.1, 0.95, false, undefined, [0.25, 1.2]);
  prop(b, 'wicker_basket_02', 35.2, 0, -15.6, 0.7, 1.6, true);
  prop(b, 'wooden_axe_02', 29.1, 0, -11.7, 1.4, 1, false, undefined, [0.25, 0]);
  prop(b, 'cross_pein_hammer', 33.4, 0.95, -11.42, 0.2, 1, false, undefined, [Math.PI / 2, 0]);
  bracketLantern(b, 33.9, 2.2, fz - 0.28, Math.PI);
  // Storeroom: jars (dolia), sacks, a beam fallen from the loft.
  const jars: [number, number][] = [[42.6, -15.2], [43.5, -15.4], [44.6, -15.1], [42.5, -12.0], [45.6, -11.6], [45.7, -14.2]];
  jars.forEach(([x, z], i) => {
    const ok = i % 2
      ? prop(b, 'ceramic_pot', x, 0, z, R(0, 6), R(1.3, 1.6), true)
      : prop(b, 'wine_barrel_01', x, 0, z, R(0, 6), R(0.8, 0.95), true);
    if (!ok) {
      b.geo('clay', new THREE.CylinderGeometry(0.28, 0.2, 0.8, 12), x, 0.38, z);
      b.geo('clay', new THREE.SphereGeometry(0.31, 12, 8), x, 0.6, z, 0, false);
    }
  });
  prop(b, 'wine_barrel_01', 43.4, 0, -11.4, 0.2, 0.8, true, undefined, [Math.PI / 2, 0]);
  prop(b, 'wicker_basket_02', 44.9, 0, -12.9, 2.0, 1.5, true);
  prop(b, 'planter_pot_clay', 42.4, 0, -13.6, 0.5, 1.9);
  prop(b, 'planter_pot_clay', 42.9, 0, -13.2, 2.4, 1.6, false, undefined, [1.4, 0.2]);
  b.box('wood', 0.22, 0.22, 4.2, 43.7, 0.3, -13.4, 0.5, false, 0.3);

  // ---- The tower: a squat Lombard addition at the front-east corner.
  const tx0 = 46.6, tx1 = 51.9, tz0 = -16.5, tz1 = -10.1, tH = 12.5;
  wall(b, 'rubble', tx0, tz1, tx1, tz1 + 0.05, tH, 1.0);
  wall(b, 'rubble', tx1, tz1, tx1 - 0.1, tz0, tH, 1.0);
  wall(b, 'rubble', tx0, tz1, tx0, tz0, tH, 1.0);
  wall(b, 'rubble', tx0, tz0, tx1, tz0, tH, 1.0, [{ u: 2.4, w: 1.15, s: 1.85 }]);
  pyramidRoof(b, 6.6, 1.9, (tx0 + tx1) / 2, tH - 0.4, (tz0 + tz1) / 2);
  for (const [x, y, z, ry] of [[49.2, 6.0, tz1, 0], [tx1, 8.4, -13.0, Math.PI / 2], [48.0, 10.2, tz1, 0], [tx1, 4.2, -14.2, Math.PI / 2]] as const) {
    b.box('iron', 0.22, 0.9, 1.1, x, y, z, ry, false);
  }
  // Inside the tower base: a ladder to the trapdoor, barrels, a rack of spears.
  b.box('wood', 0.06, 4.6, 0.06, 47.6, -0.1, -11.5, 0, false, 0.18);
  b.box('wood', 0.06, 4.6, 0.06, 48.1, -0.1, -11.5, 0, false, 0.18);
  for (let r = 0; r < 12; r++) b.box('wood', 0.56, 0.04, 0.04, 47.85, 0.25 + r * 0.36, -11.5 + r * 0.065, 0, false);
  for (let i = 0; i < 3; i++) {
    if (!prop(b, 'wine_barrel_01', 50.4 - i * 0.78, 0, -14.9 + (i % 2) * 0.3, R(0, 6), 0.9, true)) {
      b.geo('wood', new THREE.CylinderGeometry(0.33, 0.33, 0.85, 12), 50.4 - i * 0.75, 0.12, -14.9 + (i % 2) * 0.3);
    }
  }
  for (let i = 0; i < 4; i++) spear(b, 51.1, -11.9 + i * 0.32, -0.12, Math.PI / 2);
  lucerna(b, 49.6, 0.95, -15.2, 0);

  // ---- East range: a vestibule to the tower, the oratory, a store.
  const ex = 46.6;
  wall(b, 'rubble', ex, fz + 0.05, ex, -29.45, 5.9, t, [{ u: 1.4, w: 1.1, s: 1.9 }, { u: fz + 22.7, w: 1.3, s: 2.1 }]);
  wall(b, 'rubble', ex, -19.3, 50.6, -19.35, 5.8, t);
  wall(b, 'rubble', ex, -26.2, 50.6, -26.1, 5.8, t, [{ u: 2.0, w: 1.0, s: 1.8 }]);
  gable(b, 19.6, 4.6, 1.1, 48.6, 5.5, -25.9, Math.PI / 2 + 0.01, 'rubble', 0.5);
  // Oratory: tiny, a semicircular apse in the east wall, an altar of a reused
  // Roman altar-stone, frescoed apse.
  const ox = 50.55, oz = -22.75, ar = 1.25;
  for (let i = 0; i <= 7; i++) {
    const a = (i / 7) * Math.PI;
    b.box('brick', 0.62, 3.9, 0.55, ox + Math.sin(a) * (ar + 0.25), Y0, oz + Math.cos(a) * (ar + 0.25), a);
  }
  b.geo('roof', new THREE.ConeGeometry(ar + 0.65, 1.0, 12, 1, false, 0, Math.PI), ox, 3.6 + 0.5, oz, 0, false);
  b.box('marble', 0.7, 1.0, 0.95, ox - 0.35, Y0, oz, 0.04);
  candle(b, ox - 0.4, 0.7, oz - 0.3, 0.38);
  candle(b, ox - 0.35, 0.7, oz + 0.28, 0.33);
  lucerna(b, ox - 0.25, 0.7, oz + 0.05, -Math.PI / 2, false, false);
  b.box('wood', 0.06, 1.3, 0.06, ox + 0.25, 0.65, oz, 0, false);
  b.box('wood', 0.06, 0.06, 0.6, ox + 0.25, 1.65, oz, 0, false);
  bench(b, 47.6, -24.6, 1.6, Math.PI / 2);
  b.box('slab', 3.9, 0.06, 6.6, 48.6, -0.25, -22.75, 0, false);
  // Store at the back of the east range: amphorae lying in sand.
  prop(b, 'ceramic_pot', 49.6, 0, -28.3, 0.3, 1.4, true);
  prop(b, 'wooden_bucket_01', 47.4, 0, -27.9, 1.0, 1);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.CylinderGeometry(0.16, 0.05, 1.0, 10);
    b.geo('clay', g, 48.6 + R(-1, 1), 0.18, -27.8 + R(-0.8, 0.8), R(0, 3), false, 0, Math.PI / 2 + R(-0.2, 0.2));
  }

  // ---- West range: guardroom and strongroom.
  const wx = 33.2;
  wall(b, 'rubble', wx, fz - 0.05, wx, -29.45, 5.8, t, [{ u: fz + 21.0, w: 1.2, s: 2.0 }]);
  wall(b, 'rubble', 28.5, -24.2, wx, -24.1, 5.6, t, [{ u: 2.6, w: 0.95, s: 1.8 }]);
  gable(b, 13.6, 5.2, 1.1, 30.75, 5.4, -22.9, Math.PI / 2 - 0.012, 'rubble', 0.5);
  // Guardroom: a table, benches, spears racked, shields on the wall, a brazier.
  if (!prop(b, 'WoodenTable_01', 30.6, 0, -20.0, 0.1, 1, true, [1.05, 1.42, 1.25])) {
    b.box('wood', 1.9, 0.07, 0.85, 30.6, 0.78, -20.0, 0.1, false);
    for (const s of [-0.75, 0.75]) b.box('wood', 0.1, 0.78, 0.7, 30.6 + s, 0, -20.0, 0.1);
  }
  prop(b, 'wooden_bowl_01', 30.2, 0.79, -19.9, 0.4);
  prop(b, 'carved_wooden_plate', 31.1, 0.79, -20.2, 1.1);
  prop(b, 'folding_wooden_stool', 31.3, 0, -21.0, 0.5, 1, true);
  prop(b, 'wooden_axe', 29.1, 0, -21.6, Math.PI / 2, 1, false, undefined, [0.22, 0]);
  bench(b, 30.5, -19.0, 1.8, 0.1);
  for (let i = 0; i < 5; i++) spear(b, 29.05, -17.4 - i * 0.35, 0.1, Math.PI / 2);
  for (let i = 0; i < 3; i++) shield(b, 28.85, 2.1, -18.4 - i * 1.6, 1, 0, R(0.38, 0.44));
  lucerna(b, 30.9, 0.86, -20.15, 0.4);
  // Strongroom: iron-bound chests, a heavy door.
  chest(b, 29.8, -26.3, 0.05);
  chest(b, 31.6, -27.6, -0.4, 0.9);
  chest(b, 29.9, -28.4, 0.1, 1.2);
  b.box('wood', 0.95, 2.0, 0.1, 31.0, -0.1, -24.42, 0.02);
  for (const y of [0.3, 1.0, 1.7]) b.box('iron', 0.9, 0.06, 0.13, 31.0, y, -24.42, 0.02, false);

  // ---- The great hall (sala), across the back of the courtyard.
  const hz = -29.45;
  wall(b, 'rubble', 32.9, hz, 46.95, hz, 7.0, T, [{ u: 40.1 - 32.9, w: 1.9, s: 2.4 }, { u: 35.3 - 32.9, w: 1.05, s: 1.9 }]);
  wall(b, 'brick', wx, hz - 0.1, wx, -35.6, 7.0, t);
  wall(b, 'rubble', 46.6, hz - 0.1, 46.6, -35.6, 7.0, t);
  gable(b, 14.3, 7.2, 1.7, 39.9, 6.6, -32.5, 0.012, 'rubble', 0.6);
  // Open timber roof: tie beams, king posts, a ridge piece.
  for (let x = 34.6; x < 46; x += R(2.1, 2.5)) {
    b.box('wood', 0.26, 0.3, 6.6, x, 6.3, -32.5, R(-0.03, 0.03), false);
    b.box('wood', 0.2, 1.55, 0.2, x, 6.6, -32.5, 0, false);
  }
  b.box('wood', 13.4, 0.22, 0.22, 39.9, 8.05, -32.5, 0.012, false);
  // Floor: big reused slabs, worn, a few missing.
  for (let x = 33.8; x < 46.4; x += R(0.9, 1.4)) for (let z = -35.1; z < -29.9; z += R(0.8, 1.3)) {
    if (rand() < 0.08 || Math.hypot(x - hearth.x, z - hearth.z) < 1.1) continue;
    b.box('slab', R(0.8, 1.3), 0.08, R(0.7, 1.2), x + 0.5, -0.06, z + 0.45, R(-0.06, 0.06), false);
  }
  // Central hearth: a ring of stones round the embers, smoke going up to the roof.
  if (!prop(b, 'stone_fire_pit', hearth.x, -0.06, hearth.z, 0.4, 1.25, false)) {
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      b.box('stone', R(0.3, 0.42), R(0.18, 0.26), 0.3, hearth.x + Math.sin(a) * 0.85, -0.05, hearth.z + Math.cos(a) * 0.72, a);
    }
  }
  // Firewood stacked by the hearth, a pot warming at its edge.
  prop(b, 'dead_tree_trunk', hearth.x - 1.6, 0, hearth.z + 0.9, 0.3, 0.38);
  prop(b, 'dead_tree_trunk', hearth.x - 1.5, 0.1, hearth.z + 1.05, 0.25, 0.36);
  prop(b, 'dead_tree_trunk', hearth.x - 1.65, 0.18, hearth.z + 0.95, 0.35, 0.34);
  prop(b, 'ceramic_pot', hearth.x + 1.15, 0, hearth.z - 0.5, 1.7, 1.1);
  prop(b, 'wooden_bucket_01', hearth.x + 1.5, 0, hearth.z + 0.7, 0.6, 0.95);
  b.geo('ember', new THREE.CylinderGeometry(0.72, 0.78, 0.1, 16), hearth.x, 0.02, hearth.z, 0, false);
  b.lamp('brazier', v(hearth.x, 0.1, hearth.z));
  b.box('iron', 0.05, 1.0, 0.05, hearth.x - 0.7, 0, hearth.z, 0, false);
  b.box('iron', 0.05, 1.0, 0.05, hearth.x + 0.7, 0, hearth.z, 0, false);
  b.box('iron', 1.5, 0.05, 0.05, hearth.x, 0.98, hearth.z, 0, false);
  b.geo('bronze', new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), hearth.x + 0.05, 0.62, hearth.z, 0, false);
  // The dais and the gastald's seat at the east end, under a hanging.
  b.box('slab', 2.0, 0.38, 5.2, 45.5, -0.15, -32.5, 0.01);
  b.box('wood', 0.75, 0.08, 0.7, 45.75, 0.68, -32.5, 0, false);
  b.box('wood', 0.1, 1.45, 0.75, 46.1, 0.23, -32.5, 0, false);
  for (const s of [-0.34, 0.34]) {
    b.box('wood', 0.7, 0.07, 0.07, 45.75, 0.95, -32.5 + s, 0, false);
    b.box('wood', 0.07, 0.6, 0.07, 45.45, 0.23, -32.5 + s, 0, false);
  }
  b.geo('cloth', new THREE.BoxGeometry(0.6, 0.12, 0.62), 45.72, 0.78, -32.5, 0.04, false);
  if (!prop(b, 'WoodenTable_01', 44.6, 0.23, -31.2, 0.06, 1, true, [0.72, 1.4, 1.1])) {
    b.box('wood', 1.3, 0.06, 0.7, 44.6, 0.98, -31.2, 0.06, false);
    for (const s of [-0.5, 0.5]) b.box('wood', 0.08, 0.75, 0.6, 44.6 + s, 0.23, -31.2, 0.06);
  }
  prop(b, 'wooden_bowl_01', 44.75, 1.0, -31.05, 0.8);
  prop(b, 'wooden_cutting_board', 44.3, 1.0, -31.35, 0.2);
  prop(b, 'carved_wooden_plate', 44.95, 1.0, -31.4, 2.0);
  chest(b, 46.05, -34.2, Math.PI / 2 + 0.06, 0.95);
  candle(b, 44.3, 1.04, -31.0, 0.4);
  candle(b, 44.85, 1.04, -31.35, 0.3);
  hanging(b, scene, 46.3, -32.5, 3.4, 3.0, 4.6, -1, 0);
  // Benches along the long walls, shields and spears of the arimanni on pegs.
  bench(b, 37.5, -34.85, 4.2, 0.012);
  bench(b, 42.2, -34.8, 2.6, 0.012);
  bench(b, 37.6, -30.0, 3.0, 0.012);
  for (let i = 0; i < 6; i++) {
    const x = 34.7 + i * 1.75 + R(-0.2, 0.2);
    shield(b, x, 2.75 + R(-0.12, 0.12), -35.1, 0, 1, R(0.4, 0.47));
    b.box('wood', 0.06, 0.06, 0.25, x, 2.5, -35.05, 0, false);
  }
  for (let i = 0; i < 4; i++) spear(b, 33.62, -30.6 - i * 0.4, 0.14, Math.PI / 2);
  // A long trestle table on the far side of the hearth, set for the evening:
  // wooden bowls and trenchers, a pot, a basket, a knife board.
  if (prop(b, 'WoodenTable_01', 42.6, 0, -33.9, 0.03, 1, true, [1.25, 1.45, 1.2])) {
    const top = 0.8;
    prop(b, 'carved_wooden_plate', 41.7, top, -33.8, 0.3);
    prop(b, 'carved_wooden_plate', 42.6, top, -33.65, 1.2);
    prop(b, 'carved_wooden_plate', 43.5, top, -34.0, 2.5);
    prop(b, 'wooden_bowl_01', 42.15, top, -34.1, 0.7);
    prop(b, 'wooden_bowl_01', 43.1, top, -33.7, 2.2, 0.9);
    prop(b, 'ceramic_pot', 42.6, top, -34.15, 0.9, 0.7);
    prop(b, 'wooden_cutting_board', 41.3, top, -34.15, 0.1);
    prop(b, 'wicker_basket_02', 43.9, top, -34.1, 1.6, 1.0);
  }
  prop(b, 'folding_wooden_stool', 41.6, 0, -33.1, 0.7, 1, true);
  prop(b, 'folding_wooden_stool', 43.4, 0, -33.15, 2.9, 1, true);
  prop(b, 'wooden_bucket_02', 45.2, 0, -35.0, 0.5, 0.9, true);
  prop(b, 'wine_barrel_01', 45.4, 0, -30.3, 1.1, 0.9, true);
  prop(b, 'wine_barrel_01', 44.7, 0, -30.1, 2.3, 0.85, true);
  prop(b, 'folding_wooden_stool', 41.6, 0, -31.0, 0.7, 1, true);
  prop(b, 'folding_wooden_stool', 36.0, 0, -31.3, 2.3, 1, true);
  prop(b, 'wicker_basket_02', 34.2, 0, -34.6, 0.3, 1.5, true);
  prop(b, 'wine_barrel_01', 34.1, 0, -30.4, 1.3, 0.9, true);
  prop(b, 'wooden_axe_02', 33.75, 0, -34.0, Math.PI / 2, 1, false, undefined, [0.2, 0]);
  // Lights: lucernae on brackets along the walls, a horn lantern by the door.
  lucerna(b, 34.6, 1.9, -35.0, 0);
  lucerna(b, 41.4, 1.9, -35.0, 0);
  lucerna(b, 33.65, 1.9, -33.2, Math.PI / 2);
  hornLantern(b, 40.1, 2.7, -30.1);
  // High windows in the back wall (outside world), small and deep.
  for (const [x, lit] of [[35.6, false], [38.9, true], [43.2, false]] as const) win(b, x, 4.6, -35.55, 0.017, T, lit);
  // Frescoes on the inner faces: the reused Roman room.
  fresco(scene, 39.75, -35.17, 12.9, 5.6, 0, 0, 1, hearth);
  fresco(scene, 46.27, -32.5, 5.6, 5.6, 0, -1, 0, hearth, 3.1);
  fresco(scene, 33.53, -32.5, 5.6, 5.6, 0, 1, 0, hearth, 7.7);
  fresco(scene, 37.45, -29.82, 2.3, 5.6, 0, 0, -1, hearth, 1.2);
  fresco(scene, 43.9, -29.82, 4.8, 5.6, 0, 0, -1, hearth, 5.4);
  fresco(scene, 39.95, -29.82, 2.2, 2.9, 3.6, 0, -1, hearth, 9.4);
  // Oratory walls: the same hand, fainter.
  fresco(scene, 48.6, -26.16 + 0.3, 3.6, 3.6, 0, 0, 1, v(0, 0, 999), 2);
  fresco(scene, 48.6, -19.4 - 0.3, 3.6, 3.6, 0, 0, -1, v(0, 0, 999), 6);

  // ---- Ruined south-west room: a kitchen whose roof fell in long ago.
  ruin(b, 'rubble', 4.6, 4.2, 0.6, 30.7, Y0, -29.5, 0.01, 0.6);
  for (let i = 0; i < 3; i++) b.box('wood', 0.2, 0.2, R(3, 4.5), R(29.6, 32.3), R(0, 0.9), R(-34.5, -30.8), R(0, 3), true, R(-0.5, 0.5), R(-0.2, 0.2));
  b.geo('clay', new THREE.CylinderGeometry(0.22, 0.14, 0.7, 10), 29.4, 0.2, -34.6, 0.3, false, 1.3);
  b.geo('ground', new THREE.SphereGeometry(1.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 31.4, -0.35, -33.4, 0, true);
  for (let i = 0; i < 4; i++) prop(b, 'wooden_barrels_01', R(29.4, 32.4), 0, R(-34.6, -30.4), R(0, 6), 1, false, undefined, undefined);
  prop(b, 'rock_moss_set_02', 30.2, 0, -31.2, 0.4, 1.4);
  prop(b, 'rock_moss_set_02', 32.0, 0, -34.2, 2.2, 1.2);
  for (let i = 0; i < 6; i++) prop(b, i % 2 ? 'nettle_plant' : 'weed_plant_02', R(29.3, 32.5), 0, R(-34.8, -30.2), R(0, 6), R(2.5, 4));

  // ---- The courtyard: what is left of a peristyle.
  // Portico on reused columns along the west side and the front range.
  const cols: [number, number, number][] = [];
  for (let i = 0; i < 4; i++) cols.push([35.1 + R(-0.08, 0.08), -18.6 - i * 3.0, 0]);
  for (let i = 0; i < 3; i++) cols.push([36.8 + i * 3.1, -18.3 + R(-0.08, 0.08), 1]);
  for (const [x, z] of cols) {
    const stone = rand() < 0.4;
    const plinth = R(0, 0.45);
    if (plinth > 0.12) b.box(stone ? 'stone' : 'marble', 0.75, plinth, 0.75, x, -0.1, z, R(-0.3, 0.3));
    column(b, x, -0.1 + plinth, z, 3.3 - plinth, R(0.17, 0.23), 0, stone ? 'stone' : 'marble');
  }
  // Architraves: timber beams on the column heads.
  b.box('wood', 0.3, 0.32, 9.6, 35.1, 3.2, -23.1, 0.01, false);
  b.box('wood', 9.0, 0.32, 0.3, 40.0, 3.2, -18.3, 0.01, false);
  leanTo(b, 13.5, 2.3, 5.0, 3.55, 34.15, -22.9, Math.PI / 2);
  leanTo(b, 10.2, 2.3, 5.2, 3.55, 40.6, -17.3, Math.PI);
  // Wooden gallery on corbels along the hall front, under its own little roof.
  for (let x = 34.4; x < 46.2; x += R(1.4, 1.8)) b.box('wood', 0.2, 0.24, 1.25, x, 3.3, hz + 0.75, 0, false, 0.08);
  b.box('wood', 12.2, 0.1, 1.25, 40.2, 3.55, hz + 0.75, 0.012, false);
  for (let x = 34.6; x < 46; x += R(1.3, 1.8)) b.box('wood', 0.08, 0.95, 0.08, x, 3.6, hz + 1.3, 0, false);
  b.box('wood', 11.8, 0.08, 0.09, 40.2, 4.5, hz + 1.32, 0.012, false);
  leanTo(b, 12.4, 1.5, 6.3, 5.6, 40.2, hz + 0.85, 0);
  b.box('iron', 0.9, 1.9, 0.62, 37.8, 3.6, hz, 0, false);
  // The well: a Roman puteal, its rim grooved by ropes.
  wellHead(b, 'marble', 37.4, -0.08, -25.4, 0.85, 0.9, 'marble');
  b.box('wood', 0.13, 2.1, 0.13, 38.1, -0.1, -25.3, 0, true, 0, 0.05);
  b.box('wood', 0.13, 2.0, 0.13, 36.7, -0.1, -25.5, 0, true, 0.04);
  b.box('wood', 1.7, 0.12, 0.12, 37.4, 1.95, -25.4, 0.1, false);
  // Paving: patches of old slabs in the mud, a stone trough, a mounting block.
  for (let i = 0; i < 26; i++) {
    const x = R(35.5, 46), z = R(-29, -18.8);
    if (Math.hypot(x - 37.4, z - 25.4 + 50.8) < 1) continue;
    b.box('slab', R(0.6, 1.3), 0.07, R(0.5, 1.1), x, -0.08, z, R(0, 3), false);
  }
  b.box('stone', 1.9, 0.55, 0.6, 45.2, -0.1, -20.6, Math.PI / 2 + 0.07);
  b.box('marble', 0.7, 0.5, 0.7, 42.3, -0.1, -17.6, 0.3);
  brazier(b, 42.4, -24.0);
  prop(b, 'wooden_bucket_01', 38.4, 0, -24.6, 0.3, 1, true);
  prop(b, 'wooden_bucket_02', 36.2, 0, -26.5, 1.1, 0.9, true);
  prop(b, 'wine_barrel_01', 45.6, 0, -18.9, 0.5, 0.9, true);
  prop(b, 'wine_barrel_01', 45.9, 0, -19.8, 2.0, 0.85, true);
  prop(b, 'street_rat', 44.8, 0, -19.4, 2.4, 1.1);
  for (let i = 0; i < 8; i++) prop(b, i % 3 ? 'weed_plant_02' : 'nettle_plant', R(35.6, 46), 0, R(-28.8, -19), R(0, 6), R(2.5, 3.5));
  hornLantern(b, 35.3, 2.7, -21.6);
  hornLantern(b, 40.4, 2.7, -17.6);
  // Floors under cover.
  b.box('slab', 4.4, 0.06, 13.0, 30.8, -0.24, -22.8, 0, false);
  b.box('slab', 9.0, 0.06, 5.6, 33.0, -0.24, -13.4, 0, false);
  b.box('slab', 4.8, 0.06, 5.6, 44.1, -0.24, -13.4, 0, false);
  commitProps(scene);
}
