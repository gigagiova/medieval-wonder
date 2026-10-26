import * as THREE from 'three';
import { shared } from '../materials';
import { noiseGLSL, atmosGLSL } from '../shaders';
import { RIVERS, DATUM } from './geo';

// The Calore and the Sabato: ribbons of water following the surveyed courses
// at their own falling level, slow, brown-grey, with a skin of drifting
// ripples and a pale Fresnel sheen from the overcast sky. Mist lies on them
// (the fog is denser low down, so the valleys fill with it).

function riverMaterial() {
  // Lit like any surface (the light field shades it under bridges and banks),
  // but its sheen is our own sky, not the image-based light (a sunny road).
  const m = new THREE.MeshStandardMaterial({ color: 0x1b1d19, roughness: 0.9, metalness: 0, envMapIntensity: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 flow;\nvarying vec3 vWorldPos;\nvarying vec2 vFlow;\nvarying float vEdge;\nattribute float edge;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvFlow = flow;\nvEdge = edge;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPos;\nvarying vec2 vFlow;\nvarying float vEdge;\n${noiseGLSL}\n${atmosGLSL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        // Slow, silty water: two drifting octaves of the shared noise texture
        // (two fetches, no per-pixel noise maths), flattened towards the banks.
        vec2 rq = vWorldPos.xz - vFlow * uTime * 0.3;
        vec2 rn = (texture2D(uNoise, rq * 0.07 + uTime * 0.004).rg - 0.5) * 0.9
                + (texture2D(uNoise, rq * 0.23 - uTime * 0.006 + 0.37).ba - 0.5) * 0.5;
        float rDeep = 1.0 - smoothstep(0.55, 1.0, vEdge);
        vec3 rNw = normalize(vec3(rn.x * 0.22 * rDeep, 1.0, rn.y * 0.22 * rDeep));
        normal = normalize((viewMatrix * vec4(rNw, 0.0)).xyz);`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Brown-grey and opaque with silt; shallows over the drowned bank take
        // the colour of wet mud, so the shore line has no hard seam.
        diffuseColor.rgb = mix(vec3(0.07, 0.062, 0.048), vec3(0.03, 0.034, 0.031), smoothstep(0.0, 0.6, 1.0 - vEdge));
        float foam = smoothstep(0.7, 0.9, texture2D(uNoise, (vWorldPos.xz - vFlow * uTime * 0.5) * 0.05).b);
        diffuseColor.rgb += foam * 0.025 * (1.0 - vEdge);`)
      .replace('#include <fog_fragment>', `{
          // The overcast in the water: Fresnel (Schlick, F0 0.02) times the
          // sky dome's own gradient and its grey western glow; none in the
          // shallows, where the mud shows through.
          vec3 vdir = normalize(cameraPosition - vWorldPos);
          float fr = 0.02 + 0.98 * pow(1.0 - max(dot(vdir, rNw), 0.0), 5.0);
          vec3 rr = reflect(-vdir, rNw);
          vec3 sky = mix(vec3(0.19, 0.195, 0.205), vec3(0.06, 0.065, 0.075), smoothstep(-0.02, 0.55, rr.y));
          sky += vec3(0.9, 0.92, 0.95) * 0.12 * pow(max(dot(rr, uMoonDir), 0.0), 6.0);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, sky, fr * 0.85 * rDeep);
        }
        gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWorldPos);`);
  };
  m.customProgramCacheKey = () => 'river2';
  return m;
}

export function buildRivers(scene: THREE.Scene) {
  const mat = riverMaterial();
  for (const r of RIVERS) {
    const P = r.pts, n = P.length;
    const pos: number[] = [], flow: number[] = [], edge: number[] = [], idx: number[] = [];
    const ACROSS = 6;
    for (let k = 0; k < n; k++) {
      const a = P[Math.max(0, k - 1)], c = P[Math.min(n - 1, k + 1)];
      let dx = c[0] - a[0], dz = c[1] - a[1];
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const nx = -dz, nz = dx;
      const y = r.level[k] - DATUM;
      // A little wider than the channel: the water meets the carved banks.
      const hw = r.w / 2 + 2.5;
      for (let i = 0; i <= ACROSS; i++) {
        const t = i / ACROSS * 2 - 1;
        pos.push(P[k][0] + nx * hw * t, y, P[k][1] + nz * hw * t);
        flow.push(dx, dz);
        edge.push(Math.abs(t));
      }
    }
    for (let k = 0; k < n - 1; k++) for (let i = 0; i < ACROSS; i++) {
      const a = k * (ACROSS + 1) + i, b = a + 1, c = a + ACROSS + 1, d = c + 1;
      idx.push(a, b, c, b, d, c); // counter-clockwise seen from above (the other way round they faced down and were culled)
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('flow', new THREE.Float32BufferAttribute(flow, 2));
    g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Split into ~200 m pieces so each can be culled.
    const piece = 16;
    for (let k0 = 0; k0 < n - 1; k0 += piece) {
      const sub = new THREE.BufferGeometry();
      for (const name of ['position', 'flow', 'edge', 'normal']) sub.setAttribute(name, g.attributes[name]);
      const k1 = Math.min(n - 1, k0 + piece);
      sub.setIndex(idx.slice(k0 * ACROSS * 6, k1 * ACROSS * 6));
      const mesh = new THREE.Mesh(sub, mat);
      // Bounds of this piece only.
      const bb = new THREE.Box3();
      for (let k = k0; k <= k1; k++) for (let i = 0; i <= ACROSS; i++) { const o = (k * (ACROSS + 1) + i) * 3; bb.expandByPoint(new THREE.Vector3(pos[o], pos[o + 1], pos[o + 2])); }
      sub.boundingBox = bb;
      sub.boundingSphere = bb.getBoundingSphere(new THREE.Sphere());
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = 1;
      mesh.userData.river = true;
      scene.add(mesh);
    }
  }
}
