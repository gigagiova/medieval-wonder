import { layoutTown } from '../src/benevento/layout';
import { MODESTO_LOT } from '../src/benevento/san-modesto';
import { interiorFrame } from '../src/benevento/interiors';
import { GEO_PARCELS,inPoly,insideWalls } from '../src/benevento/geo';
import { SITES,siteToWorld } from '../src/benevento/sites';
import { readFileSync } from 'node:fs';
const lay=layoutTown(),f=interiorFrame(MODESTO_LOT),s=SITES.sanctusModestus;
const corner=(u:number,w:number)=>siteToWorld(s,f.a.x+f.e.x*u+f.inn.x*w,f.a.y+f.e.y*u+f.inn.y*w);
const corners=[corner(0,0),corner(f.L,0),corner(f.L,f.D),corner(0,f.D)];
// San Modesto stands outside the circuit of 700 (on ground the plan gives to the later
// Civitas Nova, which is not built in the game): no traced cell or house may touch it.
const inside=insideWalls(s.x,s.z);if(inside)throw Error('San Modesto is expected outside the 700 circuit');
const parcel={in:inside};
for(let edge=0;edge<4;edge++)for(let step=0;step<=100;step++){const t=step/100,a=corners[edge],b=corners[(edge+1)%4],x=a[0]*(1-t)+b[0]*t,z=a[1]*(1-t)+b[1]*t;if(GEO_PARCELS.some(p=>inPoly(x,z,p.pts))||lay.lots.some(l=>inPoly(x,z,l.c.map(v=>[v.x,v.y]))))throw Error('Chapel shell overlaps the traced town');}
if(Math.abs(f.e.dot(f.inn))>1e-6)throw Error('Nonorthogonal chapel frame');
let footprintChanges:number|undefined;
if(process.argv[2]){const before=JSON.parse(readFileSync(process.argv[2],'utf8'));if(before.length!==lay.lots.length)throw Error('Lot count changed');footprintChanges=lay.lots.filter((l,i)=>l.id!==before[i].id||JSON.stringify(l.c.map(v=>[v.x,v.y]))!==JSON.stringify(before[i].c)).length;if(footprintChanges)throw Error('Existing lot footprints changed');}
const pietro=lay.lots.find(l=>l.explore?.id==='sanctusPetrusForum');if(!pietro)throw Error('San Pietro has no footprint');
console.log(JSON.stringify({lots:lay.lots.length,footprintChanges,pietroLot:pietro.id,modestoGeneratedCorners:corners,modestoClearOfTracedTown:true,modestoInside700Circuit:parcel.in,churchFrontOrthogonal:true},null,2));
