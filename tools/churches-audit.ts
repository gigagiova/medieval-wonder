import * as THREE from 'three';
import { Builder } from '../src/builder';
import { setSite, fastTerrain } from '../src/displace';
import { shared,texturesReady } from '../src/materials';
import { layoutTown } from '../src/benevento/layout';
import { buildInterior,interiorCollider,interiorAnchors,interiorFrame } from '../src/benevento/interiors';
import { buildSanModesto,MODESTO_LOT,modestoDatum } from '../src/benevento/san-modesto';
import { SITES,siteToWorld } from '../src/benevento/sites';
import { buildHouse,reseedTown } from '../src/town';
import { reseedKit } from '../src/arch/kit';
import type { LotData } from '../src/benevento/fabric';
const scene=new THREE.Scene();scene.background=new THREE.Color(0x535a61);
const renderer=new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});renderer.setSize(780,844);renderer.setPixelRatio(1);renderer.toneMapping=THREE.AgXToneMapping;document.body.appendChild(renderer.domElement);
const camera=new THREE.PerspectiveCamera(65,780/844,.05,100),sun=new THREE.DirectionalLight(0xffefd9,2);sun.position.set(-4,4,2);scene.add(new THREE.HemisphereLight(0xc7d1e8,0x493d31,1.4),sun);
const tex=new THREE.DataTexture(new Uint8Array([0,255,0,0]),1,1);tex.needsUpdate=true;shared.uTown.value=tex;shared.uTownH.value.set(0,0);shared.uFogK.value.set(0,0,.12,60);
const lot=layoutTown().lots.find(x=>x.explore?.id==='sanctusPetrusForum')!;
const pietro:LotData={c:lot.c.map(p=>[p.x,p.y]),front:{a:[lot.front!.a.x,lot.front!.a.y],b:[lot.front!.b.x,lot.front!.b.y],out:[lot.front!.out.x,lot.front!.out.y]},h:lot.h,seed:1000+lot.id*7919,street:lot.street??2,explore:lot.explore};
const groups=new Map<string,THREE.Group>(),colliders=new Map<string,THREE.Mesh>();
for(const [id,data] of [['pietro',pietro],['modesto',MODESTO_LOT]] as const)for(const mode of ['before','after']){
 const b=new Builder(),group=new THREE.Group();scene.add(group);groups.set(id+'-'+mode,group);setSite(id==='modesto'?SITES.sanctusModestus:null);
 if(id==='modesto')b.absY=modestoDatum();
 const f=interiorFrame(data),cx=f.a.x+f.e.x*f.L/2+f.inn.x*f.D/2,cz=f.a.y+f.e.y*f.L/2+f.inn.y*f.D/2;
 b.box('dirt',20,.2,20,cx,-.2,cz,0,true);
 if(mode==='after'){
  if(id==='modesto')buildSanModesto(b);
  else{b.mode='collide';interiorCollider(b,data);b.mode='full';buildInterior(b,data);}
 }else if(id==='pietro'){
  reseedTown(data.seed);reseedKit(data.seed+1);buildHouse(b,{...lot,h:6.161621243710503,seed:data.seed,explore:undefined} as any);
 }
 const result=b.build(group as unknown as THREE.Scene);colliders.set(id+'-'+mode,result.collider);
 const [gx,gz]=id==='modesto'?siteToWorld(SITES.sanctusModestus,cx,cz):[cx,cz];
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(28,28),new THREE.MeshStandardMaterial({color:0x60574a,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.set(gx,(id==='modesto'?modestoDatum():fastTerrain(gx,gz))-.05,gz);group.add(ground);
 for(const lamp of b.lamps){const light=new THREE.PointLight(lamp.color,lamp.intensity*18,12,2);light.position.copy(lamp.pos);group.add(light);}
 setSite(null);
}
await texturesReady;
const point=(id:string,p:number[],y:number)=>{const [x,z]=id==='modesto'?siteToWorld(SITES.sanctusModestus,p[0],p[1]):p;return new THREE.Vector3(x,(id==='modesto'?modestoDatum():fastTerrain(x,z))+y,z)};
function render(id:string,mode:string,view:string){for(const [k,g]of groups)g.visible=k===id+'-'+mode;const d=id==='modesto'?MODESTO_LOT:pietro,f=interiorFrame(d),a=interiorAnchors(d);
 if(view==='inside'){camera.position.copy(point(id,a.stand,1.65));camera.lookAt(point(id,[a.read[0],a.read[2]],1.1));}
 else{const p=[a.door[0]-f.inn.x*5.5,a.door[1]-f.inn.y*5.5];camera.position.copy(point(id,p,1.75));camera.lookAt(point(id,[a.door[0]+f.inn.x*1.5,a.door[1]+f.inn.y*1.5],2.2));}
 renderer.render(scene,camera);return{targetHeight:d.h,camera:camera.position.toArray(),quaternion:camera.quaternion.toArray(),...renderer.info.render};}
function paths(){const ray=new THREE.Raycaster(),results=[];for(const[id,data]of [['pietro',pietro],['modesto',MODESTO_LOT]]as const){const f=interiorFrame(data),a=interiorAnchors(data),mesh=colliders.get(id+'-after')!;mesh.updateMatrixWorld(true);for(const off of [-.22,0,.22]){const start=point(id,[a.outside[0]+f.e.x*off,a.outside[1]+f.e.y*off],1.6),end=point(id,[a.stand[0]+f.e.x*off,a.stand[1]+f.e.y*off],1.6),dir=end.clone().sub(start);ray.set(start,dir.clone().normalize());ray.far=dir.length();results.push({id,off,hits:ray.intersectObject(mesh).length});}}return results;}
Object.assign(window,{ready:true,render,paths});render('pietro','after','outside');
