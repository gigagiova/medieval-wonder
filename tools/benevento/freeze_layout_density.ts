/** Preserve the existing authored town while replacing its elevation source. */
import {writeFileSync} from 'node:fs';
import {density} from '../../src/benevento/layout';
import {RAW_WALL700} from '../../src/benevento/geo';
const step=8,x0=Math.min(...RAW_WALL700.map(p=>p[0]))-16,z0=Math.min(...RAW_WALL700.map(p=>p[1]))-16;
const nx=Math.ceil((Math.max(...RAW_WALL700.map(p=>p[0]))-x0+16)/step),nz=Math.ceil((Math.max(...RAW_WALL700.map(p=>p[1]))-z0+16)/step);
const bytes=Buffer.alloc(nx*nz*4);
for(let j=0;j<nz;j++)for(let i=0;i<nx;i++)bytes.writeFloatLE(density(x0+(i+.5)*step,z0+(j+.5)*step),(j*nx+i)*4);
writeFileSync(new URL('../../src/benevento/layout-density.json',import.meta.url),JSON.stringify({note:'Original procedural density preserved independently of terrain upgrades; not a survey of historical density.',x0,z0,step,nx,nz,float32le:bytes.toString('base64')})+'\n');
console.log({nx,nz,bytes:bytes.length});
