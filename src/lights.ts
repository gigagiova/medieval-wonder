import * as THREE from 'three';
import type { Builder } from './builder';
import { field, fastTerrain, toWorldXZ } from './displace';

// Period light sources (Lombard Italy, 6th-8th c.): pitch torches, iron
// braziers, Roman-type horn lanterns, clay lucernae, bronze polykandela with
// glass oil cups, beeswax candles. No street lighting existed.
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Iron ring sconce with a pitch torch, pointing outward along ry. */
export function torch(b: Builder, x: number, y: number, z: number, ry: number, under = false) {
  const ox = Math.sin(ry), oz = Math.cos(ry);
  b.box('iron', 0.05, 0.05, 0.3, x + ox * 0.12, y - 0.35, z + oz * 0.12, ry, false);
  b.geo('iron', new THREE.TorusGeometry(0.07, 0.015, 5, 10), x + ox * 0.25, y - 0.32, z + oz * 0.25, ry, false, Math.PI / 2);
  b.geo('wood', new THREE.CylinderGeometry(0.03, 0.025, 0.6, 6), x + ox * 0.27, y - 0.2, z + oz * 0.27, ry, false, 0.25);
  b.geo('iron', new THREE.CylinderGeometry(0.06, 0.045, 0.16, 8), x + ox * 0.33, y + 0.06, z + oz * 0.33, ry, false, 0.25);
  b.lamp('torch', v(x + ox * 0.35, y + 0.13, z + oz * 0.35), under);
}

/** A rigid iron fire bowl: its charcoal and rim must share one placement. */
export function brazier(b: Builder, x: number, z: number, y = 0) {
  // The masonry field used to bend iron at full strength and embers at 20%.
  // Place this small assembled object once; never deform its parts separately.
  const offset = field(x, y, z, 'stone', new THREE.Vector3());
  const anchor = v(x, y, z).add(offset);
  const world = toWorldXZ(anchor.x, anchor.z, [0, 0]);
  const previousHeight = b.absY;
  b.absY = previousHeight ?? fastTerrain(world[0], world[1]);
  const add = (g: THREE.BufferGeometry, material: 'iron' | 'ember' | 'charcoal', collide = false) => {
    g.translate(anchor.x, anchor.y, anchor.z);
    b.add(g, material, undefined, collide, true, true);
    g.dispose();
  };
  try {
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3;
      const foot = v(Math.sin(a) * 0.31, 0.025, Math.cos(a) * 0.31);
      const top = v(Math.sin(a) * 0.19, 1.0, Math.cos(a) * 0.19);
      const g = new THREE.BoxGeometry(0.045, foot.distanceTo(top), 0.045);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(v(0, 1, 0), top.clone().sub(foot).normalize()));
      g.translate(...foot.add(top).multiplyScalar(0.5).toArray());
      add(g, 'iron', true);
    }
    const profile = [[0.001, 0], [0.24, 0], [0.42, 0.3], [0.44, 0.31], [0.4, 0.3], [0.22, 0.03], [0.001, 0.03]];
    add(new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 24).translate(0, 0.95, 0), 'iron', true);
    // A low recessed fuel surface. The generated texture carries charcoal detail;
    // individual low-poly blocks were more distracting than this simple bed.
    // Both radii fit inside the sloping inner bowl, not merely its rim.
    add(new THREE.CylinderGeometry(0.337, 0.20, 0.19, 32).translate(0, 1.09, 0), 'charcoal');
    // Reuse lamp/fire configuration, then align its independently sampled
    // position to this one rigid base. Preserve the lamp's configured lift.
    const lampStart = b.lamps.length, flameStart = b.flames.length;
    b.lamp('brazier', v(x, y + 1.2, z));
    if (b.flames.length > flameStart) {
      const target = v(world[0], b.absY + anchor.y + 1.2, world[1]);
      const correction = target.clone().sub(b.flames[flameStart].pos);
      b.flames[flameStart].pos.copy(target);
      if (b.lamps.length > lampStart) {
        b.lamps[lampStart].pos.add(correction);
        // A nearby bowl must stay dark iron, not clip to porcelain white.
        b.lamps[lampStart].intensity *= 0.35;
      }
    }
  } finally { b.absY = previousHeight; }
}

/**
 * Roman-type lantern: a bronze cylinder with panes of scraped horn and a domed,
 * pierced lid, hung by a chain. Dim and amber.
 */
export function hornLantern(b: Builder, x: number, y: number, z: number, under = false) {
  b.geo('bronze', new THREE.CylinderGeometry(0.1, 0.11, 0.03, 12), x, y - 0.15, z, 0, false);
  b.geo('horn', new THREE.CylinderGeometry(0.095, 0.095, 0.26, 12, 1, true), x, y, z, 0, false);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    b.box('bronze', 0.015, 0.3, 0.015, x + Math.sin(a) * 0.1, y - 0.15, z + Math.cos(a) * 0.1, 0, false);
  }
  b.geo('bronze', new THREE.SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), x, y + 0.13, z, 0, false);
  b.geo('bronze', new THREE.TorusGeometry(0.04, 0.008, 4, 10), x, y + 0.27, z, 0, false);
  b.box('iron', 0.012, 0.5, 0.012, x, y + 0.29, z, 0, false);
  b.lamp('lantern', v(x, y, z), under);
}

/** Wall bracket with a hanging horn lantern, out from the wall along ry. */
export function bracketLantern(b: Builder, x: number, y: number, z: number, ry: number) {
  const ox = Math.sin(ry), oz = Math.cos(ry);
  b.box('iron', 0.04, 0.04, 0.6, x + ox * 0.3, y + 0.8, z + oz * 0.3, ry, false);
  b.box('iron', 0.03, 0.4, 0.03, x + ox * 0.08, y + 0.42, z + oz * 0.08, ry, false, 0.6);
  hornLantern(b, x + ox * 0.55, y, z + oz * 0.55);
}

/** Clay oil lamp (lucerna): a flattened body with a nozzle and a little flame. */
export function lucerna(b: Builder, x: number, y: number, z: number, ry: number, under = false, light = true) {
  const g = new THREE.SphereGeometry(0.055, 10, 6);
  g.scale(1, 0.38, 1);
  b.geo('clay', g, x, y + 0.02, z, ry, false);
  const nx = Math.sin(ry) * 0.07, nz = Math.cos(ry) * 0.07;
  b.geo('clay', new THREE.CylinderGeometry(0.017, 0.022, 0.06, 6), x + nx * 0.7, y + 0.022, z + nz * 0.7, ry, false, Math.PI / 2);
  const fp = v(x + nx, y + 0.035, z + nz);
  if (light) b.lamp('oil', fp, under); else b.flame('oil', fp);
}

/** Polykandelon: a pierced bronze disc on three chains, holding glass oil-lamp cups. */
export function polykandelon(b: Builder, x: number, y: number, z: number, top: number, cups = 10) {
  const r = 0.55;
  b.geo('bronze', new THREE.TorusGeometry(r, 0.02, 5, 28), x, y, z, 0, false, Math.PI / 2);
  b.geo('bronze', new THREE.TorusGeometry(r * 0.45, 0.015, 5, 18), x, y, z, 0, false, Math.PI / 2);
  for (let i = 0; i < 6; i++) b.box('bronze', 0.02, 0.012, r, x + Math.sin(i * Math.PI / 3) * r / 2, y - 0.006, z + Math.cos(i * Math.PI / 3) * r / 2, i * Math.PI / 3, false);
  const hang = v(x, y + 1.2, z);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const p = v(x + Math.sin(a) * r, y, z + Math.cos(a) * r);
    const mid = p.clone().add(hang).multiplyScalar(0.5);
    const len = p.distanceTo(hang);
    const g = new THREE.BoxGeometry(0.012, len, 0.012);
    const m = new THREE.Matrix4().lookAt(p, hang, new THREE.Vector3(0, 0, 1));
    const q = new THREE.Quaternion().setFromRotationMatrix(m).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
    b.add(g, 'iron', new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)), false);
  }
  b.box('iron', 0.015, top - hang.y, 0.015, x, hang.y, z, 0, false);
  for (let i = 0; i < cups; i++) {
    const a = (i / cups) * Math.PI * 2;
    const cx = x + Math.sin(a) * r, cz = z + Math.cos(a) * r;
    b.geo('horn', new THREE.CylinderGeometry(0.045, 0.012, 0.09, 8), cx, y - 0.02, cz, 0, false);
    b.flame('oil', v(cx, y + 0.03, cz), 0.9);
  }
  b.lamp('poly', v(x, y + 0.1, z));
}

export function candle(b: Builder, x: number, y: number, z: number, h = 0.35, under = false) {
  b.geo('bronze', new THREE.CylinderGeometry(0.06, 0.09, 0.05, 10), x, y + 0.025, z, 0, false);
  b.geo('bronze', new THREE.CylinderGeometry(0.015, 0.02, h * 0.6, 6), x, y + 0.05 + h * 0.3, z, 0, false);
  b.geo('bone', new THREE.CylinderGeometry(0.022, 0.025, h * 0.4, 8), x, y + 0.05 + h * 0.6 + h * 0.2, z, 0, false);
  b.lamp('candle', v(x, y + 0.05 + h, z), under);
}
