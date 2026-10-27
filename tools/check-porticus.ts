import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {Builder} from '../src/builder';
import {quadragintaRuins,getTeleports} from '../src/world';
import {SITES,siteToWorld} from '../src/benevento/sites';
import {setSite,fastTerrain} from '../src/displace';
const b=new Builder();setSite(SITES.quadraginta);quadragintaRuins(b);setSite(null);
const collider = new THREE.Mesh(mergeGeometries(b.colliders,false)!,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));collider.updateMatrixWorld(true);
const hits=[];const ray=new THREE.Raycaster();
for(const x of [-52.5,-45])for(const offset of [-.35,0,.35])for(const height of [.5,1.7]){
 const [ax,az]=siteToWorld(SITES.quadraginta,x+offset,-79),[bx,bz]=siteToWorld(SITES.quadraginta,x+offset,-101);
 const a=new THREE.Vector3(ax,fastTerrain(ax,az)+height,az),z=new THREE.Vector3(bx,fastTerrain(bx,bz)+height,bz),d=z.clone().sub(a);ray.set(a,d.clone().normalize());ray.far=d.length();
 const result=ray.intersectObject(collider);if(result.length)hits.push({x,offset,height,nearest:result[0].distance});
}
const tris=[...b.parts.values()].flat().reduce((n,g)=>n+g.attributes.position.count/3,0);
const teleports=getTeleports();const invalid=teleports.filter(t=>['Catacumbae','Crypta'].includes(t.name));
console.log(JSON.stringify({triangles:tris,materials:b.parts.size,props:b.props.length,lamps:b.lamps.length,pathObstructions:hits,funeraryTeleports:invalid,arrival:teleports.find(t=>t.name==='Porticus Romanae')},null,2));
if(hits.length||invalid.length||b.props.length)process.exitCode=1;
