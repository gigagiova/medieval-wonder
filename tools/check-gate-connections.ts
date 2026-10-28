import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {Builder} from '../src/builder';
import {wallPlan,buildChunk} from '../src/benevento/fabric';
import {GATES,SITES,ROADS,siteToWorld} from '../src/benevento/sites';
import {arcusTraiani} from '../src/benevento/monuments';
import {fastTerrain,setSite} from '../src/displace';
import {layoutTown} from '../src/benevento/layout';
import {inPoly,WALL700,distPolyline} from '../src/benevento/geo';
const plan=wallPlan(),layout=layoutTown(),report:any={gates:[],lotOverlaps:[],returns:plan.pieces.filter(w=>w.seed>=760001&&w.seed<=760310)};
const nearbyWalls=plan.pieces.filter(w=>Math.hypot((w.a[0]+w.b[0])/2-SITES.arcusTraiani.x,(w.a[1]+w.b[1])/2-SITES.arcusTraiani.z)<55);
const baseline=JSON.parse(readFileSync(new URL('../docs/benevento/aurea-alignment/baseline-wall-plan.json',import.meta.url),'utf8'));
const oldOverlaps=new Set<number>();
for(const w of baseline.plan.pieces)if(Math.hypot((w.a[0]+w.b[0])/2-SITES.arcusTraiani.x,(w.a[1]+w.b[1])/2-SITES.arcusTraiani.z)<55)for(let t=0;t<=1;t+=.1){const x=w.a[0]+(w.b[0]-w.a[0])*t,z=w.a[1]+(w.b[1]-w.a[1])*t;for(const off of [-1.25,0,1.25])for(const l of layout.lots)if(inPoly(x+off*w.out[0],z+off*w.out[1],l.c.map(p=>[p.x,p.y])))oldOverlaps.add(l.id)}
for(const w of nearbyWalls)for(let t=0;t<=1;t+=.1){const x=w.a[0]+(w.b[0]-w.a[0])*t,z=w.a[1]+(w.b[1]-w.a[1])*t;for(const off of [-1.25,0,1.25])for(const l of layout.lots)if(inPoly(x+off*w.out[0],z+off*w.out[1],l.c.map(p=>[p.x,p.y])))report.lotOverlaps.push(l.id)}
for(const id of ['aurea','laurentii']){
 const gate=GATES.find(g=>g.id===id)!,[x,z]=gate.at,b=new Builder();b.mode='collide';
 const walls=plan.pieces.filter(w=>Math.hypot((w.a[0]+w.b[0])/2-x,(w.a[1]+w.b[1])/2-z)<70);
 const gates=plan.gates.filter(g=>g.id===id);
 buildChunk(b,{key:0,i:0,j:0,lots:[],bridges:[],plots:[],wells:[],walls,towers:[],gates,holes:[]});
 if(id==='aurea'){setSite(SITES.arcusTraiani);arcusTraiani(b);setSite(null)}
 const mesh=new THREE.Mesh(mergeGeometries(b.colliders,false)!,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.updateMatrixWorld();const ray=new THREE.Raycaster();const failures=[],barrierFailures=[];
 const g=gates[0];
 const path=id==='aurea'?[siteToWorld(SITES.arcusTraiani,0,30),siteToWorld(SITES.arcusTraiani,0,-4),...ROADS.find(r=>r.name==='Via Traiana')!.pts.slice(0,3)]:
 [[x+g.dz*8,z-g.dx*8],[x-g.dz*8,z+g.dx*8]];
 for(const off of [-.6,0,.6])for(const height of [.7,1.65])for(let k=0;k<path.length-1;k++){
  const a=path[k],q=path[k+1],length=Math.hypot(q[0]-a[0],q[1]-a[1]);const dx=(q[0]-a[0])/length,dz=(q[1]-a[1])/length;
  for(let d=0;d<length;d+=.4){const point=(t:number)=>{const px=a[0]+dx*t-dz*off,pz=a[1]+dz*t+dx*off;return new THREE.Vector3(px,fastTerrain(px,pz)+height,pz)};const p=point(d),e=point(Math.min(d+.4,length)),delta=e.clone().sub(p);ray.set(p,delta.clone().normalize());ray.far=delta.length();const hit=ray.intersectObject(mesh);if(hit.length)failures.push({off,height,k,d,hit:hit[0].point.toArray()});}
 }
 const barriers=id==='aurea'?walls.filter(w=>Math.hypot((w.a[0]+w.b[0])/2-x,(w.a[1]+w.b[1])/2-z)<32):[];
 for(const w of barriers)for(const t of [0,.5,1])for(const height of [.7,1.65]){
  const px=w.a[0]+(w.b[0]-w.a[0])*t,pz=w.a[1]+(w.b[1]-w.a[1])*t;
  ray.set(new THREE.Vector3(px-w.out[0]*2,fastTerrain(px,pz)+height,pz-w.out[1]*2),new THREE.Vector3(w.out[0],0,w.out[1]));ray.far=4;
  if(!ray.intersectObject(mesh).length)barrierFailures.push({px,pz,height});
 }
 if(id==='laurentii')for(const side of [-1,1])for(const height of [.7,1.65]){
  const px=x+g.dx*side*3.1,pz=z+g.dz*side*3.1;
  ray.set(new THREE.Vector3(px-g.dz*3,fastTerrain(px,pz)+height,pz+g.dx*3),new THREE.Vector3(g.dz,0,-g.dx));ray.far=6;
  if(!ray.intersectObject(mesh).length)barrierFailures.push({px,pz,height});
 }
 report.gates.push({id,passageFailures:failures,barrierFailures});
}
report.lotOverlaps=[...new Set(report.lotOverlaps)];
report.preExistingLotOverlaps=[...oldOverlaps];
report.newLotOverlaps=report.lotOverlaps.filter((id:number)=>!oldOverlaps.has(id));
const far=(p:number[])=>Math.hypot(p[0]-389,p[1]+250)>85;
const distantPieces=(p:any)=>p.pieces.filter((w:any)=>far(w.a)&&far(w.b));
const distantTowers=(p:any)=>p.towers.filter((t:any)=>far([t.x,t.z]));
report.outside85mWallIdentical=JSON.stringify(distantPieces(baseline.plan))===JSON.stringify(distantPieces(plan));
report.outside85mTowersIdentical=JSON.stringify(distantTowers(baseline.plan))===JSON.stringify(distantTowers(plan));
report.archToPerimeterDistance=distPolyline(SITES.arcusTraiani.x,SITES.arcusTraiani.z,WALL700,true);
const a=WALL700[51],b=WALL700[55],length=Math.hypot(b[0]-a[0],b[1]-a[1]);
report.localWallCollinearityError=Math.max(...WALL700.slice(52,55).map(p=>Math.abs((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))/length));
report.cityApproachLotOverlaps=[];
for(let t=0;t<=30;t+=.5)for(const off of [-2.5,0,2.5]){
 const p=siteToWorld(SITES.arcusTraiani,off,t);
 for(const l of layout.lots)if(inPoly(p[0],p[1],l.c.map(p=>[p.x,p.y])))report.cityApproachLotOverlaps.push(l.id);
}
report.cityApproachLotOverlaps=[...new Set(report.cityApproachLotOverlaps)];
console.log(JSON.stringify(report,null,2));
if(report.returns.length||report.newLotOverlaps.length||report.cityApproachLotOverlaps.length||
 !report.outside85mWallIdentical||!report.outside85mTowersIdentical||report.archToPerimeterDistance>1e-6||report.localWallCollinearityError>1e-6||
 report.gates.some((g:any)=>g.passageFailures.length||g.barrierFailures.length))process.exitCode=1;
