import type * as THREE from 'three';

// Frame profiler and the ?debug HUD. The timers are a handful of
// performance.now() calls per frame and always run (benchmarks read them
// through window.__perf); the HUD itself is only built with ?debug.
//
//   const t = perfT(); ...work...; perfAdd('npc', t);
//
// The HUD shows, averaged over half a second: fps and frame interval (mean /
// worst), the CPU time of each system inside the frame (JS only: the GPU runs
// asynchronously; 'render' is the time to submit the frame), the GPU time when
// the browser exposes a timer query (desktop Chrome; not iOS Safari), draw
// calls and triangles, GPU textures / geometries, the internal resolution
// scale, chunks built, and the JS heap where the browser reports it.

const sums: Record<string, number> = {};
const last: Record<string, number> = {};
let frames = 0, frameSum = 0, frameMax = 0, lastFrameAt = 0, windowStart = 0;
const order: string[] = [];

export const perfT = () => performance.now();
export function perfAdd(name: string, t0: number) {
  const d = performance.now() - t0;
  if (!(name in sums)) { sums[name] = 0; order.push(name); }
  sums[name] += d;
}

export interface PerfInfo { calls: number; tris: number; textures: number; geometries: number; ratio: number; chunks: number; extra?: string }
/** Snapshot of the last half-second window (for benchmarks and the HUD). */
export const perfStats = { fps: 0, frameMs: 0, frameMax: 0, cpu: {} as Record<string, number>, cpuTotal: 0, gpuMs: -1, calls: 0, tris: 0, textures: 0, geometries: 0, ratio: 1, chunks: 0, heapMB: -1, objects: 0 };

let hud: HTMLDivElement | null = null;
let gl: WebGL2RenderingContext | null = null;
let tq: { ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }; pending: WebGLQuery[]; active: WebGLQuery | null; sum: number; n: number } | null = null;
let scene: THREE.Object3D | null = null;
let objTimer = 0;

export function initHud(renderer: THREE.WebGLRenderer, sceneRoot: THREE.Object3D) {
  scene = sceneRoot;
  hud = document.createElement('div');
  hud.id = 'perfhud';
  Object.assign(hud.style, {
    position: 'fixed', left: 'max(6px, env(safe-area-inset-left, 0px))', top: 'max(6px, env(safe-area-inset-top, 0px))', zIndex: '20',
    font: '10px/1.3 ui-monospace, Menlo, monospace', color: '#cfe8c8', background: 'rgba(0,0,0,0.55)', padding: '3px 5px',
    borderRadius: '3px', pointerEvents: 'none', whiteSpace: 'pre', maxWidth: '62vw', overflow: 'hidden',
  });
  document.body.appendChild(hud);
  gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (ext) tq = { ext, pending: [], active: null, sum: 0, n: 0 };
}

/** Around the frame's GPU work (only when a timer query exists). */
export function gpuBegin() {
  if (!tq || !gl || tq.active) return;
  const q = gl.createQuery();
  if (!q) return;
  gl.beginQuery(tq.ext.TIME_ELAPSED_EXT, q);
  tq.active = q;
}
export function gpuEnd() {
  if (!tq || !gl || !tq.active) return;
  gl.endQuery(tq.ext.TIME_ELAPSED_EXT);
  tq.pending.push(tq.active);
  tq.active = null;
  const disjoint = gl.getParameter(tq.ext.GPU_DISJOINT_EXT);
  while (tq.pending.length) {
    const q = tq.pending[0];
    if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
    tq.pending.shift();
    if (!disjoint) { tq.sum += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; tq.n++; }
    gl.deleteQuery(q);
  }
}

/** Call once at the end of every frame. */
export function perfFrame(info: PerfInfo) {
  const now = performance.now();
  if (lastFrameAt) { const d = now - lastFrameAt; frameSum += d; frameMax = Math.max(frameMax, d); }
  lastFrameAt = now;
  frames++;
  for (const k of order) last[k] = sums[k];
  if (!windowStart) windowStart = now;
  if (now - windowStart < 500) return;
  const n = Math.max(1, frames);
  perfStats.fps = (frames * 1000) / (now - windowStart);
  perfStats.frameMs = frameSum / Math.max(1, frames - 1);
  perfStats.frameMax = frameMax;
  let tot = 0;
  for (const k of order) { perfStats.cpu[k] = sums[k] / n; tot += sums[k] / n; sums[k] = 0; }
  perfStats.cpuTotal = tot;
  if (tq && tq.n) { perfStats.gpuMs = tq.sum / tq.n; tq.sum = 0; tq.n = 0; }
  Object.assign(perfStats, { calls: info.calls, tris: info.tris, textures: info.textures, geometries: info.geometries, ratio: info.ratio, chunks: info.chunks });
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  perfStats.heapMB = mem ? mem.usedJSHeapSize / 1048576 : -1;
  frames = 0; frameSum = 0; frameMax = 0; windowStart = now;
  if (!hud) return;
  if (scene && (objTimer++ % 4) === 0) { let c = 0; scene.traverse(() => { c++; }); perfStats.objects = c; }
  const s = perfStats;
  const cpu = order.map((k) => `${k} ${s.cpu[k].toFixed(1)}`).join(' · ');
  hud.textContent =
    `${s.fps.toFixed(0)} fps  ${s.frameMs.toFixed(1)} ms (max ${s.frameMax.toFixed(0)})` + (s.gpuMs >= 0 ? `  gpu ${s.gpuMs.toFixed(1)} ms` : '') + '\n' +
    `cpu ${s.cpuTotal.toFixed(1)} ms: ${cpu}\n` +
    `${s.calls} calls · ${(s.tris / 1000).toFixed(0)}k tris · res ×${s.ratio.toFixed(2)}\n` +
    `tex ${s.textures} · geo ${s.geometries} · obj ${s.objects} · chunks ${s.chunks}` + (s.heapMB >= 0 ? ` · heap ${s.heapMB.toFixed(0)} MB` : '') +
    (info.extra ? '\n' + info.extra : '');
}
