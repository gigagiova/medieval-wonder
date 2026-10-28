import * as THREE from 'three';
import {Builder} from '../src/builder';
import {wallPlan,buildChunk} from '../src/benevento/fabric';
import {SITES} from '../src/benevento/sites';
import {arcusTraiani} from '../src/benevento/monuments';
import {setSite,fastTerrain} from '../src/displace';
import {shared,texturesReady} from '../src/materials';
import BEFORE from '../docs/benevento/aurea-alignment/baseline-wall-plan.json';

// Baseline is the actual start-of-task plan, including the recessed returns.
// Both views use their corresponding arch placement and identical cameras.
const scene=new THREE.Scene();
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(1200,900);renderer.setPixelRatio(1);renderer.toneMapping=THREE.AgXToneMapping;
document.body.appendChild(renderer.domElement);scene.background=new THREE.Color(0x697078);
const camera=new THREE.PerspectiveCamera(55,4/3,.1,650);
scene.add(new THREE.HemisphereLight(0xc7d1e8,0x493d31,1.7));
const sun=new THREE.DirectionalLight(0xffefd9,3);sun.position.set(4,6,-3);scene.add(sun);
const town=new THREE.DataTexture(new Uint8Array([0,255,0,0]),1,1);town.needsUpdate=true;
shared.uTown.value=town;shared.uTownH.value.set(0,0);shared.uFogK.value.set(0,0,.12,600);
const groups: Record<string,THREE.Group>={};
const arch=SITES.arcusTraiani;
for(const mode of ['before','after']){
 const group=new THREE.Group();scene.add(group);groups[mode]=group;
 const plan=mode==='before'?BEFORE.plan:wallPlan();
 const b=new Builder();
 const chunks=new Map<string,any>();
 const chunk=(x:number,z:number)=>{const i=Math.floor(x/32),j=Math.floor(z/32),key=`${i},${j}`;if(!chunks.has(key))chunks.set(key,{key:0,i,j,lots:[],bridges:[],plots:[],wells:[],walls:[],towers:[],gates:[],holes:[]});return chunks.get(key)};
 for(let x=arch.x-155;x<arch.x+155;x+=32)for(let z=arch.z-110;z<arch.z+110;z+=32)chunk(x,z);
 for(const w of plan.pieces){const x=(w.a[0]+w.b[0])/2,z=(w.a[1]+w.b[1])/2;if(Math.hypot(x-arch.x,z-arch.z)<180)chunk(x,z).walls.push(w)}
 for(const t of plan.towers)if(Math.hypot(t.x-arch.x,t.z-arch.z)<180)chunk(t.x,t.z).towers.push(t);
 for(const it of chunks.values())buildChunk(b,it);
 setSite(mode==='before'?BEFORE.arch:arch);arcusTraiani(b);setSite(null);b.build(group as unknown as THREE.Scene);
 const material=new THREE.MeshStandardMaterial({color:0xa8a08b,roughness:.95});
 group.traverse(o=>{if(o instanceof THREE.Mesh)o.material=material});
}
await texturesReady;
function render(mode='after',view='top'){
 for(const [key,group]of Object.entries(groups))group.visible=key===mode;
 const y=fastTerrain(arch.x,arch.z);
 if(view==='top'){camera.position.set(arch.x+25,y+100,arch.z+65);camera.up.set(0,1,0);camera.lookAt(arch.x,y+2,arch.z+8)}
 else {camera.up.set(0,1,0);camera.position.set(arch.x+43,y+7,arch.z-32);camera.lookAt(arch.x,y+4,arch.z)}
 renderer.render(scene,camera);return {...renderer.info.render};
}
Object.assign(window,{ready:true,render});render();
