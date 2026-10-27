import * as THREE from 'three';
import {Builder} from '../src/builder';
import {quadragintaRuins} from '../src/world';
import {auditBefore} from './.cache/porticus-before';
import {SITES,siteToWorld} from '../src/benevento/sites';
import {setSite,fastTerrain} from '../src/displace';
import {shared,mat,texturesReady} from '../src/materials';
const scene=new THREE.Scene(),r=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});r.setSize(780,844);r.setPixelRatio(1);r.toneMapping=THREE.AgXToneMapping;document.body.appendChild(r.domElement);scene.background=new THREE.Color(0x535a61);
scene.add(new THREE.HemisphereLight(0xc7d1e8,0x493d31,1.7));const sun=new THREE.DirectionalLight(0xffefd9,3);sun.position.set(-4,4,2);scene.add(sun);
const town=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1);town.needsUpdate=true;shared.uTown.value=town;shared.uTownH.value.set(0,0);shared.uFogK.value.set(0,0,.12,60);
const camera=new THREE.PerspectiveCamera(65,780/844,.05,100);
const before=new THREE.Group(),after=new THREE.Group();scene.add(before,after);
for(const [group,fn] of [[before,auditBefore],[after,quadragintaRuins]] as const){const b=new Builder();setSite(SITES.quadraginta);fn(b);setSite(null);b.build(group as unknown as THREE.Scene);}
const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),mat('ground'));floor.rotation.x=-Math.PI/2;floor.position.set(SITES.quadraginta.x,fastTerrain(SITES.quadraginta.x,SITES.quadraginta.z),SITES.quadraginta.z);scene.add(floor);
const point=(x:number,z:number,h:number)=>{const [wx,wz]=siteToWorld(SITES.quadraginta,x,z);return new THREE.Vector3(wx,fastTerrain(wx,wz)+h,wz)};
await texturesReady;
const render=(isBefore:boolean,inside=false)=>{before.visible=isBefore;after.visible=!isBefore;camera.position.copy(point(-52.5,inside?-86:-72,1.7));camera.lookAt(point(inside?-52.5:-47,inside?-99:-89,inside?2:3));r.render(scene,camera);return {...r.info.render}};
Object.assign(window,{ready:true,render});render(false);
