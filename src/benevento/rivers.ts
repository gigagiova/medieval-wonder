import * as THREE from 'three';
import { shared } from '../materials';
import { noiseGLSL, atmosGLSL } from '../shaders';
import { RIVERS, DATUM } from './geo';

// The Calore and the Sabato: ribbons of water following the surveyed courses
// at their own falling level, slow, brown-grey, with a skin of drifting
// ripples and a pale Fresnel sheen from the overcast sky. Mist lies on them
// (the fog is denser low down, so the valleys fill with it).

function riverMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0x1b1d19, roughness: 0.2, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 flow;\nvarying vec3 vWorldPos;\nvarying vec2 vFlow;\nvarying float vEdge;\nattribute float edge;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvFlow = flow;\nvEdge = edge;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPos;\nvarying vec2 vFlow;\nvarying float vEdge;\n${noiseGLSL}\n${atmosGLSL}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // Ripples carried downstream.
          vec2 q = vWorldPos.xz - vFlow * uTime * 0.35;
          float e = 0.06;
          #define H(p) (vnoise(vec3((p)*0.9, uTime*0.08)) + 0.45*vnoise(vec3((p)*2.7, uTime*0.17)) + 0.2*vnoise(vec3((p)*7.0, uTime*0.3)))
          float h0 = H(q), hx = H(q + vec2(e, 0.)), hz = H(q + vec2(0., e));
          vec3 nw = normalize(vec3(-(hx-h0)/e*0.05, 1.0, -(hz-h0)/e*0.05));
          normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // Silt-brown near the banks, darker in the deep middle; foam streaks in the current.
        diffuseColor.rgb = mix(vec3(0.06,0.065,0.055), vec3(0.11,0.1,0.08), smoothstep(0.55, 1.0, vEdge));
        float foam = smoothstep(0.72, 0.9, vnoise(vec3((vWorldPos.xz - vFlow*uTime*0.6)*vec2(0.6, 0.6), uTime*0.05)));
        diffuseColor.rgb += foam * 0.05 * (1.0 - vEdge);`)
      .replace('#include <fog_fragment>', `{
          vec3 vdir = normalize(cameraPosition - vWorldPos);
          vec3 nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float fr = 0.03 + 0.97 * pow(1.0 - max(dot(vdir, nw), 0.0), 5.0);
          vec3 sky = mix(vec3(0.2,0.205,0.215), vec3(0.11,0.115,0.13), clamp(reflect(-vdir, nw).y * 1.6, 0., 1.));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, sky * 1.1, fr * 0.75);
        }
        gl_FragColor.rgb = applyAtmos(gl_FragColor.rgb, vWorldPos);`);
  };
  m.customProgramCacheKey = () => 'river1';
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
