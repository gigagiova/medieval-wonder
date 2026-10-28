import { layoutTown } from '../src/benevento/layout';
import { MODESTO_LOT } from '../src/benevento/san-modesto';
import { interiorFrame } from '../src/benevento/interiors';
import { GEO_PARCELS,inPoly } from '../src/benevento/geo';
import { SITES,siteToWorld } from '../src/benevento/sites';
import { readFileSync } from 'node:fs';
const lay=layoutTown(),f=interiorFrame(MODESTO_LOT),s=SITES.sanctusModestus;
const corner=(u:number,w:number)=>siteToWorld(s,f.a.x+f.e.x*u+f.inn.x*w,f.a.y+f.e.y*u+f.inn.y*w);
const corners=[corner(0,0),corner(f.L,0),corner(f.L,f.D),corner(0,f.D)];
const parcel=GEO_PARCELS.find(p=>p.k==='parcel'&&inPoly(s.x,s.z,p.pts));if(!parcel)throw Error('San Modesto is outside registered built parcels');
for(let edge=0;edge<4;edge++)for(let step=0;step<=100;step++){const t=step/100,a=corners[edge],b=corners[(edge+1)%4];if(!inPoly(a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t,parcel.pts))throw Error('Generated chapel shell leaves registered parcel');}
if(Math.abs(f.e.dot(f.inn))>1e-6)throw Error('Nonorthogonal chapel frame');
let footprintChanges:number|undefined;
if(process.argv[2]){const before=JSON.parse(readFileSync(process.argv[2],'utf8'));if(before.length!==lay.lots.length)throw Error('Lot count changed');footprintChanges=lay.lots.filter((l,i)=>l.id!==before[i].id||JSON.stringify(l.c.map(v=>[v.x,v.y]))!==JSON.stringify(before[i].c)).length;if(footprintChanges)throw Error('Existing lot footprints changed');}
const pietro=lay.lots.find(l=>l.explore?.id==='sanctusPetrusForum');if(pietro?.id!==873)throw Error('San Pietro moved from its inspected lot');
console.log(JSON.stringify({lots:lay.lots.length,footprintChanges,pietroLot:pietro.id,modestoGeneratedCorners:corners,modestoInsideBuiltParcel:true,modestoInside700Circuit:parcel.in,churchFrontOrthogonal:true},null,2));
