// npx tsx tools/trees/heights.ts x,z ... -> ground height, insideness and river distance (for picking screenshot spots)
import * as THREE from 'three';
import { field, fastTerrain } from '../../src/displace';
import { riverAt, insideness } from '../../src/benevento/geo';
const v = new THREE.Vector3();
for (const a of process.argv.slice(2)) {
  const [x, z] = a.split(',').map(Number);
  const r = riverAt(x, z, 200);
  console.log(a, (field(x, 0, z, 'ground', v).y + fastTerrain(x, z)).toFixed(2), 'ins', insideness(x, z).toFixed(2), r ? 'river d=' + r.d.toFixed(0) + ' w=' + r.w + ' lvl=' + r.level.toFixed(1) : '');
}
