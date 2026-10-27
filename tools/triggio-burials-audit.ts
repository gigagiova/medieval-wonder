import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {Builder} from '../src/builder';
import {setSite,fastTerrain} from '../src/displace';
import {SITES,siteToWorld} from '../src/benevento/sites';
import {buildTriggioBurials,TRIGGIO_BURIALS as C,triggioBurialHole,triggioBurialDatum} from '../src/benevento/triggio-burials';
import {layoutTown} from '../src/benevento/layout';
import {makeChunks,buildChunk} from '../src/benevento/fabric';
import {shared,texturesReady} from '../src/materials';
import {Player} from '../src/player';
import {groundCollider} from '../src/world';
const scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(780,844);renderer.setPixelRatio(1);renderer.toneMapping=THREE.AgXToneMapping;document.body.appendChild(renderer.domElement);scene.background=new THREE.Color(0x535a61);
const camera=new THREE.PerspectiveCamera(65,780/844,.05,150),hemi=new THREE.HemisphereLight(0xc7d1e8,0x493d31,1.4),sun=new THREE.DirectionalLight(0xffefd9,2);sun.position.set(-4,4,2);scene.add(hemi,sun);
const town=new THREE.DataTexture(new Uint8Array([0,255,0,0]),1,1);town.needsUpdate=true;shared.uTown.value=town;shared.uTownH.value.set(0,0);shared.uFogK.value.set(0,0,.12,60);
const datum=triggioBurialDatum(),point=(x:number,y:number,z:number)=>{const [wx,wz]=siteToWorld(SITES.triggioBurials,x,z);return new THREE.Vector3(wx,datum+y,wz)};
const before=new THREE.Group(),after=new THREE.Group();scene.add(before,after);
const layout=layoutTown();let collider:THREE.Mesh;const lamps:THREE.PointLight[]=[];
for(const [group,enabled] of [[before,false],[after,true]] as const){
 const b=new Builder(),holes=enabled?[{pts:triggioBurialHole().map(([x,z])=>siteToWorld(SITES.triggioBurials,x,z))}]:[];
 const chunks=makeChunks(layout,holes);
 const near = new Map([...chunks].filter(([,it])=>it.i===1&&it.j>=-1&&it.j<=0));
 for(const it of near.values())buildChunk(b,it);
 // Use the production terrain collider and its 0.5m opening grid.
 groundCollider(b,near,holes);
 if(enabled){setSite(SITES.triggioBurials);buildTriggioBurials(b);setSite(null);}
 const result=b.build(group as unknown as THREE.Scene);
 if(enabled){collider=result.collider;for(const l of b.lamps.filter(l=>l.pos.distanceTo(point(2,-3,0))<15)){const light=new THREE.PointLight(l.color,l.intensity*18,16*Math.max(.4,l.intensity),2);light.position.copy(l.pos);scene.add(light);lamps.push(light);}}
}
await texturesReady;
const player=new Player(collider!,point(C.entry.x,1.8,C.entry.z),camera,renderer.domElement);
const render=(mode:string)=>{
 const old=mode==='before';before.visible=old;after.visible=!old;const interior=mode==='interior';hemi.intensity=interior?.08:1.4;sun.intensity=interior?0:2;for(const l of lamps)l.visible=!old;
 if(interior){camera.position.copy(point(2.0,C.floor+1.65,1.85));camera.lookAt(point(5.5,C.floor+1.0,-.5));}
 else{camera.position.copy(point(-1.25,1.8,-6.4));camera.lookAt(point(-1.25,-2.0,-.5));}
 renderer.render(scene,camera);return {...renderer.info.render};
};
const walk=()=>{
 const outcomes=[];player.pos.copy(point(C.entry.x,1.8,C.entry.z));player.vel.set(0,0,0);player.keys.clear();
 for(let i=0;i<60;i++)player.update(1/60);
 const path=[[-1.25,2.35],[2,2.0],[6.9,1.8],[2,2.0],[-1.25,2.35],[-1.25,-6.4]];
 for(const [x,z] of path){const goal=point(x,0,z);let frames=0;for(;frames<1000;frames++){const dx=goal.x-player.pos.x,dz=goal.z-player.pos.z;if(Math.hypot(dx,dz)<.18)break;player.yaw=Math.atan2(-dx,-dz);player.keys.add('KeyW');player.update(1/60);}player.keys.clear();const local=new THREE.Vector3().copy(player.pos);outcomes.push({target:[x,z],frames,distance:Math.hypot(goal.x-local.x,goal.z-local.z),height:local.y-datum});}
 return outcomes;
};
Object.assign(window,{ready:true,render,walk});render('after');
