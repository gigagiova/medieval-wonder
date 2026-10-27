import * as THREE from 'three';
import {Builder} from '../src/builder';
import {wallPlan,buildChunk} from '../src/benevento/fabric';
import {wallPlan as oldPlan,buildChunk as oldChunk} from './.cache/gates-before';
import {GATES,SITES} from '../src/benevento/sites';
import {arcusTraiani} from '../src/benevento/monuments';
import {setSite,fastTerrain} from '../src/displace';
import {shared,texturesReady} from '../src/materials';
const scene=new THREE.Scene(),renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(1000,760);renderer.setPixelRatio(1);renderer.toneMapping=THREE.AgXToneMapping;document.body.appendChild(renderer.domElement);scene.background=new THREE.Color(0x535a61);
const camera=new THREE.PerspectiveCamera(60,1000/760,.05,200);scene.add(new THREE.HemisphereLight(0xc7d1e8,0x493d31,1.7));const sun=new THREE.DirectionalLight(0xffefd9,3);sun.position.set(-4,4,2);scene.add(sun);
const town=new THREE.DataTexture(new Uint8Array([0,255,0,0]),1,1);town.needsUpdate=true;shared.uTown.value=town;shared.uTownH.value.set(0,0);shared.uFogK.value.set(0,0,.12,60);
const groups:Record<string,THREE.Group>={};
for(const id of ['aurea','laurentii'])for(const old of [true,false]){const gate=GATES.find(g=>g.id===id)!,[x,z]=gate.at;const g=new THREE.Group();scene.add(g);groups[id+old]=g;const b=new Builder(),wp=(old?oldPlan:wallPlan)();const map=new Map<string,any>();const chunk=(x:number,z:number)=>{const i=Math.floor(x/32),j=Math.floor(z/32),key=i+','+j;if(!map.has(key))map.set(key,{key:0,i,j,lots:[],bridges:[],plots:[],wells:[],walls:[],towers:[],gates:[],holes:[]});return map.get(key)};
for(let xx=x-65;xx<x+65;xx+=32)for(let zz=z-65;zz<z+65;zz+=32)chunk(xx,zz);
for(const w of wp.pieces){const mx=(w.a[0]+w.b[0])/2,mz=(w.a[1]+w.b[1])/2;if(Math.hypot(mx-x,mz-z)<65)chunk(mx,mz).walls.push(w)}
for(const t of wp.towers)if(Math.hypot(t.x-x,t.z-z)<65)chunk(t.x,t.z).towers.push(t);
for(const gt of wp.gates)if(gt.id===id)chunk(gt.x,gt.z).gates.push(gt);
for(const it of map.values())(old?oldChunk:buildChunk)(b,it);
if(id==='aurea'){setSite(old?{...SITES.arcusTraiani,rot:0}:SITES.arcusTraiani);arcusTraiani(b);setSite(null)}b.build(g as unknown as THREE.Scene);g.traverse(o=>{if(o instanceof THREE.Mesh)o.material=new THREE.MeshStandardMaterial({color:0x9b937e,roughness:.95});});
}
await texturesReady;
const render=(id:string,old:boolean,view='front')=>{for(const [k,g]of Object.entries(groups))g.visible=k===id+old;const gate=GATES.find(g=>g.id===id)!,[x,z]=gate.at;let dx=.8,dz=-.6;if(id==='laurentii'){const gt=wallPlan().gates.find(g=>g.id===id)!;dx=-gt.dz;dz=gt.dx;}
const y=fastTerrain(x,z),top=view==='top';camera.position.set(x+dx*(top?48:38),y+(top?55:5),z+dz*(top?48:38));camera.lookAt(x+dx*(top?12:0),y+3,z+dz*(top?12:0));renderer.render(scene,camera);return {...renderer.info.render}};
Object.assign(window,{ready:true,render});render('laurentii',true);
