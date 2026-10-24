import * as THREE from 'three';
import { buildWorld } from './world';
import { initMap } from './map';

// Dev page: builds the world (for the map data), fakes a camera, opens the map.
const q = new URLSearchParams(location.search);
await buildWorld(new THREE.Scene());
const cam = new THREE.PerspectiveCamera();
const [x, z, yaw] = (q.get('at') ?? '4,40,0.6').split(',').map(Number);
cam.position.set(x, 2, z);
cam.rotation.set(0, yaw, 0, 'YXZ');
cam.updateMatrixWorld();
(window as unknown as { __camera: THREE.Camera }).__camera = cam;
initMap();
if (!q.has('closed')) dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }));
setTimeout(() => ((window as unknown as { __done: boolean }).__done = true), 2500);
