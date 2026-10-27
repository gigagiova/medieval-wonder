import * as THREE from 'three';
import { Builder } from '../builder';
import { arcadeGeo } from '../shapes';
import { lucerna } from '../lights';
import { fastTerrain } from '../displace';
import { SITES, siteToWorld } from './sites';
import { markReadable } from './readables';
import type { P2 } from './geo';

// A compact reuse of masonry chambers, inspired by the Triggio burial evidence.
// The footprint, access and AD 700 use are authored reconstruction (see HISTORY).
// Local +x goes under existing lot 965; the stair follows its west street facade.
export const TRIGGIO_BURIALS = {
  stairX: -1.25, stairWidth: 1.6, top: -5.2, bottom: 2.0, floor: -5.2,
  hole: { x0: -2.12, x1: -0.38, z0: -5.35, z1: 3.45 },
  entry: { x: -1.25, z: -6.4 },
  chamber: { x: 4.5, z: 1.85 },
} as const;

export function triggioBurialHole(): P2[] {
  const h = TRIGGIO_BURIALS.hole;
  return [[h.x0, h.z0], [h.x1, h.z0], [h.x1, h.z1], [h.x0, h.z1]];
}

/** One horizontal masonry datum; the stair mouth meets the original terrain. */
export function triggioBurialDatum() {
  const C = TRIGGIO_BURIALS;
  const [x, z] = siteToWorld(SITES.triggioBurials, C.stairX, C.top);
  return fastTerrain(x, z);
}

export function buildTriggioBurials(b: Builder) {
  const C = TRIGGIO_BURIALS, floor = C.floor, datum = triggioBurialDatum();
  const savedDatum = b.absY;
  b.absY = datum;
  try {
    // Twenty-six shallow treads; collision uses a smooth ramp, as elsewhere.
    const n = 26, run = (C.top - C.bottom) / n;
    for (let i = 0; i < n; i++) {
      const y = floor * (i + 1) / n;
      b.box('block', C.stairWidth, 0.24, Math.abs(run) + 0.04, C.stairX, y - 0.24,
        C.top - (i + 0.5) * run, 0, false);
    }
    const left = C.stairX - C.stairWidth / 2, right = C.stairX + C.stairWidth / 2;
    const ramp = new THREE.BufferGeometry();
    ramp.setAttribute('position', new THREE.Float32BufferAttribute([
      left, 0.04, C.top - 0.2, right, 0.04, C.top - 0.2, right, floor + 0.04, C.bottom,
      left, 0.04, C.top - 0.2, right, floor + 0.04, C.bottom, left, floor + 0.04, C.bottom,
    ], 3));
    // Reversed descent: keep the ramp's upward-facing triangle winding.
    const rp = ramp.attributes.position;
    for (let i = 0; i < rp.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(rp, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(rp, i + 2);
      rp.setXYZ(i + 1, c.x, c.y, c.z); rp.setXYZ(i + 2, a.x, a.y, a.z);
    }
    b.collide(ramp); ramp.dispose();

    // Retaining walls occupy only the facade-side portion of the 4.5 m lane.
    b.box('rubble', 0.35, 5.85, 9.05, -2.28, floor - 0.2, -1.0);
    b.box('rubble', 0.35, 5.85, 6.55, -0.22, floor - 0.2, -2.25);
    b.box('rubble', 3.85, 5.85, 0.35, -0.35, floor - 0.2, 3.5);
    // Continuous closed floor under stairs, entry bay and burial chamber.
    b.box('rubble', 10.9, 0.45, 6.95, 2.95, floor - 0.45, 0.1);
    // Roof over the short sideways entry, not over the descending head space.
    b.box('brick', 1.55, 0.45, 2.55, 0.55, floor + 2.55, 2.25);
    b.box('rubble', 1.55, 2.65, 0.35, 0.55, floor, 0.85);

    // Reused barrel-vaulted room. Longitudinal sections avoid over-tessellation.
    const profile = arcadeGeo(6.6, 4.6, 6.9, 1, 5.6, 1.3);
    const vault = new THREE.ExtrudeGeometry(profile.parameters.shapes, {
      depth: 6.9, steps: 10, bevelEnabled: false, curveSegments: 12,
    }).translate(0, 0, -6.9 / 2);
    profile.dispose();
    b.geo('brick', vault, 4.5, floor, 0, Math.PI / 2, true, 0, 0, true);
    vault.dispose();
    // Close the end walls, retaining a 1.6 m doorway from the entry bay.
    b.box('rubble', 0.5, 4.6, 6.6, 8.15, floor, 0);
    b.box('rubble', 0.5, 4.6, 4.5, 0.85, floor, -1.05);
    b.box('rubble', 0.5, 2.4, 1.6, 0.85, floor + 2.2, 2.0);

    // Individual stone cists with low covers, never stacked loculi/skull shelves.
    for (const z of [0.25, -1.6]) for (const x of [2.5, 4.7, 6.9]) {
      b.box('stone', 1.86, 0.18, 0.86, x, floor + 0.02, z);
      b.box('slab', 1.78, 0.12, 0.78, x, floor + 0.20, z);
    }
    for (const [x, length] of [[2.18, 0.17], [2.39, 0.12], [2.57, 0.19]])
      b.box('iron', 0.012, 0.003, length, x, floor + 0.322, 0.25, 0, false);
    // A small ceramic vessel; restrained grave furnishing rather than treasure.
    b.geo('clay', new THREE.CylinderGeometry(0.06, 0.09, 0.17, 10),
      2.0, floor + 0.40, 0.25, 0, false);
    b.box('stone', 0.42, 0.12, 0.38, -1.98, -1.82, -3.4, 0, false);
    b.box('stone', 0.42, 0.12, 0.38, -1.98, floor + 0.98, 2.9, 0, false);
    b.box('stone', 0.42, 0.12, 0.38, 1.4, floor + 0.88, -2.6, 0, false);
    b.box('stone', 0.42, 0.12, 0.38, 7.6, floor + 0.88, 2.6, 0, false);
    lucerna(b, -1.82, -1.7, -3.4, Math.PI / 2, false);
    lucerna(b, -1.8, floor + 1.1, 2.9, Math.PI / 2, true);
    lucerna(b, 1.4, floor + 1.0, -2.6, 0, true);
    lucerna(b, 7.6, floor + 1.0, 2.6, Math.PI, true);
    markReadable('triggioBurials', 2.3, floor + 0.8, 0.8, datum);
  } finally {
    b.absY = savedDatum;
  }
}
