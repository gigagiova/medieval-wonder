import * as THREE from 'three';
import assert from 'node:assert/strict';
import {Builder} from '../src/builder';
import {brazier} from '../src/lights';
import {field,fastTerrain,setSite,toWorldXZ} from '../src/displace';
const reports=[];
for(const site of [null,{x:389,z:-224,rot:-.927295}])for(const [x,z,y,floor] of [[0,0,0,null],[-4.1,-6.5,0,null],[389,-224,0,null],[-381,-319,0,null],[100,100,0,null],[5,-3,2.4,12]] as [number,number,number,number|null][]){
 setSite(site);const b=new Builder();b.absY=floor;
 const delta=field(x,y,z,'stone',new THREE.Vector3());const c=toWorldXZ(x+delta.x,z+delta.z,[0,0]);const h=(floor??fastTerrain(c[0],c[1]))+y+delta.y;brazier(b,x,z,y);
 assert.equal(b.absY,floor,'Builder floor must be restored');
 assert.equal(b.parts.get('charcoal')?.length,1,'One shallow fuel bed, no separate chunks');
 let minMargin=Infinity,vertices=0;
 for(const g of [...b.parts.get('ember')??[],...b.parts.get('charcoal')??[]]){const p=g.attributes.position;for(let i=0;i<p.count;i++){const py=p.getY(i)-h;const r=Math.hypot(p.getX(i)-c[0],p.getZ(i)-c[1]);const allowed=(.22+(py-.98)*(.18/.27))*Math.cos(Math.PI/24);minMargin=Math.min(minMargin,allowed-r);assert(py>=.98&&py<1.25);assert(r<allowed,`${site?'site':'world'} ${x},${z}: ${r}>${allowed}`);vertices++;}}
 assert(Math.abs(b.flames[0].pos.x-c[0])<1e-6&&Math.abs(b.flames[0].pos.z-c[1])<1e-6&&Math.abs(b.flames[0].pos.y-(h+1.2))<1e-6);
 assert(Math.abs(b.lamps[0].pos.y-(h+1.55))<1e-6);
 const feet=(b.parts.get('iron')??[]).slice(0,3).map(g=>{g.computeBoundingBox();return g.boundingBox!.min.y-h;});assert(feet.every(f=>f>=0&&f<.03));
 reports.push({site:!!site,x,z,y,floor,vertices,minWallClearance:minMargin,feetAboveBase:feet,flameCentered:true,floorRestored:true});
}setSite(null);console.log(JSON.stringify(reports,null,2));
