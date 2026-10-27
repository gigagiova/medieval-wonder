import * as THREE from 'three';
import { Builder } from '../src/builder';
import { arcusTraiani, TRAJAN_DIMENSIONS } from '../src/benevento/arcus-traiani';
import { arcusSculptureBefore as arcusBefore } from './.cache/arcus-sculpture-before';
import { addTrajanReliefs } from '../src/benevento/trajan-reliefs';
import { SITES, siteToWorld } from '../src/benevento/sites';
import { setSite, fastTerrain, worldTerrain } from '../src/displace';
import { shared, mat, texturesReady, MAT } from '../src/materials';
if (MAT.carvedMarble !== 21) throw new Error('Stale materials module: restart the audit Vite server');
const r = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true}); r.setSize(780,844); r.toneMapping=THREE.AgXToneMapping; document.body.appendChild(r.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x56616c);
scene.add(new THREE.HemisphereLight(0xc7d1e8,0x665848,1.6));const sun=new THREE.DirectionalLight(0xffebcf,3.5);sun.position.set(-7,10,8);scene.add(sun);
const town=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1);town.needsUpdate=true;shared.uTown.value=town;shared.uTownH.value.set(0,0);shared.uFogK.value.set(0,0,.12,60);
const groups=[new THREE.Group(),new THREE.Group()];scene.add(...groups);let collider:THREE.Mesh;
for(const [i,fn] of [arcusBefore,arcusTraiani].entries()){const b=new Builder();setSite(SITES.arcusTraiani);fn(b);setSite(null);const result=b.build(groups[i] as unknown as THREE.Scene);if(i===1)collider=result.collider;}
scene.traverse((object)=>{if(object instanceof THREE.Mesh){for(const material of [object.material].flat()){if(material.defines?.MAT === undefined)throw new Error('Undefined surface material in arch audit');}}});
const attachment=new THREE.Group();attachment.position.set(SITES.arcusTraiani.x,worldTerrain(SITES.arcusTraiani.x,SITES.arcusTraiani.z),SITES.arcusTraiani.z);attachment.rotation.y=SITES.arcusTraiani.rot;groups[1].add(attachment);await addTrajanReliefs(attachment);
const point=(x:number,y:number,z:number)=>{const [wx,wz]=siteToWorld(SITES.arcusTraiani,x,z);return new THREE.Vector3(wx,fastTerrain(wx,wz)+y,wz);};
const floor=new THREE.Mesh(new THREE.PlaneGeometry(80,80),mat('ground'));floor.rotation.x=-Math.PI/2;floor.position.copy(point(0,0,0));scene.add(floor);
const camera=new THREE.PerspectiveCamera(48,780/844,.06,180);
await texturesReady;
function render(before=false,view='front'){
 groups[0].visible=before;groups[1].visible=!before;
 if(view==='rear'){camera.position.copy(point(0,2.1,-28));camera.lookAt(point(0,7.4,0));}
 else if(view==='passage'){camera.position.copy(point(-.6,2.3,0));camera.lookAt(point(2.5,3.7,0));}
 else if(view==='vault'){camera.position.copy(point(0,1.7,-.5));camera.lookAt(point(.2,8,0));}
 else {camera.position.copy(view==='quarter'?point(15,3.5,25):point(0,2.1,28));camera.lookAt(point(0,7.4,0));}
 r.render(scene,camera);
 const ray=new THREE.Raycaster(point(0,1.5,-10),point(0,1.5,10).sub(point(0,1.5,-10)).normalize(),0,20);
 return {render:{...r.info.render},dimensions:TRAJAN_DIMENSIONS,passageRayHits:ray.intersectObject(collider).length};
}
Object.assign(window,{ready:true,render});render();
