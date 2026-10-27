import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fastTerrain, worldTerrain } from '../displace';
import { shared } from '../materials';
import { noiseGLSL, atmosGLSL } from '../shaders';
import { SITES, siteToWorld } from './sites';
import { fillTexture } from '../ktx2';

interface ReliefField { id: string; tile: number; rect: number[]; slot: string; grid: number; depth: number[] }
/** Distinct exact-monument photographic fields, with compressed inferred depth.
 * UVs stay in this one attachment rather than Builder's world-projected batches.
 * No inference code or model weights are loaded in the browser.
 */
export async function addTrajanReliefs(group: THREE.Group): Promise<THREE.Mesh> {
  const base = import.meta.env.BASE_URL + 'models/trajan/';
  const texture = new THREE.Texture();
  const [fields] = await Promise.all([
    fetch(base + 'panels.json').then(r => { if (!r.ok) throw new Error('Trajan relief data failed to load'); return r.json() as Promise<ReliefField[]>; }),
    fillTexture(texture, base + 'reliefs', true),
  ]);
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  const geometries: THREE.BufferGeometry[] = [], distant: THREE.BufferGeometry[] = [];
  for (const f of fields) {
    const passage = f.slot.startsWith('passage');
    const face = f.slot.startsWith('country') ? -1 : 1;
    const right = f.slot.endsWith('right');
    const side = passage ? (f.slot.includes('sacrifice') ? -1 : 1) : (right ? 1 : -1) * face;
    const attic = f.slot.includes('attic');
    const width = passage ? 4.5 : attic ? 2.20 : 2.24;
    const height = passage ? 2.8 : attic ? 2.65 : f.slot.includes('upper') ? 2.65 : 2.58;
    const bottom = passage ? 2.1 : attic ? 12.21 : f.slot.includes('upper') ? 6.02 : 2.42;
    const cx = side * (attic ? 4.72 : 4.42);
    const grid = f.grid;
    const geometry = new THREE.PlaneGeometry(width, height, grid - 1, grid - 1);
    const pos = geometry.attributes.position, uv = geometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      // Taper the depth into its frame, so the photograph is not a floating card.
      const u = uv.getX(i), v = uv.getY(i);
      const rim = Math.min(1, Math.min(u,1-u,v,1-v) * 18);
      const depth = .025 + .18 * f.depth[i] * THREE.MathUtils.smoothstep(rim,0,1);
      const x = pos.getX(i), y = pos.getY(i) + bottom + height / 2;
      if (passage) pos.setXYZ(i, side * (2.6 - .035 - depth), y, side * x);
      else pos.setXYZ(i, cx + face*x, y, face * ((attic ? 2.985 : 3.125) + depth));
      const [wx,wz] = siteToWorld(SITES.arcusTraiani,pos.getX(i),pos.getZ(i));
      pos.setY(i,pos.getY(i)+fastTerrain(wx,wz)-worldTerrain(SITES.arcusTraiani.x,SITES.arcusTraiani.z));
      uv.setXY(i,(f.rect[0]+u*f.rect[2])/1024,1-(f.rect[1]+(1-v)*f.rect[3])/1024);
    }
    // Country/passage transforms above preserve the intended outward normal.
    geometry.computeVertexNormals(); geometries.push(geometry);
    // At street distances where relief depth is subpixel, retain the actual
    // scene imagery on two triangles instead of submitting its full grid.
    const flat = new THREE.PlaneGeometry(width,height);
    const fp=flat.attributes.position, fu=flat.attributes.uv;
    for(let i=0;i<fp.count;i++){
      const u=fu.getX(i),v=fu.getY(i),x=fp.getX(i),y=fp.getY(i)+bottom+height/2;
      if(passage)fp.setXYZ(i,side*(2.6-.035-.04),y,side*x);
      else fp.setXYZ(i,cx+face*x,y,face*((attic?2.985:3.125)+.04));
      const[wx,wz]=siteToWorld(SITES.arcusTraiani,fp.getX(i),fp.getZ(i));
      fp.setY(i,fp.getY(i)+fastTerrain(wx,wz)-worldTerrain(SITES.arcusTraiani.x,SITES.arcusTraiani.z));
      fu.setXY(i,(f.rect[0]+u*f.rect[2])/1024,1-(f.rect[1]+(1-v)*f.rect[3])/1024);
    }
    flat.computeVertexNormals();distant.push(flat);
  }
  const geometry = mergeGeometries(geometries); geometries.forEach(g=>g.dispose());
  geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({map:texture,roughness:.95,metalness:0});
  material.envMapIntensity = 0;
  material.onBeforeCompile = sh => {
    Object.assign(sh.uniforms,shared);
    sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vReliefW;').replace('#include <project_vertex>','#include <project_vertex>\nvReliefW=(modelMatrix*vec4(transformed,1.0)).xyz;');
    sh.fragmentShader=sh.fragmentShader.replace('#include <common>',`#include <common>\nvarying vec3 vReliefW;\n${noiseGLSL}\n${atmosGLSL}`).replace('#include <lights_fragment_end>','#include <lights_fragment_end>\nreflectedLight.directSpecular*=.15;reflectedLight.indirectSpecular*=.15;').replace('#include <fog_fragment>','gl_FragColor.rgb=applyAtmos(gl_FragColor.rgb,vReliefW);');
  };
  material.customProgramCacheKey=()=> 'trajan-photographic-relief-v1';
  const mesh=new THREE.Mesh(geometry,material);mesh.name='Arch of Trajan photographic reliefs';mesh.castShadow=true;mesh.receiveShadow=true;
  const farGeometry=mergeGeometries(distant);distant.forEach(g=>g.dispose());
  const farMesh=new THREE.Mesh(farGeometry,material);farMesh.receiveShadow=true;
  const lod=new THREE.LOD();lod.addLevel(mesh,0);lod.addLevel(farMesh,40);lod.addLevel(new THREE.Object3D(),100);group.add(lod);
  return mesh;
}
