import * as THREE from 'three';

/** A rectangular UV cloth lattice exported by the native garment builder. */
interface ClothGrid {
  controlColumns: number;
  controlRows: number;
  /** Control-grid coordinates; only the actual clasp is attached. */
  pins: [number, number][];
  torso?: { y: number; rx: number; rz: number; cz: number }[];
  clearance?: number;
  /** kg per square metre of fabric; mass is derived from triangle areas. */
  massPerArea?: number;
  /** Flat-pattern control positions, distinct from a settled render shape. */
  restPositions?: number[];
  restArea?: number;
  bendingCompliance?: number;
  iterations?: number;
  head?: { center:[number,number,number]; radii:[number,number,number] };
  /** Authoring experiment only: bring the flat pattern's clasp together. */
  pinPaths?: { pin:[number,number]; releaseAt?:number; points:{time:number;position:[number,number,number]}[] }[];
}
interface Particle { p: THREE.Vector3; previous: THREE.Vector3; anchor: THREE.Vector3; contact: THREE.Vector3; vertex: number; weight: number }
interface Edge { a: number; b: number; length: number; compliance: number; lambda: number }
interface Capsule { a: THREE.Object3D; b: THREE.Object3D; radius: number; start: THREE.Vector3; end: THREE.Vector3; min: THREE.Vector3; max: THREE.Vector3 }

// XPBD distance constraints (Müller et al., 2016) and virtual triangle contact
// samples (NVIDIA PhysX/NvCloth cloth guide). The simulation surface is 165
// particles, independent of the render mesh. No copy of either implementation.
// Pins follow the authored clasp skin; the rest of the cloth slides on moving
// body capsules. Collision runs after stretch projection so projection cannot
// silently put the cape back inside a shoulder.
export function makeNativeCloak(body: THREE.Object3D, bone: (name: string) => THREE.Bone | undefined) {
  const sources: { mesh: THREE.SkinnedMesh; grid: ClothGrid }[] = [];
  body.traverse((object) => {
    const mesh = object as THREE.SkinnedMesh;
    const grid = mesh.userData.nativeCloth ?? mesh.parent?.userData.nativeCloth;
    if (mesh.isSkinnedMesh && grid) sources.push({ mesh, grid });
  });
  if (!sources.length) return null;
  const solvers = sources.map(({ mesh, grid }) => makeSurface(body, mesh, grid, bone));
  return {
    update(dt: number) { for (const solver of solvers) solver.update(dt); },
    rest() { for (const solver of solvers) solver.rest(); },
    dispose() { for (const solver of solvers) solver.dispose(); },
    setVisible(value:boolean) { for(const solver of solvers)solver.setVisible(value); },
    stats: solvers.map((solver) => solver.stats),
    debugSnapshot() { return solvers.map(solver=>solver.debugSnapshot()); },
  };
}

function makeSurface(body: THREE.Object3D, source: THREE.SkinnedMesh, grid: ClothGrid, bone: (name: string) => THREE.Bone | undefined) {
  const cols = grid.controlColumns, rows = grid.controlRows;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || (cols + 1) * (rows + 1) > 512)
    throw new Error('nativeCloth needs a control grid of 9–512 particles.');
  if (!grid.pins?.length) throw new Error('nativeCloth needs explicit clasp pins.');
  const uv = source.geometry.attributes.uv, position = source.geometry.attributes.position;
  if (!uv) throw new Error('nativeCloth needs rectangular UV coordinates.');
  body.updateMatrixWorld(true);
  const geometry = source.geometry.clone();
  geometry.setAttribute('position', position.clone().setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', source.geometry.attributes.normal.clone().setUsage(THREE.DynamicDrawUsage));
  geometry.deleteAttribute('skinIndex'); geometry.deleteAttribute('skinWeight');
  const visible = new THREE.Mesh(geometry, source.material);
  visible.name = source.name + '_cloth';
  visible.position.copy(source.position); visible.quaternion.copy(source.quaternion); visible.scale.copy(source.scale);
  visible.frustumCulled = false;
  source.parent!.add(visible);
  source.visible = false;
  const id = (x: number, y: number) => y * (cols + 1) + x;
  const pins = new Set(grid.pins.map(([x, y]) => id(x, y)));
  const skinPoint = (i: number, out: THREE.Vector3) => source.getVertexPosition(i, out).applyMatrix4(source.matrixWorld);
  const particles: Particle[] = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
    let best = -1, distance = Infinity;
    for (let i = 0; i < uv.count; i++) {
      const d = (uv.getX(i) - x / cols) ** 2 + (uv.getY(i) - y / rows) ** 2;
      if (d < distance) { distance = d; best = i; }
    }
    if (distance > 1e-6) throw new Error(`nativeCloth control point ${x},${y} is absent from the render UV lattice.`);
    const p = skinPoint(best, new THREE.Vector3());
    particles.push({ p, previous: p.clone(), anchor: p.clone(), contact:new THREE.Vector3(), vertex: best, weight: pins.has(id(x, y)) ? 0 : 1 });
  }
  const bindScale=body.getWorldScale(new THREE.Vector3()).x;
  const metric=grid.restPositions;
  if(metric&&metric.length!==particles.length*3)throw new Error('nativeCloth restPositions must describe every control particle.');
  const restPoints=metric?particles.map((_,i)=>new THREE.Vector3().fromArray(metric,i*3).multiplyScalar(bindScale)):particles.map(p=>p.p);
  const edges: Edge[] = [];
  const edge = (a: number, b: number, compliance: number) => edges.push({ a, b, length: restPoints[a].distanceTo(restPoints[b]), compliance, lambda: 0 });
  const triangles: number[][] = [];
  for (let y = 0; y <= rows; y++) for (let x = 0; x <= cols; x++) {
    const a = id(x, y);
    if (x < cols) edge(a, id(x + 1, y), 0.0001);
    if (y < rows) edge(a, id(x, y + 1), 0.0001);
    if (x < cols && y < rows) {
      // Constrain the actual triangulation's diagonal. Constraining both
      // diagonals turns a coarse cell into a rigid plate and locks folding.
      edge(id(x + 1, y), id(x, y + 1), 0.0004);
      triangles.push([a, id(x + 1, y), id(x, y + 1)], [id(x + 1, y), id(x + 1, y + 1), id(x, y + 1)]);
    }
    if (x + 2 <= cols) edge(a, id(x + 2, y), grid.bendingCompliance ?? 10);
    if (y + 2 <= rows) edge(a, id(x, y + 2), grid.bendingCompliance ?? 10);
  }
  // Geodesic tethers resist global stretching at low iteration counts without
  // pulling particles back to an authored pose (NvCloth's tether principle).
  const tethers: {pin:number;length:number}[][] = particles.map(() => []);
  for(const pin of pins){
    const distances=particles.map(()=>Infinity),visited=new Set<number>();distances[pin]=0;
    for(let n=0;n<particles.length;n++){
      let current=-1,best=Infinity;
      for(let i=0;i<particles.length;i++)if(!visited.has(i)&&distances[i]<best){current=i;best=distances[i];}
      if(current<0)break;visited.add(current);
      for(const edge of edges){
        if(edge.compliance>=1)continue;
        const next=edge.a===current?edge.b:edge.b===current?edge.a:-1;
        if(next>=0)distances[next]=Math.min(distances[next],best+edge.length);
      }
    }
    distances.forEach((length,i)=>tethers[i].push({pin,length}));
  }
  // The fine surface follows simulated cells, including rotated normal detail.
  // Only the clasp remains skinned: no per-vertex LBS/rest attraction can
  // turn the cape into a rigid shell. This also avoids skinning 1767 vertices
  // on the CPU every frame.
  const cells = Array.from({length:cols*rows},(_,i)=>{
    const x=i%cols,y=Math.floor(i/cols);
    const right=new THREE.Vector3().subVectors(particles[id(x+1,y)].p,particles[id(x,y)].p).normalize();
    const normal=new THREE.Vector3().subVectors(particles[id(x,y+1)].p,particles[id(x,y)].p).cross(right).normalize();
    return {x,y,right,normal,down:new THREE.Vector3().crossVectors(right,normal).normalize()};
  });
  const mapping = Array.from({ length: uv.count }, (_, i) => {
    const u = THREE.MathUtils.clamp(uv.getX(i), 0, 1) * cols, v = THREE.MathUtils.clamp(uv.getY(i), 0, 1) * rows;
    const x = Math.min(cols - 1, Math.floor(u)), y = Math.min(rows - 1, Math.floor(v)), a = u - x, b = v - y;
    const ids=[id(x,y),id(x+1,y),id(x,y+1),id(x+1,y+1)],weights=[(1-a)*(1-b),a*(1-b),(1-a)*b,a*b];
    const residual=skinPoint(i,new THREE.Vector3());
    ids.forEach((index,k)=>residual.addScaledVector(particles[index].p,-weights[k]));
    const cell=cells[y*cols+x];
    return {ids,weights,cell,residual:[residual.dot(cell.right),residual.dot(cell.down),residual.dot(cell.normal)]};
  });
  // Integrate mass on the fine fabric, not the control mesh's chordal area:
  // a coarse triangle spanning a fold would otherwise discard cloth mass.
  const masses=new Float64Array(particles.length);
  const fabricPoints=Array.from({length:position.count},(_,i)=>skinPoint(i,new THREE.Vector3()));
  const areaA=new THREE.Vector3(),areaB=new THREE.Vector3(),indices=source.geometry.index;
  let fabricArea=0;
  for(let i=0;i<(indices?.count??position.count);i+=3){
    const triangle=[0,1,2].map(k=>indices?indices.getX(i+k):i+k);
    const [a,b,c]=triangle.map(index=>fabricPoints[index]);
    const area=areaA.subVectors(b,a).cross(areaB.subVectors(c,a)).length()*.5;
    fabricArea+=area;
    const share=area*(grid.massPerArea??.32)/3;
    for(const vertex of triangle){const map=mapping[vertex];for(let k=0;k<4;k++)masses[map.ids[k]]+=share*map.weights[k];}
  }
  if(grid.restArea&&fabricArea>0){const ratio=grid.restArea*bindScale*bindScale/fabricArea;for(let i=0;i<masses.length;i++)masses[i]*=ratio;fabricArea=grid.restArea*bindScale*bindScale;}
  for(let i=0;i<particles.length;i++)if(particles[i].weight)particles[i].weight=1/Math.max(masses[i],1e-5);
  const capsules: Capsule[] = [];
  const cap = (a: string, b: string, radius: number) => {
    const start = bone(a), end = bone(b);
    if (start && end) capsules.push({ a: start, b: end, radius, start: new THREE.Vector3(), end: new THREE.Vector3(), min: new THREE.Vector3(), max: new THREE.Vector3() });
  };
  if (!grid.torso?.length) {
    cap('Hips', 'Spine2', 0.125);
    cap('LeftUpLeg', 'RightUpLeg', 0.11);
  }
  cap('Neck','Head',.06);
  for (const side of ['Left', 'Right']) {
    cap(side + 'Shoulder', side + 'Arm', 0.055);
    cap(side + 'Arm', side + 'ForeArm', 0.065);
    cap(side + 'ForeArm', side + 'Hand', 0.05);
    cap(side + 'UpLeg', side + 'Leg', 0.095);
  }
  const trunkBones = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck'].map(bone).filter((b): b is THREE.Bone => !!b);
  const inverseBind=(owner:THREE.Bone)=>{
    let inverse:THREE.Matrix4|undefined;
    body.traverse(object=>{const mesh=object as THREE.SkinnedMesh;if(!mesh.isSkinnedMesh||mesh===source||inverse)return;const index=mesh.skeleton.bones.indexOf(owner);if(index>=0)inverse=mesh.skeleton.boneInverses[index].clone();});
    return inverse??owner.matrixWorld.clone().invert();
  };
  const bindPositions=trunkBones.map(owner=>({owner,inverse:inverseBind(owner)}));
  const bodyRotation = body.getWorldQuaternion(new THREE.Quaternion());
  const rings = (grid.torso ?? []).map(level => {
    const center = new THREE.Vector3(0, level.y, level.cz);
    const bind=bindPositions.reduce((a,b)=>Math.abs(new THREE.Vector3().setFromMatrixPosition(a.inverse.clone().invert()).y-center.y)<Math.abs(new THREE.Vector3().setFromMatrixPosition(b.inverse.clone().invert()).y-center.y)?a:b);
    const right = new THREE.Vector3(1,0,0).transformDirection(bind.inverse);
    return { ...level, owner:bind.owner, local: center.clone().applyMatrix4(bind.inverse), center, localRight: right, right: right.clone() };
  });
  const headBone=bone('Head');
  const head=grid.head&&headBone?{
    bone:headBone,
    local:headBone.worldToLocal(new THREE.Vector3(...grid.head.center).applyMatrix4(body.matrixWorld)),
    center:new THREE.Vector3(),
    radii:new THREE.Vector3(...grid.head.radii),
    rotation:new THREE.Quaternion(),
    inverse:new THREE.Quaternion(),
    bindRotation:headBone.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(bodyRotation),
  }:null;
  const bands=rings.slice(0,-1).map((a,i)=>({a,b:rings[i+1],axis:new THREE.Vector3(),right:new THREE.Vector3(),forward:new THREE.Vector3(),length:0,min:new THREE.Vector3(),max:new THREE.Vector3()}));
  const boneRotation = new THREE.Quaternion();
  const delta = new THREE.Vector3(), segment = new THREE.Vector3(), relative = new THREE.Vector3(), closest = new THREE.Vector3();
  const point = new THREE.Vector3(), correction = new THREE.Vector3(), velocity = new THREE.Vector3();
  const lastOrigin = body.getWorldPosition(new THREE.Vector3()), origin = new THREE.Vector3(), local = new THREE.Matrix4();
  let fresh = true, accumulator = 0, scale = 1, elapsed = 0;
  const stats = { particles: particles.length, triangles: triangles.length, edges: edges.length, fabricArea, mass: masses.reduce((sum,mass)=>sum+mass,0), maxStretch: 1, stretchedEdge: [0,0], milliseconds: 0 };
  const project = (p: THREE.Vector3) => {
    if(head){
      relative.subVectors(p,head.center).applyQuaternion(head.inverse);
      const rx=(head.radii.x+(grid.clearance??.008))*scale,ry=(head.radii.y+(grid.clearance??.008))*scale,rz=(head.radii.z+(grid.clearance??.008))*scale;
      const distance=Math.sqrt((relative.x/rx)**2+(relative.y/ry)**2+(relative.z/rz)**2);
      if(distance<1&&distance>1e-8)p.copy(relative.multiplyScalar(1/distance).applyQuaternion(head.rotation).add(head.center));
    }
    // Use the nearest point on the connected torso axis. Testing each tilted
    // band only between its end planes leaves wedge-shaped gaps at joints.
    let nearest:typeof bands[number]|undefined,nearestT=0,nearestDistance=Infinity;
    for(const band of bands){
      if(p.x<band.min.x||p.x>band.max.x||p.y<band.min.y||p.y>band.max.y||p.z<band.min.z||p.z>band.max.z)continue;
      relative.subVectors(p,band.a.center);const axial=relative.dot(band.axis);
      if((band===bands[0]&&axial<-(grid.clearance??.008)*scale)||(band===bands[bands.length-1]&&axial>band.length+(grid.clearance??.008)*scale))continue;
      const t=THREE.MathUtils.clamp(axial/band.length,0,1);
      closest.copy(band.a.center).addScaledVector(band.axis,t*band.length);
      const distance=closest.distanceToSquared(p);if(distance<nearestDistance){nearest=band;nearestT=t;nearestDistance=distance;}
    }
    if(nearest){
      const band=nearest,t=nearestT;
      closest.copy(band.a.center).addScaledVector(band.axis,t*band.length);relative.subVectors(p,closest);
      const x=relative.dot(band.right),z=relative.dot(band.forward);
      const rx=(THREE.MathUtils.lerp(band.a.rx,band.b.rx,t)+(grid.clearance??.008))*scale;
      const rz=(THREE.MathUtils.lerp(band.a.rz,band.b.rz,t)+(grid.clearance??.008))*scale;
      const distance=Math.sqrt((x/rx)**2+(z/rz)**2);
      if(distance<1&&distance>1e-8)p.addScaledVector(band.right,x*(1/distance-1)).addScaledVector(band.forward,z*(1/distance-1));
    }
    for (const cap of capsules) {
      if(p.x<cap.min.x||p.x>cap.max.x||p.y<cap.min.y||p.y>cap.max.y||p.z<cap.min.z||p.z>cap.max.z)continue;
      segment.subVectors(cap.end, cap.start);
      relative.subVectors(p, cap.start);
      const t = THREE.MathUtils.clamp(relative.dot(segment) / Math.max(segment.lengthSq(), 1e-10), 0, 1);
      closest.copy(cap.start).addScaledVector(segment, t);
      delta.subVectors(p, closest);
      const radius = (cap.radius + 0.009) * scale, length = delta.length();
      if (length < radius) {
        if (length < 1e-8) delta.set(0, 0, -1); else delta.multiplyScalar(1 / length);
        p.copy(closest).addScaledVector(delta, radius);
      }
    }
    p.y = Math.max(origin.y + 0.005, p.y);
  };
  const solve = (dt: number) => {
    for (const p of particles) {
      p.contact.set(0,0,0);
      if (!p.weight) { p.p.copy(p.anchor); p.previous.copy(p.anchor); continue; }
      velocity.subVectors(p.p, p.previous).multiplyScalar(Math.exp(-1.5 * dt));
      p.previous.copy(p.p);
      p.p.add(velocity); p.p.y -= 9.81 * dt * dt;
    }
    for (const edge of edges) edge.lambda = 0;
    for (let iteration = 0; iteration < Math.min(20,grid.iterations??5); iteration++) {
      for (const edge of edges) {
        const a = particles[edge.a], b = particles[edge.b], weight = a.weight + b.weight;
        if (!weight) continue;
        delta.subVectors(a.p, b.p);
        const length = delta.length();
        if (length < 1e-9) continue;
        const alpha = edge.compliance / (dt * dt);
        const dl = (-(length - edge.length) - alpha * edge.lambda) / (weight + alpha);
        edge.lambda += dl;
        a.p.addScaledVector(delta, a.weight * dl / length); b.p.addScaledVector(delta, -b.weight * dl / length);
      }
      for(let i=0;i<particles.length;i++){
        const p=particles[i];if(!p.weight)continue;
        for(const tether of tethers[i]){
          const pin=particles[tether.pin];delta.subVectors(p.p,pin.p);const distance=delta.length();
          if(distance>tether.length*1.02)p.p.copy(pin.p).addScaledVector(delta,tether.length*1.02/distance);
        }
      }
      for (const p of particles) if (p.weight) {
        correction.copy(p.p); project(p.p); correction.subVectors(p.p,correction);
        p.contact.add(correction);
      }
      // The open neck boundary needs its own samples: a triangle centroid
      // lies below the rim and can miss an edge cutting across the neck.
      // Without this, a closed clasp loop can numerically slip through the body.
      for(const edge of edges){
        if(edge.compliance>=1)continue;
        const ax=edge.a%(cols+1),ay=Math.floor(edge.a/(cols+1)),bx=edge.b%(cols+1),by=Math.floor(edge.b/(cols+1));
        if(!((ay===0&&by===0)||(ax===0&&bx===0)||(ax===cols&&bx===cols)))continue;
        const a=particles[edge.a],b=particles[edge.b],weight=a.weight+b.weight;if(!weight)continue;
        point.copy(a.p).add(b.p).multiplyScalar(.5);correction.copy(point);project(point);correction.subVectors(point,correction);
        a.p.addScaledVector(correction,2*a.weight/weight);b.p.addScaledVector(correction,2*b.weight/weight);
        a.contact.add(correction);b.contact.add(correction);
      }
      // A triangle can cut through a shoulder even when its vertices are clear.
      // Distribute a virtual centroid's contact back onto its free vertices.
      for (const triangle of triangles) {
        point.set(0, 0, 0);
        let weight = 0;
        for (const i of triangle) { point.add(particles[i].p); weight += particles[i].weight; }
        if (!weight) continue;
        point.multiplyScalar(1 / 3); correction.copy(point); project(point); correction.subVectors(point, correction);
        if (correction.lengthSq() < 1e-12) continue;
        for (const i of triangle) if (particles[i].weight) { particles[i].p.addScaledVector(correction, 3 * particles[i].weight / weight); particles[i].contact.add(correction); }
      }
    }
    // Contact changes velocity once per substep. Updating Verlet history
    // inside every projection iteration accumulates corrections that stretch
    // constraints subsequently cancel, injecting enormous inward velocities.
    for(const p of particles)if(p.weight&&p.contact.lengthSq()>1e-12){
      p.contact.normalize();velocity.subVectors(p.p,p.previous);
      p.previous.addScaledVector(p.contact,velocity.dot(p.contact));
    }
  };
  const reset = () => {
    for (const p of particles) { p.p.copy(p.anchor); if(p.weight)project(p.p); p.previous.copy(p.p); }
    accumulator = 0; fresh = false;
  };
  return {
    stats,
    debugSnapshot(){return{
      particles:particles.map(p=>p.p.toArray()),
      capsules:capsules.map(c=>({name:c.a.name+'→'+c.b.name,a:c.start.toArray(),b:c.end.toArray(),radius:(c.radius+.009)*scale})),
      rings:rings.map(r=>({center:r.center.toArray(),right:r.right.toArray(),rx:(r.rx+(grid.clearance??.008))*scale,rz:(r.rz+(grid.clearance??.008))*scale})),
      head:head?{center:head.center.toArray(),radii:head.radii.clone().addScalar(grid.clearance??.008).multiplyScalar(scale).toArray(),rotation:head.rotation.toArray()}:null,
    };},
    dispose() { visible.removeFromParent(); geometry.dispose(); source.visible=true; },
    setVisible(value:boolean) { visible.visible=false;source.visible=value;fresh=true;elapsed=0; },
    rest() { visible.visible = false; source.visible = true; fresh = true; elapsed=0; },
    update(dt: number) {
      if (!(dt > 0) || !Number.isFinite(dt)) return;
      const started = performance.now();
      body.updateMatrixWorld(true);
      scale = body.getWorldScale(relative).x;
      elapsed+=dt;
      for (const p of particles) skinPoint(p.vertex, p.anchor);
      for(const path of grid.pinPaths??[]){
        const particle=particles[id(...path.pin)];
        if(path.releaseAt!==undefined){
          if(elapsed>=path.releaseAt){particle.weight=1/Math.max(masses[id(...path.pin)],1e-5);continue;}
          particle.weight=0;
        }
        const points=path.points;let a=points[0],b=points[points.length-1];
        for(let i=1;i<points.length;i++)if(elapsed<=points[i].time){a=points[i-1];b=points[i];break;}
        const t=THREE.MathUtils.clamp((elapsed-a.time)/Math.max(1e-8,b.time-a.time),0,1);
        const smooth=t*t*(3-2*t);
        const anchor=particles[id(...path.pin)].anchor;
        anchor.set(...a.position).lerp(point.set(...b.position),smooth).applyMatrix4(body.matrixWorld);
      }
      if(head){head.center.copy(head.local).applyMatrix4(head.bone.matrixWorld);head.rotation.copy(head.bone.getWorldQuaternion(boneRotation)).multiply(head.bindRotation);head.inverse.copy(head.rotation).invert();}
      for (const cap of capsules) {
        cap.start.setFromMatrixPosition(cap.a.matrixWorld); cap.end.setFromMatrixPosition(cap.b.matrixWorld);
        const radius=(cap.radius+.009)*scale;cap.min.copy(cap.start).min(cap.end).addScalar(-radius);cap.max.copy(cap.start).max(cap.end).addScalar(radius);
      }
      for(const ring of rings){ring.center.copy(ring.local).applyMatrix4(ring.owner.matrixWorld);ring.right.copy(ring.localRight).applyQuaternion(ring.owner.getWorldQuaternion(boneRotation));}
      for(const band of bands){
        band.axis.subVectors(band.b.center,band.a.center);band.length=Math.max(1e-8,band.axis.length());band.axis.multiplyScalar(1/band.length);
        band.right.copy(band.a.right).add(band.b.right).normalize();band.forward.crossVectors(band.right,band.axis).normalize();
        const radius=(Math.max(band.a.rx,band.b.rx,band.a.rz,band.b.rz)+(grid.clearance??.008))*scale;
        band.min.copy(band.a.center).min(band.b.center).addScalar(-radius);band.max.copy(band.a.center).max(band.b.center).addScalar(radius);
      }
      body.getWorldPosition(origin);
      if (fresh || origin.distanceTo(lastOrigin) > 0.5) reset();
      lastOrigin.copy(origin);
      accumulator += Math.min(dt, 1 / 15);
      while (accumulator >= 1 / 120 - 1e-9) { solve(1 / 120); accumulator -= 1 / 120; }
      source.visible = false; visible.visible = true;
      visible.updateWorldMatrix(true, false); local.copy(visible.matrixWorld).invert();
      for(const cell of cells){
        const a=particles[id(cell.x,cell.y)].p;
        cell.right.subVectors(particles[id(cell.x+1,cell.y)].p,a).normalize();
        cell.normal.subVectors(particles[id(cell.x,cell.y+1)].p,a).cross(cell.right).normalize();
        cell.down.crossVectors(cell.right,cell.normal).normalize();
      }
      const output = geometry.attributes.position;
      for (let i = 0; i < output.count; i++) {
        point.set(0,0,0);
        const map = mapping[i];
        for(let k=0;k<4;k++)point.addScaledVector(particles[map.ids[k]].p,map.weights[k]);
        point.addScaledVector(map.cell.right,map.residual[0]).addScaledVector(map.cell.down,map.residual[1]).addScaledVector(map.cell.normal,map.residual[2]);
        point.applyMatrix4(local); output.setXYZ(i, point.x, point.y, point.z);
      }
      output.needsUpdate = true; geometry.computeVertexNormals();
      stats.maxStretch = 1;
      for(const edge of edges)if(edge.compliance<1){
        const stretch=particles[edge.a].p.distanceTo(particles[edge.b].p)/edge.length;
        if(stretch>stats.maxStretch){stats.maxStretch=stretch;stats.stretchedEdge[0]=edge.a;stats.stretchedEdge[1]=edge.b;}
      }
      stats.milliseconds = performance.now() - started;
    },
  };
}
