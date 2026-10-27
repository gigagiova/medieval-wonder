import {layoutTown} from '../src/benevento/layout';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
const cache=new URL('./.cache/layout-gates-before.ts',import.meta.url);
const source=(await readFile(new URL('../src/benevento/layout.ts',import.meta.url),'utf8'))
 .replace("['aurea', -Math.sin(SITES.arcusTraiani.rot), -Math.cos(SITES.arcusTraiani.rot)]", "['aurea', 0.88, -0.48]")
 .replaceAll("from '../", "from '../../src/").replaceAll("from './", "from '../../src/benevento/");
await mkdir(new URL('./.cache/',import.meta.url),{recursive:true});await writeFile(cache,source);
const {layoutTown:beforeLayout}=await import(cache.href);
const before=beforeLayout(),after=layoutTown();
const key=(l:any)=>JSON.stringify(l.c.map((p:any)=>[p.x,p.y]));
const old=new Map(before.lots.map(l=>[key(l),l])),now=new Map(after.lots.map(l=>[key(l),l]));
const details=(l:any)=>({id:l.id,parcel:l.parcel,footprint:l.c.map((p:any)=>[p.x,p.y]),explore:l.explore});
const removed=before.lots.filter(l=>!now.has(key(l))).map(details),added=after.lots.filter(l=>!old.has(key(l))).map(details);
const changedIds=after.lots.filter(l=>old.has(key(l))&&old.get(key(l))!.id!==l.id).map(l=>({before:old.get(key(l))!.id,after:l.id}));
console.log(JSON.stringify({scope:'Only generated Aurea approach direction differs; same current registered plan, landmarks and explore targets.',beforeCount:before.lots.length,afterCount:after.lots.length,removed,added,unchangedFootprintsWithChangedIds:changedIds,explorablesBefore:before.lots.filter(l=>l.explore).map(details),explorablesAfter:after.lots.filter(l=>l.explore).map(details)},null,2));
