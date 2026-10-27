import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import data from '../public/models/trajan-candidate/depth.json';
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(780,844);renderer.toneMapping=THREE.AgXToneMapping;document.body.appendChild(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x58616b);
scene.add(new THREE.HemisphereLight(0xe0e5ed,0x646057,2));
const key=new THREE.DirectionalLight(0xfff2df,3);scene.add(key);
const camera=new THREE.PerspectiveCamera(39,780/844,.01,30);
const texture=await new THREE.TextureLoader().loadAsync('/models/trajan-candidate/relief-albedo.webp');texture.colorSpace=THREE.SRGBColorSpace;texture.anisotropy=4;
const material=new THREE.MeshStandardMaterial({map:texture,roughness:.9});
const g=new THREE.PlaneGeometry(2.4,1.944,data.width-1,data.height-1);
const pos=g.attributes.position;
for(let i=0;i<pos.count;i++)pos.setZ(i,data.depth[i]*.18);
g.computeVertexNormals();
const relief=new THREE.Mesh(g,material);scene.add(relief);
const stone=new THREE.MeshStandardMaterial({color:0x8e887c,roughness:.95});
const backing=new THREE.Mesh(new THREE.BoxGeometry(2.55,2.1,.15),stone);backing.position.z=-.1;scene.add(backing);
// Same primitives/proportions as the rejected production panel, as a control.
const control=new THREE.Group();scene.add(control);
const ell=(x:number,y:number,z:number,sx:number,sy:number,sz:number,rz=0)=>{const m=new THREE.Mesh(new THREE.SphereGeometry(1,6,4),stone);m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.rotation.z=rz;control.add(m);};
const s=1.944/1.72;
for(let i=0;i<4;i++){const x=((i+.5)/4-.5)*2.06,y=-.972+.07,z=i%2?.095:.06;
ell(x+(i%2?.035:-.035)*s,y+1.38*s,z,.115*s,.16*s,.09*s);
const t=new THREE.Mesh(new THREE.CylinderGeometry(.17*s,.25*s,.82*s,6),stone);t.position.set(x,y+.83*s,z);t.scale.z=.36;control.add(t);
ell(x-.025*s,y+.87*s,z+.06,.15*s,.35*s,.032*s,(i%2?-1:1)*.35);
for(const side of [-1,1]){ell(x+side*.09*s,y+.24*s,z,.062*s,.24*s,.058*s,side*.08);ell(x+side*.22*s,y+.91*s,z+.02,.06*s,.27*s,.07*s,side*.42);}}
const primitives=control.children.map(o=>{const m=o as THREE.Mesh;m.updateMatrix();return m.geometry.clone().applyMatrix4(m.matrix);});control.clear();control.add(new THREE.Mesh(mergeGeometries(primitives),stone));
const low=new THREE.PlaneGeometry(2.4,1.944,40,32);const lp=low.attributes.position;
for(let y=0;y<=32;y++)for(let x=0;x<=40;x++)lp.setZ(y*41+x,data.depth[y*2*81+x*2]*.18);low.computeVertexNormals();
const flat=new THREE.PlaneGeometry(2.4,1.944);
const original=Array.from(pos.array);
function render(kind='depth',view='front',light='left'){
relief.visible=kind!=='control';control.visible=kind==='control';
relief.geometry=kind==='low'?low:kind==='flat'?flat:g;
for(let i=0;i<pos.count;i++)pos.setZ(i,kind==='flat'?0:original[i*3+2]);pos.needsUpdate=true;g.computeVertexNormals();
key.position.set(light==='left'?-3:3,2,2);
camera.position.set(view==='oblique'?2.1:0,.04,view==='oblique'?3.5:3.8);camera.lookAt(0,0,.06);renderer.render(scene,camera);
return {...renderer.info.render,mode:kind,view,light,depthRangeMetres:.18};}
Object.assign(window,{ready:true,render});render();
