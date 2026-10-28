import * as THREE from 'three';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {Builder} from '../src/builder';
import {setSite,fastTerrain} from '../src/displace';
import {buildPaccaBurials as buildTriggioBurials,PACCA as C,paccaDatum as triggioBurialDatum,paccaHole as triggioBurialHole,PACCA_SITE} from '../src/benevento/pacca-burials';
import {SITES,siteToWorld} from '../src/benevento/sites';
import {layoutTown} from '../src/benevento/layout';
import {inPoly} from '../src/benevento/geo';
const b=new Builder();setSite(PACCA_SITE);buildTriggioBurials(b);setSite(null);
const mesh=new THREE.Mesh(mergeGeometries(b.colliders,false)!,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.updateMatrixWorld(true);
const datum=triggioBurialDatum(),p=(x:number,y:number,z:number)=>{const [wx,wz]=siteToWorld(PACCA_SITE,x,z);return new THREE.Vector3(wx,datum+y,wz)};
const ray=new THREE.Raycaster(),fail=[];
const segment=(name:string,a:THREE.Vector3,z:THREE.Vector3)=>{const d=z.clone().sub(a);ray.set(a,d.clone().normalize());ray.far=d.length();const h=ray.intersectObject(mesh);if(h.length)fail.push({name,hit:h[0].distance});};
for(const off of [-.2,0,.2])for(const height of [.65,1.65]){
 segment('stair',p(C.stairX+off,height,C.top),p(C.stairX+off,C.floor+height,C.bottom));
 segment('entry',p(C.stairX,C.floor+height,2.15+off),p(2,C.floor+height,2.15+off));
 segment('front aisle',p(2,C.floor+height,1.75+off),p(6.0,C.floor+height,1.75+off));
}
segment('church footbridge',p(-2.5,.65,0),p(.1,.65,0));
const floors=[];for(const [x,z] of [[C.stairX,-4],[C.stairX,0],[C.stairX,2.8],[.2,2],[3,1.8],[6,1.8]]){const y=x===C.stairX&&z<=C.bottom?C.floor*(C.top-z)/(C.top-C.bottom)+1.6:C.floor+1.6;ray.set(p(x,y,z),new THREE.Vector3(0,-1,0));ray.far=8;const h=ray.intersectObject(mesh);floors.push({x,z,floor:h[0]?.point.y-datum});if(!h.length)fail.push({name:'missing floor',x,z});}
const l=layoutTown(),hole=triggioBurialHole().map(([x,z])=>siteToWorld(PACCA_SITE,x,z));const crossing=[];
for(let x=-2.12;x<=-.38;x+=.2)for(let z=-5.35;z<=3.45;z+=.2){const [wx,wz]=siteToWorld(PACCA_SITE,x,z);for(const lot of l.lots)if(inPoly(wx,wz,lot.c.map(c=>[c.x,c.y]))){crossing.push(lot.id);break;}}
const report={triangles:[...b.parts.values()].flat().reduce((n,g)=>n+g.attributes.position.count/3,0),materials:b.parts.size,lamps:b.lamps.length,props:b.props.length,datum,pathObstructions:fail,floors,holeBuildingOverlaps:[...new Set(crossing)],hole,host:l.lots.find(a=>a.id===873)};
console.log(JSON.stringify(report,null,2));if(fail.length||crossing.length)process.exitCode=1;
