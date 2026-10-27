import * as THREE from 'three';
import { Builder } from '../src/builder';
import { layoutTown } from '../src/benevento/layout';
import { buildInterior, interiorAnchors, interiorFrame, interiorCollider } from '../src/benevento/interiors';
import { synagogueLayout } from '../src/benevento/synagogue';
import { shared, mat, texturesReady } from '../src/materials';
import { fastTerrain } from '../src/displace';
import type { LotData } from '../src/benevento/fabric';

const lot = layoutTown().lots.find(l => l.explore?.id === 'synagoga');
if (!lot?.front) throw new Error('Synagogue explorable lot was not selected');
const data: LotData = { c: lot.c.map(p => [p.x, p.y]), front: {a:[lot.front.a.x,lot.front.a.y],b:[lot.front.b.x,lot.front.b.y],out:[lot.front.out.x,lot.front.out.y]},h:lot.h,street:lot.street??2,seed:1000+lot.id*7919,explore:lot.explore };
const f = interiorFrame(data), anchors = interiorAnchors(data), layout = synagogueLayout(f);
const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(780,844); renderer.toneMapping=THREE.AgXToneMapping; document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene(); scene.background=new THREE.Color(0x5c626b);
scene.add(new THREE.HemisphereLight(0xc7d1e8,0x756653,2.2));
const sun=new THREE.DirectionalLight(0xffe5c6,3);sun.position.set(-4,7,2);scene.add(sun);
const town=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1);town.needsUpdate=true;shared.uTown.value=town;shared.uTownH.value.set(0,0);shared.uFogK.value.set(0,0,.12,60);
const groups=[new THREE.Group(),new THREE.Group()];scene.add(...groups);
for(let i=0;i<2;i++){const b=new Builder();buildInterior(b,{...data,explore:{id:'synagoga',kind:i?'synagoga':'domus'}});const mode=b.mode;b.mode='collide';interiorCollider(b,data);b.mode=mode;b.build(groups[i] as unknown as THREE.Scene);}
const floor=new THREE.Mesh(new THREE.PlaneGeometry(30,30),mat('ground'));floor.rotation.x=-Math.PI/2;const centre=layout.at(f.L/2,f.D/2);floor.position.set(centre[0],fastTerrain(...centre),centre[1]);scene.add(floor);
const collisionBuilder=new Builder();collisionBuilder.mode='collide';interiorCollider(collisionBuilder,data);const collision=collisionBuilder.build(new THREE.Scene()).collider;
const camera=new THREE.PerspectiveCamera(70,780/844,.04,100);
const point=(p:[number,number],y:number)=>new THREE.Vector3(p[0],fastTerrain(...p)+y,p[1]);
await texturesReady;
function render(before=false,view='inside'){
  groups[0].visible=before;groups[1].visible=!before;
  const pos=view==='outside'?anchors.outside:layout.at(f.door,f.T+0.65);
  camera.position.copy(point(pos,1.65));camera.lookAt(point(view==='outside'?anchors.door:layout.at(layout.shrine.u,layout.shrine.w),view==='outside'?1.4:1.1));
  renderer.render(scene,camera);
  const ray=new THREE.Raycaster(point(anchors.outside,1.3),point(layout.at(f.door,f.T+0.6),1.3).sub(point(anchors.outside,1.3)).normalize(),0,2.7);
  return {render:{...renderer.info.render},lot:{id:lot!.id,footprint:data.c,L:f.L,D:f.D},anchors,shrine:layout.shrine,doorRayHits:ray.intersectObject(collision).length};
}
Object.assign(window,{ready:true,render});render();
