import type { Builder } from '../builder';
import { fastTerrain } from '../displace';
import { buildInterior, interiorCollider, interiorAnchors, interiorFrame } from './interiors';
import type { LotData } from './fabric';
import { SITES, siteToWorld } from './sites';
import { markReadable } from './readables';

// Fits entirely inside the registered built parcel at the OLD Triggio cloister.
// No change to the 700 circuit: an earlier extramural chapel is reconstructed.
// Conflicting foundation dates and the inferred plan are recorded in HISTORY.
export const MODESTO_LOT: LotData = {
  c: [[-4.62,-2.81],[-5.37,.74],[4.42,2.81],[5.17,-.74]],
  front: { a: [-4.62,-2.81], b: [-5.37,.74], out: [-.978402,-.206705] },
  h: 4.0, street: 2, seed: 649774,
  explore: { id: 'sanctusModestus', kind: 'ecclesia' },
};
export function modestoDatum() {
  const a = interiorAnchors(MODESTO_LOT), [x,z] = siteToWorld(SITES.sanctusModestus,...a.door);
  return fastTerrain(x,z);
}
export function buildSanModesto(b: Builder) {
  const saved=b.absY,mode=b.mode;b.absY=modestoDatum();
  try {
    if(mode!=='render'){b.mode='collide';interiorCollider(b,MODESTO_LOT);b.mode=mode;}
    if(mode!=='collide')buildInterior(b,MODESTO_LOT);
    const f=interiorFrame(MODESTO_LOT),u=f.L/2,w=f.D/2;
    b.box('slab',f.L-.9,.22,f.D-.9,f.a.x+f.e.x*u+f.inn.x*w,-.22,f.a.y+f.e.y*u+f.inn.y*w,f.ry,true);
    if(mode!=='collide'){const a=interiorAnchors(MODESTO_LOT);markReadable('sanctusModestus',...a.read,b.absY);}
  } finally {b.absY=saved;b.mode=mode;}
}
