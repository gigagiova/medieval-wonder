import * as THREE from 'three';
import { Builder } from '../src/builder';
import { brazier } from '../src/lights';
import { brazier as before } from './.cache/lights-brazier-before';
import { surfaceGLSL as oldSurface } from './.cache/shaders-brazier-before';
import { surfaceGLSL } from '../src/shaders';
import { shared, mat, texturesReady, textureSet } from '../src/materials';
import { setKtx2Renderer } from '../src/ktx2';
import { makeFire } from '../src/fire';
import { fastTerrain, field, setSite } from '../src/displace';
const renderer = new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(780,780);setKtx2Renderer(renderer);renderer.toneMapping=THREE.AgXToneMapping;document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x414951);
scene.add(new THREE.HemisphereLight(0xbccbd9,0x64594c,2));const sun=new THREE.DirectionalLight(0xffe2bd,3);sun.position.set(-3,6,4);scene.add(sun);
const town=new THREE.DataTexture(new Uint8Array([0,0,0,0]),1,1);town.needsUpdate=true;shared.uTown.value=town;shared.uTownH.value.set(0,0);shared.uFogK.value.set(0,0,.12,60);shared.uTime.value=2.4;
const x=389,z=-224,h=fastTerrain(x,z);setSite(null);
const groups=[new THREE.Group(),new THREE.Group()];scene.add(...groups);const fires:THREE.Object3D[]=[];const lamps:THREE.PointLight[]=[];
const oldMat=mat('misc').clone();oldMat.defines={...mat('misc').defines};const hook=mat('misc').onBeforeCompile;oldMat.onBeforeCompile=(sh,r)=>{hook(sh,r);sh.fragmentShader=sh.fragmentShader.replace(surfaceGLSL,oldSurface);};oldMat.customProgramCacheKey=()=> 'brazier-before';
for(const [i,fn] of [before,brazier].entries()){const b=new Builder();fn(b,x,z);b.build(groups[i] as THREE.Scene);if(i===0)groups[i].traverse(o=>{if(o instanceof THREE.Mesh)o.material=oldMat;});const fire=makeFire(b.flames);groups[i].add(fire);fires.push(fire);const lamp=new THREE.PointLight(b.lamps[0].color,b.lamps[0].intensity*18,16,2);lamp.position.copy(b.lamps[0].pos);groups[i].add(lamp);lamps.push(lamp);}
const floor=new THREE.Mesh(new THREE.PlaneGeometry(8,8),new THREE.MeshStandardMaterial({color:0x625b4d,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.set(x,h-.005,z);scene.add(floor);
const camera=new THREE.PerspectiveCamera(40,1,.01,30);const center=new THREE.Vector3(x,h+1.08,z);
await texturesReady;
const compressed=Object.values(textureSet('charcoal')).every(t=>(t as THREE.CompressedTexture).isCompressedTexture);if(!compressed)throw new Error('Charcoal must use GPU compressed maps in this audit');
function render(old=false,view='side',fire=false,time=2.4){shared.uTime.value=time;groups[0].visible=old;groups[1].visible=!old;fires.forEach(f=>f.visible=fire);lamps.forEach(l=>l.visible=fire);const offset=view==='top'?new THREE.Vector3(0,1.5,1.1):view==='full'?new THREE.Vector3(1.8,.8,2.7):new THREE.Vector3(.85,.52,1.1);if(fire)offset.multiplyScalar(1.5);const target=fire?new THREE.Vector3(x,h+1.35,z):view==='full'?new THREE.Vector3(x,h+.72,z):center;camera.position.copy(target).add(offset);camera.lookAt(target);renderer.render(scene,camera);return {...renderer.info.render};}
Object.assign(window,{ready:true,render,charcoalTextures:Object.values(textureSet('charcoal')).map(t=>({compressed:(t as THREE.CompressedTexture).isCompressedTexture,width:t.image.width,height:t.image.height}))});render();
