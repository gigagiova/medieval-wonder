import * as THREE from 'three';
import type { Builder } from '../builder';
import { fastTerrain } from '../displace';
import { lucerna } from '../lights';
import { markReadable } from './readables';
import type { P2 } from './geo';
import { siteToWorld, type SiteDef } from './sites';

// Reused Roman masonry and intramural burials in the Pacca/S. Pietro quarter.
// Exact AD700 plan, access and depth are reconstruction; see PIAZZA-PACCA.md.
// No cleared parcels: the stair follows the street front of the San Pietro house
// (frame from tools/benevento/anchor_burials.ts; footbridge before the church door).
export const PACCA_SITE: SiteDef = {id:'paccaBurials',name:'Sepulcra Sancti Petri',
  x:-72.07,z:-130.831,rot:-1.812504};
export const PACCA = {floor:-3.3,top:-5.2,bottom:2,stairX:-1.25,width:1.6,
  entry:{x:-1.25,z:-6.4},chamber:{x:3.7,z:2.05}} as const;
export const paccaHole = (): P2[] => [[-2.12,-5.35],[-.38,-5.35],[-.38,3.45],[-2.12,3.45]];
export function paccaDatum(){const [x,z]=siteToWorld(PACCA_SITE,PACCA.stairX,PACCA.top);return fastTerrain(x,z);}
export function buildPaccaBurials(b:Builder){
 const C=PACCA,f=C.floor,datum=paccaDatum(),saved=b.absY;b.absY=datum;
 try{
  // Steps have the same smooth, upward-facing collision ramp used elsewhere.
  const n=24,run=(C.bottom-C.top)/n;
  for(let i=0;i<n;i++)b.box('block',C.width,.2,run+.025,C.stairX,f*(i+1)/n-.2,C.top+(i+.5)*run,0,false);
  const ramp=new THREE.BufferGeometry();ramp.setAttribute('position',new THREE.Float32BufferAttribute([
   -2.05,.04,C.top-.2,-.45,f+.04,C.bottom,-.45,.04,C.top-.2,
   -2.05,.04,C.top-.2,-2.05,f+.04,C.bottom,-.45,f+.04,C.bottom],3));
  b.collide(ramp);ramp.dispose();
  b.box('rubble',.3,3.65,9.0,-2.3,f-.15,-.9);
  b.box('rubble',.3,3.65,6.35,-.2,f-.15,-2.15);
  b.box('rubble',9.4,.45,9.2,2.15,f-.45,-.9);
  b.box('rubble',9.0,3.65,.3,2.15,f-.15,3.6);
  // A stone footbridge preserves the church door's street-level approach.
  // Its underside clears the descending player's head by over2m here.
  b.box('slab',2.55,.18,1.4,-1.0,-.18,.2423);
  // Modest rectangular reused chamber, not a speculative catacomb maze.
  b.box('rubble',.4,2.85,6.5,6.8,f-.25,.4);
  b.box('rubble',6.35,2.85,.4,3.825,f-.25,-2.55);
  b.box('rubble',.4,2.85,3.55,.65,f-.25,-.625);
  b.box('rubble',.4,.5,1.8,.65,f+2.1,2.05);
  b.box('brick',6.65,.35,6.55,3.625,f+2.6,.3);
  b.box('brick',1.0,.3,2.0,.0,f+2.6,2.15);
  // Closed stone-lined graves, with a clear front aisle and no stacked loculi.
  for(const x of [2.0,4.45])for(const z of [-1.35,.15]){
   b.box('stone',1.9,.20,.78,x,f+.02,z);
   b.box('slab',1.86,.10,.74,x,f+.22,z);
  }
  for(const [x,z]of [[1.15,2.8],[6.35,2.8],[1.15,-2.1]]){
   b.box('stone',.35,.1,.35,x,f+.95,z,0,false);lucerna(b,x,f+1.08,z,0,true);
  }
  b.box('stone',.35,.1,.35,-1.92,-1.25,-3.2,0,false);
  lucerna(b,-1.92,-1.12,-3.2,0,true);
  markReadable('paccaBurials',2.0,f+.85,1.3,datum);
 }finally{b.absY=saved;}
}
