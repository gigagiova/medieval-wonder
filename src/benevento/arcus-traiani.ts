import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import fontData from 'three/examples/fonts/optimer_regular.typeface.json';
import { Builder } from '../builder';
import { arcadeGeo } from '../shapes';
import { brazier, torch } from '../lights';
import { markReadable } from './readables';
import type { MatName } from '../materials';
import { TRAJAN_DIMENSIONS } from './arcus-traiani-dimensions';
export { TRAJAN_DIMENSIONS } from './arcus-traiani-dimensions';

// Architectural proportions are centralized for the adjoining curtain walls.
// Local x crosses the facade; local z runs through the single passage.

/** Benevento's Arch of Trajan: pilasters and relief registers, not round columns. */
export function arcusTraiani(b: Builder) {
  const { coreWidth: W, depth: D, opening: OW, spring: SP } = TRAJAN_DIMENSIONS;
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  let panelFrame: THREE.Matrix4 | null = null;
  const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, m: MatName = 'carvedMarble', collide = false) => {
    rotation.setFromEuler(new THREE.Euler(rx, ry, rz));
    matrix.compose(new THREE.Vector3(x, y, z), rotation, new THREE.Vector3(1, 1, 1));
    if (panelFrame) matrix.premultiply(panelFrame);
    // Ashlar courses and carved orders remain straight; organic world bending
    // would turn the monument's mouldings into soft, mismatched strips.
    b.add(g, m, matrix, collide, true, true);
    g.dispose();
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, collide = false, rz = 0, ry = 0, m: MatName = 'carvedMarble') => add(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, 0, ry, rz, m, collide);
  const ellipsoid = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rz = 0) => {
    const g = new THREE.SphereGeometry(1, 6, 4); g.scale(sx, sy, sz); add(g, x, y, z, 0, 0, rz);
  };
  add(arcadeGeo(W, 10.65, D, 1, OW, SP), 0, 0, 0, 0, 0, 0, 'carvedMarble', true);

  // Panel borders sit in front of a shallow recessed field. Figures are a
  // restrained low-poly relief approximation, not a claim to copy every scene.
  const panel = (cx: number, y: number, z: number, w: number, h: number, face: number, figures = 4) => {
    box(w, h, 0.035, cx, y, z, false);
    for (const x of [cx - w / 2, cx + w / 2]) box(0.09, h + 0.12, 0.13, x, y - 0.06, z + face * 0.055);
    for (const yy of [y - 0.06, y + h]) box(w + 0.08, 0.09, 0.13, cx, yy, z + face * 0.055);
    // Narrative relief groups overlap in depth; spacing must not shrink them
    // into isolated dolls in the lower half of the architectural register.
    const scale = h / 1.72;
    for (let i = 0; i < figures; i++) {
      const x = cx + ((i + 0.5) / figures - 0.5) * (w - 0.34), yy = y + 0.07;
      const zz = z + face * (i % 2 ? 0.095 : 0.06), s = scale * (i === Math.floor(figures / 2) ? 1.0 : 0.96);
      // Draped torsos, heads, hems and separated lower legs create real shallow
      // occlusion under raking light instead of blank rectangular plaques.
      ellipsoid(x + (i % 2 ? 0.035 : -0.035) * s, yy + 1.38 * s, zz, 0.115 * s, 0.16 * s, 0.09 * s);
      const torso = new THREE.CylinderGeometry(0.17 * s, 0.25 * s, 0.82 * s, 6, 1);
      torso.scale(1, 1, 0.36); add(torso, x, yy + 0.83 * s, zz);
      ellipsoid(x - 0.025 * s, yy + 0.87 * s, zz + face * 0.06, 0.15 * s, 0.35 * s, 0.032 * s, (i % 2 ? -1 : 1) * 0.35);
      for (const side of [-1, 1]) {
        ellipsoid(x + side * 0.09 * s, yy + 0.24 * s, zz, 0.062 * s, 0.24 * s, 0.058 * s, side * 0.08);
        const raised = (i + figures) % 3 === 0 && side === 1;
        ellipsoid(x + side * 0.22 * s, yy + (raised ? 1.08 : 0.91) * s, zz + face * 0.02, 0.06 * s, 0.27 * s, 0.07 * s, raised ? -0.95 : side * (i % 2 ? 0.42 : -0.26));
      }
    }
  };

  for (const face of [-1, 1]) {
    const z = face * (D / 2 + 0.045);
    for (const side of [-1, 1]) {
      const cx = side * 4.42;
      // Broad continuous plinth below the narrative registers.
      box(3.65, 0.22, 0.5, cx, 0.04, z);
      box(3.45, 1.65, 0.32, cx, 0.26, z);
      box(3.72, 0.18, 0.56, cx, 1.91, z);
      panel(cx, 2.42, z + face * 0.08, 2.24, 2.58, face);
      panel(cx, 6.02, z + face * 0.08, 2.24, 2.65, face);
      // Narrow intermediate register aligns with the impost of the arch.
      panel(cx, 5.23, z + face * 0.08, 2.24, 0.48, face, 5);
      for (const x of [side * 2.96, side * 5.89]) {
        box(0.68, 0.16, 0.48, x, 2.08, z);
        box(0.57, 6.76, 0.25, x, 2.24, z + face * 0.06);
        // Flat fluted pilaster shafts with longitudinal arrises.
        for (const dx of [-0.20, -0.10, 0, 0.10, 0.20]) box(0.025, 6.55, 0.045, x + dx, 2.35, z + face * 0.20);
        box(0.70, 0.14, 0.40, x, 8.98, z);
        box(0.85, 0.13, 0.48, x, 9.80, z);
        // Two tiers of acanthus-shaped lobes, and corner volutes.
        for (const row of [0, 1]) for (const dx of [-0.22, 0, 0.22]) {
          ellipsoid(x + dx, 9.20 + row * 0.25, z + face * (0.20 + row * 0.025), 0.125, 0.21, 0.045, dx * 0.8);
        }
        for (const dx of [-0.30, 0.30]) ellipsoid(x + dx, 9.67, z + face * 0.25, 0.14, 0.11, 0.09);
      }
    }
    // Continuous moulded archivolt; no exaggerated independent rubble blocks.
    for (const [radius, tube, off] of [[OW / 2 + 0.08, 0.08, 0.1], [OW / 2 + 0.24, 0.09, 0.06], [OW / 2 + 0.41, 0.065, 0.02]]) {
      const g = new THREE.TorusGeometry(radius, tube, 5, 36, Math.PI);
      add(g, 0, SP, z + face * off);
    }
    for (const side of [-1, 1]) {
      box(0.48, SP, 0.17, side * (OW / 2 + 0.24), 0, z + face * 0.04);
      box(0.74, 0.17, 0.35, side * (OW / 2 + 0.28), SP - 0.16, z + face * 0.08);
      // Winged spandrel figures, subordinate to the arch's architecture.
      ellipsoid(side * 1.78, 9.18, z + face * 0.11, 0.19, 0.48, 0.09, side * 0.65);
      ellipsoid(side * 1.57, 9.65, z + face * 0.11, 0.13, 0.15, 0.10);
      ellipsoid(side * 2.05, 9.51, z + face * 0.09, 0.51, 0.16, 0.08, side * -0.5);
    }
    box(0.45, 0.58, 0.25, 0, SP + OW / 2 - 0.10, z + face * 0.10);
    // Attic: broad central inscription flanked by narrative reliefs.
    panel(-4.72, 12.21, z - face * 0.06, 2.20, 2.65, face, 3);
    panel(4.72, 12.21, z - face * 0.06, 2.20, 2.65, face, 3);
    for (const x of [-3.44, 3.44]) box(0.20, 2.78, 0.2, x, 12.15, z);
    box(6.65, 2.67, 0.06, 0, 12.23, z - face * 0.10);
    for (const y of [12.15, 14.91]) box(6.95, 0.12, 0.18, 0, y, z);
  }

  // Architrave, low processional frieze and strongly projecting cornice.
  for (const [w, h, d, y] of [[12.84, 0.22, 6.28, 9.95], [12.96, 0.18, 6.36, 10.17], [12.76, 0.75, 6.20, 10.35], [13.03, 0.16, 6.42, 11.10], [13.40, 0.28, 6.70, 11.26], [13.16, 0.17, 6.52, 11.54]]) box(w, h, d, 0, y, 0);
  box(12.54, 3.40, 5.82, 0, 11.71, 0, true);
  box(12.87, 0.15, 6.08, 0, 15.11, 0);
  box(13.26, 0.23, 6.44, 0, 15.26, 0);
  box(13.40, 0.11, 6.56, 0, 15.49, 0);
  for (const face of [-1, 1]) for (let i = 0; i < 39; i++) {
    const x = -6.1 + i * 12.2 / 38;
    box(0.14, 0.14, 0.15, x, 11.06, face * 3.24);
    // Rhythmic small figures along the triumphal procession frieze.
    ellipsoid(x, 10.77, face * 3.13, 0.055, 0.065, 0.045);
    box(0.10, 0.26, 0.07, x, 10.44, face * 3.13);
  }

  // Barrel-vault coffers: moulded rims follow the actual curved intrados.
  // The two large passage-wall relief fields are part of the monument too.
  for (const side of [-1, 1]) {
    panelFrame = new THREE.Matrix4().makeRotationY(-side * Math.PI / 2);
    panelFrame.setPosition(side * (OW / 2 - 0.035), 0, 0);
    panel(0, 2.1, 0, 4.5, 2.8, 1, 6);
  }
  panelFrame = null;
  const radius = OW / 2 - 0.025;
  for (let j = 0; j < 5; j++) for (let i = 0; i < 9; i++) {
    const a = (i + 0.5) * Math.PI / 9, z = -2.40 + j * 1.20;
    const cx = Math.cos(a) * radius, cy = SP + Math.sin(a) * radius;
    const tx = -Math.sin(a), ty = Math.cos(a), angle = a + Math.PI / 2;
    for (const t of [-0.34, 0.34]) {
      const g = new THREE.BoxGeometry(0.055, 0.08, 0.91); add(g, cx + tx * t, cy + ty * t, z, 0, 0, angle);
    }
    for (const dz of [-0.46, 0.46]) add(new THREE.BoxGeometry(0.73, 0.08, 0.055), cx, cy, z + dz, 0, 0, angle);
  }

  // The extant dedication (CIL IX1558), shared across the two attic faces.
  // Vector lettering avoids another texture set and is merged into stone draws.
  const font = new FontLoader().parse(fontData);
  const lines = ['IMP CAESARI DIVI NERVAE FILIO', 'NERVAE TRAIANO OPTIMO AVG', 'GERMANICO DACICO PONTIF MAX TRIBVNIC', 'POTEST XVIII IMP VII COS VI P P', 'FORTISSIMO PRINCIPI SENATVS P Q R'];
  for (let row = 0; row < lines.length; row++) {
    const g = new THREE.ShapeGeometry(font.generateShapes(lines[row], 0.235), 2);
    g.computeBoundingBox(); const bb = g.boundingBox!;
    g.translate(-(bb.min.x + bb.max.x) / 2, 0, 0);
    const scale = Math.min(1, 6.1 / (bb.max.x - bb.min.x)); g.scale(scale, 1, 1);
    for (const face of [-1, 1]) add(g.clone(), 0, 14.47 - row * 0.43, face * (D / 2 + 0.01), 0, face < 0 ? Math.PI : 0, 0, 'slab');
    g.dispose();
  }
  markReadable('arcusInscriptio', 0, 13.5, -D / 2 - 0.2);
  markReadable('arcusInscriptio', 0, 13.5, D / 2 + 0.2);
  brazier(b, -4.1, -6.5);
  torch(b, -W / 2 - 0.1, 3.2, -D / 2 + 0.6, -Math.PI / 2);
  markReadable('sesualdus', W / 2 + 0.2, 1.6, -D / 2 - 0.3);
}
