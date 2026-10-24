import * as THREE from 'three';
import { getMapData, type Teleport } from './world';

// A hand-drawn map of the town and its surroundings, in the manner of a
// monastic scribe: aged parchment, sepia ink with a trembling hand,
// watercolour washes over the houses. Drawn once to a canvas; a second
// canvas on top carries the pulsing marker of where you stand.

type MapData = ReturnType<typeof getMapData>;

// Region shown: north (-z) up, +x right, metres.
const CX = -2, CZ = 2, HALF = 130;

const INK = '#3b2a1a', INK_SOFT = 'rgba(59,42,26,0.55)', RED = '#8e2216';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let ov: HTMLElement, cv: HTMLCanvasElement, me: HTMLCanvasElement, btn: HTMLElement;
let drawnFor = 0; // css size the base map was drawn at
let open = false;
let raf = 0;
let data: MapData | null = null;

export function initMap(): void {
  ov = document.getElementById('mapov')!;
  cv = document.getElementById('mapcv') as HTMLCanvasElement;
  me = document.getElementById('mapme') as HTMLCanvasElement;
  btn = document.getElementById('mapbtn')!;
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  ov.querySelector('.close')!.addEventListener('click', (e) => { e.stopPropagation(); setOpen(false); });
  // Tap or click outside the sheet closes.
  ov.addEventListener('click', (e) => { if (e.target === ov) setOpen(false); });
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyM' && !e.repeat) toggle();
    else if (e.code === 'Escape' && open) setOpen(false);
  });
  addEventListener('resize', () => { if (open) layout(); });
  if (matchMedia('(pointer: coarse)').matches) ov.querySelector('.hint')!.textContent = 'Tap a gilded mark to travel there · tap outside to close';
  else ov.querySelector('.hint')!.textContent = 'Click a gilded mark to travel there · M or Esc to close';
  // Travel: a tap on (or near) a gilded mark sends you there.
  const sheet = cv.parentElement!;
  sheet.addEventListener('pointermove', (e) => { hover = pickMark(e); sheet.style.cursor = hover ? 'pointer' : ''; });
  sheet.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = pickMark(e);
    if (!t) return;
    const tp = (window as unknown as { __teleport?: (t: Teleport) => void }).__teleport;
    if (tp) { tp(t); setOpen(false); }
  });
}

let hover: Teleport | null = null;
function markXY(t: Teleport, S: number): [number, number] {
  const k = S / (HALF * 2);
  return [(t.x - (CX - HALF)) * k, (t.z - (CZ - HALF)) * k];
}
function pickMark(e: MouseEvent): Teleport | null {
  if (!data) return null;
  const r = me.getBoundingClientRect();
  const px = ((e.clientX - r.left) / r.width) * me.width, py = ((e.clientY - r.top) / r.height) * me.height;
  let best: Teleport | null = null, bd = (me.width * 0.035) ** 2;
  for (const t of data.teleports) {
    const [x, y] = markXY(t, me.width);
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

/** Gilded travel marks: a little gold roundel with a cross, and the place name. */
function drawMarks(ctx: CanvasRenderingContext2D, S: number, t: number) {
  if (!data) return;
  const r = S * 0.011;
  for (const m of data.teleports) {
    const [x, y] = markXY(m, S);
    const h = hover === m;
    const glint = 0.5 + 0.5 * Math.sin(t * 2 + x * 0.05);
    ctx.save();
    ctx.translate(x, y);
    const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * (h ? 1.5 : 1.15));
    g.addColorStop(0, '#fff3c4');
    g.addColorStop(0.45, '#d9a93e');
    g.addColorStop(1, '#7a5418');
    ctx.fillStyle = g;
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, S * 0.0016);
    ctx.beginPath();
    ctx.arc(0, 0, r * (h ? 1.45 : 1.1), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = `rgba(80,40,10,${0.7 + glint * 0.3})`;
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, 0); ctx.lineTo(r * 0.55, 0);
    ctx.moveTo(0, -r * 0.55); ctx.lineTo(0, r * 0.55);
    ctx.stroke();
    if (h || matchMedia('(pointer: coarse)').matches) {
      ctx.font = `italic ${Math.max(10, S * 0.016)}px 'IM Fell English', Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(236,222,190,0.85)';
      ctx.strokeText(m.name, 0, -r * 1.9);
      ctx.fillStyle = h ? RED : INK;
      ctx.fillText(m.name, 0, -r * 1.9);
    }
    ctx.restore();
  }
}

function toggle() { setOpen(!open); }

function setOpen(v: boolean) {
  if (v === open) return;
  open = v;
  ov.classList.toggle('open', v);
  btn.setAttribute('aria-expanded', String(v));
  if (v) {
    if (document.pointerLockElement) document.exitPointerLock();
    layout();
    const tick = () => { drawMarker(); if (open) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
  } else cancelAnimationFrame(raf);
}

/** Size the sheet to the viewport and (re)draw the base map if needed. */
function layout() {
  const size = Math.floor(Math.min(innerWidth * 0.94, innerHeight * 0.86, 1100));
  const sheet = cv.parentElement!;
  sheet.style.width = sheet.style.height = size + 'px';
  const dpr = Math.min(devicePixelRatio || 1, 2);
  for (const c of [cv, me]) {
    c.style.width = c.style.height = size + 'px';
  }
  me.width = me.height = Math.round(size * dpr);
  if (drawnFor !== size) {
    drawnFor = size;
    cv.width = cv.height = Math.round(size * dpr);
    data ??= getMapData();
    const ctx = cv.getContext('2d')!;
    // Fonts first, so the cartouche never falls back.
    Promise.all([
      document.fonts?.load("40px 'UnifrakturMaguntia'"),
      document.fonts?.load("italic 20px 'IM Fell English'"),
      document.fonts?.load("20px 'IM Fell English'"),
    ]).catch(() => {}).finally(() => drawBase(ctx, cv.width, data!));
  }
}

// ------------------------------------------------------------------ drawing

function drawBase(ctx: CanvasRenderingContext2D, S: number, d: MapData) {
  const rnd = seeded(31);
  const k = S / (HALF * 2); // px per metre
  const P = (x: number, z: number): [number, number] => [(x - (CX - HALF)) * k, (z - (CZ - HALF)) * k];
  ctx.clearRect(0, 0, S, S);
  ctx.save();

  // Torn parchment outline: everything is clipped to it.
  const edge = tornEdge(S, rnd);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.0)';
  edge();
  ctx.clip();
  parchment(ctx, S, rnd);

  // Fields and pasture outside the walls: hatched strips, tufts.
  fields(ctx, S, d, P, k, rnd);

  // Washes over the built-up raster.
  houses(ctx, S, d, P, k);

  // The streets get a faint ochre line down the main lanes.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of d.streets) {
    if (!s.main) continue;
    ctx.strokeStyle = 'rgba(150,110,60,0.22)';
    ctx.lineWidth = s.w * k * 0.55;
    wobblyPath(ctx, s.pts.map((p) => P(p.x, p.y)), rnd, 0.6);
    ctx.stroke();
  }

  // Roman road out of the gate, edged with tombs.
  road(ctx, d, P, k, rnd);

  // The aqueduct: a dotted line of little arches.
  aqueduct(ctx, d, P, k);

  // Trees and tombs outside.
  for (const t of d.trees) tree(ctx, ...P(t.x, t.y), k, rnd);
  for (const t of d.tombs) tomb(ctx, ...P(t.x, t.y), k, rnd);

  // The wall: a heavy double ink line with towers.
  wall(ctx, d, P, k, rnd);

  // Landmarks.
  glyphs(ctx, d, P, k, rnd);

  // Fog creeping in from the edges, and the burnt rim.
  fog(ctx, S, rnd);
  ctx.restore();
  burn(ctx, S, edge);

  compass(ctx, S * 0.14, S * 0.84, S * 0.07);
  cartouche(ctx, S * 0.045, S * 0.04, S);
  scaleBar(ctx, S * 0.62, S * 0.93, k, S);
  ctx.restore();
}

/** An irregular, slightly torn rectangle; returns a function that traces it. */
function tornEdge(S: number, rnd: () => number) {
  const pts: [number, number][] = [];
  const m = S * 0.018, n = 60;
  const jag = () => (rnd() - 0.5) * S * 0.012 + (rnd() < 0.06 ? -rnd() * S * 0.018 : 0);
  for (let i = 0; i < n; i++) pts.push([m + (i / n) * (S - 2 * m), m + jag()]);
  for (let i = 0; i < n; i++) pts.push([S - m - jag(), m + (i / n) * (S - 2 * m)]);
  for (let i = 0; i < n; i++) pts.push([S - m - (i / n) * (S - 2 * m), S - m - jag()]);
  for (let i = 0; i < n; i++) pts.push([m + jag(), S - m - (i / n) * (S - 2 * m)]);
  return () => {
    const c = cv.getContext('2d')!;
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
  };
}

function parchment(ctx: CanvasRenderingContext2D, S: number, rnd: () => number) {
  const g = ctx.createRadialGradient(S * 0.45, S * 0.42, S * 0.1, S / 2, S / 2, S * 0.75);
  g.addColorStop(0, '#efe0bc');
  g.addColorStop(0.7, '#e2cc9c');
  g.addColorStop(1, '#c9a96e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // Mottling: noise at a few scales, multiplied in.
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  for (const [res, a] of [[12, 0.14], [40, 0.1], [140, 0.06]] as const) {
    const n = document.createElement('canvas');
    n.width = n.height = res;
    const nc = n.getContext('2d')!;
    const img = nc.createImageData(res, res);
    for (let i = 0; i < res * res; i++) {
      const v = 200 + rnd() * 55;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v * 0.93; img.data[i * 4 + 2] = v * 0.8; img.data[i * 4 + 3] = 255;
    }
    nc.putImageData(img, 0, 0);
    ctx.globalAlpha = a / 0.14 * 0.6;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(n, 0, 0, S, S);
  }
  ctx.globalAlpha = 1;
  // Stains: tea rings and damp blooms.
  for (let i = 0; i < 9; i++) {
    const x = rnd() * S, y = rnd() * S, r = S * (0.03 + rnd() * 0.12);
    const sg = ctx.createRadialGradient(x, y, r * 0.2, x, y, r);
    sg.addColorStop(0, 'rgba(160,120,60,0.0)');
    sg.addColorStop(0.85, `rgba(150,105,50,${0.05 + rnd() * 0.08})`);
    sg.addColorStop(1, 'rgba(150,105,50,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Fibres.
  ctx.strokeStyle = 'rgba(120,90,50,0.08)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 260; i++) {
    const x = rnd() * S, y = rnd() * S, l = S * (0.01 + rnd() * 0.03), a = rnd() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + (rnd() - 0.5) * 4, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.restore();
}

function wobblyPath(ctx: CanvasRenderingContext2D, pts: [number, number][], rnd: () => number, amp = 1, close = false) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => {
    const jx = (rnd() - 0.5) * amp, jy = (rnd() - 0.5) * amp;
    if (i === 0) ctx.moveTo(x + jx, y + jy);
    else {
      const [px, py] = pts[i - 1];
      ctx.quadraticCurveTo((px + x) / 2 + (rnd() - 0.5) * amp, (py + y) / 2 + (rnd() - 0.5) * amp, x + jx, y + jy);
    }
  });
  if (close) ctx.closePath();
}

/** Watercolour washes over houses and precincts, ink contours around blocks, roof hatching. */
function houses(ctx: CanvasRenderingContext2D, S: number, d: MapData, P: (x: number, z: number) => [number, number], k: number) {
  const n = d.n;
  const { house, reserved, street } = d.codes;
  // Smoothed house mask.
  const m = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) m[i] = d.grid[i] === house ? 1 : 0;
  const blur = (src: Float32Array) => {
    const out = new Float32Array(n * n);
    for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
      let s = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) s += src[(j + b) * n + i + a];
      out[j * n + i] = s / 9;
    }
    return out;
  };
  const f = blur(blur(m));

  // Wash layer at raster resolution, scaled up smoothly.
  const wc = document.createElement('canvas');
  wc.width = wc.height = n;
  const wctx = wc.getContext('2d')!;
  const img = wctx.createImageData(n, n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const q = j * n + i, o = q * 4, v = f[q];
    const code = d.grid[q];
    const x = d.min + (i + 0.5) * d.res, z = d.min + (j + 0.5) * d.res;
    // Low-frequency hue drift: terracotta to ochre to umber.
    const t = 0.5 + 0.5 * Math.sin(x * 0.07 + Math.sin(z * 0.05) * 2) * Math.cos(z * 0.06 - x * 0.02);
    if (v > 0.35) {
      const edgePool = 1 - Math.min(1, Math.abs(v - 0.55) * 2.2); // pigment pools at the edges
      img.data[o] = 205 - 25 * t - 30 * edgePool;
      img.data[o + 1] = 140 + 25 * t - 25 * edgePool;
      img.data[o + 2] = 98 + 10 * t - 15 * edgePool;
      img.data[o + 3] = Math.min(170, (v - 0.35) * 500) * (0.7 + 0.3 * edgePool);
    } else if (code === reserved && Math.hypot(x, z) < 95) {
      // Precinct grounds: a pale sage wash.
      img.data[o] = 150; img.data[o + 1] = 160; img.data[o + 2] = 120; img.data[o + 3] = 70;
    } else if (code === street) {
      img.data[o] = 238; img.data[o + 1] = 226; img.data[o + 2] = 196; img.data[o + 3] = 90;
    }
  }
  wctx.putImageData(img, 0, 0);
  const [x0, y0] = P(d.min, d.min);
  const span = n * d.res * k;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(wc, x0, y0, span, span);
  ctx.restore();

  // Ink contours by marching squares on the smoothed mask.
  const c = (i: number, j: number) => f[j * n + i];
  const X = (i: number) => x0 + (i + 0.5) * d.res * k;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = Math.max(0.8, k * 0.2);
  ctx.lineCap = 'round';
  ctx.beginPath();
  const T = 0.5;
  const lerp = (a: number, b: number) => (T - a) / (b - a);
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = c(i, j), b = c(i + 1, j), cc = c(i + 1, j + 1), dd = c(i, j + 1);
    const idx = (a > T ? 1 : 0) | (b > T ? 2 : 0) | (cc > T ? 4 : 0) | (dd > T ? 8 : 0);
    if (idx === 0 || idx === 15) continue;
    const e: [number, number][] = [];
    if ((a > T) !== (b > T)) e.push([X(i + lerp(a, b)), X(j)]);
    if ((b > T) !== (cc > T)) e.push([X(i + 1), X(j + lerp(b, cc))]);
    if ((dd > T) !== (cc > T)) e.push([X(i + lerp(dd, cc)), X(j + 1)]);
    if ((a > T) !== (dd > T)) e.push([X(i), X(j + lerp(a, dd))]);
    for (let q = 0; q + 1 < e.length; q += 2) {
      ctx.moveTo(e[q][0], e[q][1]);
      ctx.lineTo(e[q + 1][0], e[q + 1][1]);
    }
  }
  ctx.stroke();

  // Roof hatching: short strokes scattered inside the blocks, each block-ish
  // patch hatched in its own direction.
  ctx.lineWidth = Math.max(0.6, k * 0.12);
  ctx.globalAlpha = 0.35;
  const rnd = seeded(7);
  ctx.beginPath();
  for (let j = 2; j < n - 2; j += 3) for (let i = 2; i < n - 2; i += 3) {
    if (c(i, j) < 0.85 || rnd() < 0.45) continue;
    const cell = Math.floor(i / 14) * 131 + Math.floor(j / 14);
    const ang = (cell % 2 ? 0.8 : -0.8) + Math.sin(cell) * 0.3;
    const L = k * 1.1;
    const px = X(i), py = X(j);
    ctx.moveTo(px - Math.cos(ang) * L, py - Math.sin(ang) * L);
    ctx.lineTo(px + Math.cos(ang) * L, py + Math.sin(ang) * L);
  }
  ctx.stroke();
  ctx.restore();
  void S;
}

function fields(ctx: CanvasRenderingContext2D, S: number, d: MapData, P: (x: number, z: number) => [number, number], k: number, rnd: () => number) {
  ctx.save();
  // Strip fields in loose patches beyond the walls.
  for (let f = 0; f < 22; f++) {
    const a = rnd() * Math.PI * 2, r = 100 + rnd() * 45;
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    if (Math.abs(x - d.gate.x) < 16 && z > 40) continue;
    const [px, py] = P(x, z);
    const w = (14 + rnd() * 18) * k, h = (10 + rnd() * 14) * k, rot = rnd() * Math.PI;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rot);
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(140,150,90,0.12)' : 'rgba(170,140,80,0.12)';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = 'rgba(80,70,40,0.25)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let y = -h / 2 + 3; y < h / 2; y += Math.max(3, k * 1.6)) {
      ctx.moveTo(-w / 2 + 1, y + (rnd() - 0.5));
      ctx.lineTo(w / 2 - 1, y + (rnd() - 0.5));
    }
    ctx.stroke();
    ctx.restore();
  }
  // Tufts of grass everywhere outside.
  ctx.strokeStyle = 'rgba(70,75,40,0.35)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  for (let i = 0; i < 700; i++) {
    const x = (rnd() - 0.5) * 2 * HALF + CX, z = (rnd() - 0.5) * 2 * HALF + CZ;
    if (insidePoly(x, z, d.wall)) continue;
    const [px, py] = P(x, z);
    const s = k * 0.7;
    ctx.moveTo(px - s, py); ctx.lineTo(px - s * 0.3, py - s * 1.2);
    ctx.moveTo(px, py); ctx.lineTo(px + s * 0.1, py - s * 1.5);
    ctx.moveTo(px + s, py); ctx.lineTo(px + s * 0.4, py - s * 1.1);
  }
  ctx.stroke();
  ctx.restore();
  void S;
}

function insidePoly(x: number, z: number, poly: THREE.Vector2[]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > z) !== (b.y > z) && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function road(ctx: CanvasRenderingContext2D, d: MapData, P: (x: number, z: number) => [number, number], k: number, rnd: () => number) {
  const pts: [number, number][] = [];
  for (let z = d.gate.y; z < CZ + HALF + 5; z += 6) pts.push(P(d.gate.x + Math.sin(z * 0.05) * 2 - Math.sin(d.gate.y * 0.05) * 2, z));
  ctx.save();
  ctx.strokeStyle = 'rgba(200,175,130,0.55)';
  ctx.lineWidth = 4.5 * k;
  ctx.lineCap = 'round';
  wobblyPath(ctx, pts, rnd, 0.8);
  ctx.stroke();
  for (const s of [-1, 1]) {
    ctx.strokeStyle = INK_SOFT;
    ctx.lineWidth = Math.max(0.8, k * 0.2);
    ctx.setLineDash([k * 1.6, k * 1.0]);
    wobblyPath(ctx, pts.map(([x, y]) => [x + s * 2.3 * k, y]), rnd, 0.8);
    ctx.stroke();
  }
  ctx.restore();
  const [lx, ly] = P(d.gate.x + 12, d.gate.y + 34);
  label(ctx, 'Via Sepulcrorum', lx, ly, k * 4.20, Math.PI / 2 - 0.05, true);
}

function aqueduct(ctx: CanvasRenderingContext2D, d: MapData, P: (x: number, z: number) => [number, number], k: number) {
  if (d.aqueduct.length < 2) return;
  const [a, b] = d.aqueduct;
  const [ax, ay] = P(a.x, a.y), [bx, by] = P(b.x, b.y);
  const L = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax);
  ctx.save();
  ctx.translate(ax, ay);
  ctx.rotate(ang);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.8, k * 0.22);
  const bay = 6 * k;
  ctx.beginPath();
  ctx.moveTo(0, -bay * 0.55);
  ctx.lineTo(L, -bay * 0.55);
  ctx.stroke();
  ctx.beginPath();
  for (let x = 0, i = 0; x < L; x += bay, i++) {
    if (i % 12 >= 6 && i % 12 < 9) continue; // fallen spans
    ctx.moveTo(x, 0);
    ctx.arc(x + bay / 2, 0, bay / 2 * 0.9, Math.PI, 0);
  }
  ctx.stroke();
  ctx.restore();
  const [lx, ly] = P(a.x + (b.x - a.x) * 0.22, a.y + (b.y - a.y) * 0.22);
  label(ctx, 'Aquaeductus', lx - 6 * k * Math.sin(ang), ly + 6 * k * Math.cos(ang) + 6 * k, k * 4.55, ang, true);
}

function tree(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, rnd: () => number) {
  const s = k * (1.3 + rnd() * 0.8);
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.7, k * 0.16);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + (rnd() - 0.5) * s * 0.3, y - s * 2);
  for (let i = 0; i < 4; i++) {
    const by = y - s * (0.9 + i * 0.3), dir = i % 2 ? 1 : -1;
    ctx.moveTo(x, by);
    ctx.lineTo(x + dir * s * (0.7 + rnd() * 0.4), by - s * (0.5 + rnd() * 0.3));
  }
  ctx.stroke();
  ctx.fillStyle = 'rgba(59,42,26,0.15)';
  ctx.beginPath();
  ctx.ellipse(x + s * 0.4, y + 1, s * 0.9, s * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function tomb(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, rnd: () => number) {
  const s = k * 1.3;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = 'rgba(235,225,200,0.9)';
  ctx.lineWidth = Math.max(0.7, k * 0.16);
  if (rnd() < 0.5) {
    ctx.beginPath();
    ctx.moveTo(x, y - s * 1.8); ctx.lineTo(x, y + s * 0.4);
    ctx.moveTo(x - s * 0.7, y - s * 1.1); ctx.lineTo(x + s * 0.7, y - s * 1.1);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x - s * 0.6, y + s * 0.4);
    ctx.lineTo(x - s * 0.6, y - s * 1.0);
    ctx.arc(x, y - s * 1.0, s * 0.6, Math.PI, 0);
    ctx.lineTo(x + s * 0.6, y + s * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function wall(ctx: CanvasRenderingContext2D, d: MapData, P: (x: number, z: number) => [number, number], k: number, rnd: () => number) {
  const pts = d.wall.map((p) => P(p.x, p.y));
  // Densify so the wobble reads as hand-drawn.
  const dense: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / (k * 4));
    for (let s = 0; s < steps; s++) dense.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
  }
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = k * 2.6;
  wobblyPath(ctx, dense, rnd, k * 0.25, true);
  ctx.stroke();
  ctx.strokeStyle = '#e4d0a4';
  ctx.lineWidth = k * 1.2;
  wobblyPath(ctx, dense, rnd, k * 0.2, true);
  ctx.stroke();
  // Little crenel ticks along the outside of the inner line.
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.6, k * 0.15);
  ctx.beginPath();
  for (let i = 0; i < dense.length; i += 2) {
    const [x, y] = dense[i], [nx, ny] = dense[(i + 1) % dense.length];
    const ex = nx - x, ey = ny - y, l = Math.hypot(ex, ey) || 1;
    const ox = ey / l, oy = -ex / l;
    ctx.moveTo(x + ox * k * 1.2, y + oy * k * 1.2);
    ctx.lineTo(x + ox * k * 2.2, y + oy * k * 2.2);
  }
  ctx.stroke();
  // Towers at the corners: some round, some square.
  for (let i = 0; i < pts.length; i++) {
    if (rnd() < 0.25) continue;
    const [x, y] = pts[i];
    ctx.fillStyle = '#d9c08e';
    ctx.lineWidth = Math.max(0.9, k * 0.25);
    ctx.beginPath();
    if (rnd() < 0.5) ctx.arc(x, y, k * 2.4, 0, Math.PI * 2);
    else ctx.rect(x - k * 2.2, y - k * 2.2, k * 4.4, k * 4.4);
    ctx.fill();
    ctx.stroke();
  }
  // Gates: an arch drawn over the line.
  for (const g of [d.gate, d.eastGate]) {
    const [x, y] = P(g.x, g.y);
    ctx.fillStyle = '#e8d7ae';
    ctx.beginPath();
    ctx.arc(x, y, k * 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.max(1, k * 0.3);
    ctx.beginPath();
    ctx.moveTo(x - k * 1.6, y + k * 1.4);
    ctx.lineTo(x - k * 1.6, y - k * 0.2);
    ctx.arc(x, y - k * 0.2, k * 1.6, Math.PI, 0);
    ctx.lineTo(x + k * 1.6, y + k * 1.4);
    ctx.stroke();
  }
  ctx.restore();
}

function glyphs(ctx: CanvasRenderingContext2D, d: MapData, P: (x: number, z: number) => [number, number], k: number, rnd: () => number) {
  const L = Object.fromEntries(d.landmarks.map((l) => [l.name, l]));
  const s = k * 2.3;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, k * 0.32);
  ctx.lineJoin = 'round';
  // Basilica: a little church with its apse and a cross.
  if (L.Basilica) {
    const [x, y] = P(L.Basilica.x, L.Basilica.z);
    ctx.fillStyle = '#ead9b0';
    ctx.beginPath();
    ctx.rect(x - s * 2.2, y - s * 1.2, s * 4.4, s * 2.6);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - s * 2.6, y - s * 1.1); ctx.lineTo(x, y - s * 3.0); ctx.lineTo(x + s * 2.6, y - s * 1.1);
    ctx.closePath(); ctx.fillStyle = '#b8714a'; ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y - s * 3.0); ctx.lineTo(x, y - s * 4.4);
    ctx.moveTo(x - s * 0.5, y - s * 3.9); ctx.lineTo(x + s * 0.5, y - s * 3.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - s * 0.5, y + s * 1.4); ctx.lineTo(x - s * 0.5, y + s * 0.4);
    ctx.arc(x, y + s * 0.4, s * 0.5, Math.PI, 0); ctx.lineTo(x + s * 0.5, y + s * 1.4);
    ctx.stroke();
    label(ctx, 'Basilica', x + s * 3.2, y - s * 0.2, k * 4.73, -0.04);
  }
  if (L.Atrium) {
    const [x, y] = P(L.Atrium.x, L.Atrium.z);
    label(ctx, 'Atrium', x + s * 3.5, y + s * 0.6, k * 3.68, 0.03, true);
  }
  // Ossuarium: a tiny skull.
  if (L.Ossuarium) {
    const [x, y] = P(L.Ossuarium.x, L.Ossuarium.z);
    ctx.fillStyle = '#efe4c8';
    ctx.beginPath();
    ctx.arc(x, y - s * 0.3, s * 1.1, Math.PI * 0.85, Math.PI * 2.15);
    ctx.lineTo(x + s * 0.6, y + s * 0.9);
    ctx.lineTo(x - s * 0.6, y + s * 0.9);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = INK;
    for (const dx of [-0.42, 0.42]) { ctx.beginPath(); ctx.arc(x + dx * s, y - s * 0.2, s * 0.28, 0, Math.PI * 2); ctx.fill(); }
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.15); ctx.lineTo(x - s * 0.12, y + s * 0.45); ctx.lineTo(x + s * 0.12, y + s * 0.45); ctx.fill();
    label(ctx, 'Ossuarium', x - s * 1.6, y + s * 2.9, k * 3.85, 0.02, true, 'right');
  }
  // Templum: pediment on little columns.
  if (L.Templum) {
    const [x, y] = P(L.Templum.x, L.Templum.z);
    ctx.fillStyle = '#efe3c4';
    ctx.beginPath();
    ctx.moveTo(x - s * 2.4, y - s * 1.2); ctx.lineTo(x, y - s * 2.4); ctx.lineTo(x + s * 2.4, y - s * 1.2); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const cx = x - s * 1.9 + i * s * 0.95;
      if (i === 3) { ctx.moveTo(cx, y + s * 1.3); ctx.lineTo(cx, y + s * 0.1); continue; } // a broken one
      ctx.moveTo(cx, y + s * 1.3); ctx.lineTo(cx, y - s * 1.2);
    }
    ctx.moveTo(x - s * 2.5, y + s * 1.35); ctx.lineTo(x + s * 2.5, y + s * 1.35);
    ctx.stroke();
    label(ctx, 'Templum Vetus', x, y + s * 3.4, k * 4.20, -0.03, false, 'center');
  }
  // Arcus: a lone arch across the lane.
  if (L.Arcus) {
    const [x, y] = P(L.Arcus.x, L.Arcus.z);
    ctx.fillStyle = '#efe3c4';
    ctx.beginPath();
    ctx.moveTo(x - s * 1.6, y + s * 1.1); ctx.lineTo(x - s * 1.6, y - s * 1.5); ctx.lineTo(x + s * 1.6, y - s * 1.5); ctx.lineTo(x + s * 1.6, y + s * 1.1);
    ctx.lineTo(x + s * 0.7, y + s * 1.1); ctx.lineTo(x + s * 0.7, y - s * 0.1);
    ctx.arc(x, y - s * 0.1, s * 0.7, 0, Math.PI, true);
    ctx.lineTo(x - s * 0.7, y + s * 1.1); ctx.closePath();
    ctx.fill(); ctx.stroke();
    label(ctx, 'Arcus', x + s * 2.2, y + s * 0.3, k * 3.85, 0.05, true);
  }
  if (L.Porta) {
    const [x, y] = P(L.Porta.x, L.Porta.z);
    label(ctx, 'Porta', x + s * 2.8, y + s * 2.2, k * 4.20, 0.04);
  }
  // Area names, large and faint.
  ctx.globalAlpha = 0.55;
  const [cx, cy] = P(30, 40);
  label(ctx, 'Civitas', cx, cy, k * 7.35, -0.12, false, 'center');
  const [ex, ey] = P(-95, 40);
  label(ctx, 'Extra Muros', ex, ey, k * 5.25, 0.1, true, 'center');
  ctx.restore();
  void rnd;
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, rot = 0, italic = false, align: CanvasTextAlign = 'left') {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.font = `${italic ? 'italic ' : ''}${Math.max(9, size)}px 'IM Fell English', Georgia, serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  // A halo of paper so labels stay legible over the washes.
  ctx.lineWidth = Math.max(2, size * 0.28);
  ctx.strokeStyle = 'rgba(236,222,190,0.75)';
  ctx.lineJoin = 'round';
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = INK;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function fog(ctx: CanvasRenderingContext2D, S: number, rnd: () => number) {
  ctx.save();
  for (let i = 0; i < 26; i++) {
    // Blobs hugging the edges.
    const side = i % 4;
    const t = rnd();
    const x = side === 0 ? t * S : side === 1 ? S - rnd() * S * 0.08 : side === 2 ? t * S : rnd() * S * 0.08;
    const y = side === 0 ? rnd() * S * 0.08 : side === 2 ? S - rnd() * S * 0.08 : t * S;
    const r = S * (0.06 + rnd() * 0.1);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(225,222,212,0.35)');
    g.addColorStop(1, 'rgba(225,222,212,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function burn(ctx: CanvasRenderingContext2D, S: number, edge: () => void) {
  ctx.save();
  edge();
  ctx.clip();
  // Darkened, scorched rim inside the torn edge.
  for (let i = 0; i < 6; i++) {
    edge();
    ctx.strokeStyle = `rgba(90,52,20,${0.16 - i * 0.022})`;
    ctx.lineWidth = S * (0.004 + i * 0.008);
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.38, S / 2, S / 2, S * 0.74);
  g.addColorStop(0, 'rgba(120,80,30,0)');
  g.addColorStop(1, 'rgba(110,70,25,0.35)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.restore();
  ctx.save();
  edge();
  ctx.strokeStyle = 'rgba(50,30,12,0.9)';
  ctx.lineWidth = Math.max(1, S * 0.0015);
  ctx.stroke();
  ctx.restore();
}

function compass(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.8, r * 0.025);
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.56, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const long = i % 2 === 0;
    const L = r * (long ? 1 : 0.6), w = r * (long ? 0.14 : 0.09);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * L, Math.sin(a) * L);
      ctx.lineTo(Math.cos(a + side * Math.PI / 2) * w, Math.sin(a + side * Math.PI / 2) * w);
      ctx.closePath();
      ctx.fillStyle = side > 0 ? (i === 0 ? RED : INK) : '#ead8ad';
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.font = `${Math.max(9, r * 0.26)}px 'IM Fell English', Georgia, serif`;
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Septentrio', 0, -r * 1.3);
  ctx.font = `${Math.max(8, r * 0.2)}px 'IM Fell English', Georgia, serif`;
  ctx.fillText('Meridies', 0, r * 1.25);
  ctx.save(); ctx.rotate(Math.PI / 2); ctx.fillText('Oriens', 0, -r * 1.25); ctx.restore();
  ctx.save(); ctx.rotate(-Math.PI / 2); ctx.fillText('Occidens', 0, -r * 1.25); ctx.restore();
  ctx.restore();
}

function cartouche(ctx: CanvasRenderingContext2D, x: number, y: number, S: number) {
  const w = S * 0.32, h = S * 0.1;
  ctx.save();
  ctx.translate(x, y);
  // Scroll body with curled ends.
  ctx.fillStyle = '#f0e2bf';
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, S * 0.0018);
  ctx.beginPath();
  ctx.moveTo(h * 0.25, 0);
  ctx.quadraticCurveTo(w / 2, h * 0.12, w - h * 0.25, 0);
  ctx.lineTo(w - h * 0.25, h);
  ctx.quadraticCurveTo(w / 2, h * 1.12, h * 0.25, h);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (const ex of [h * 0.25, w - h * 0.25]) {
    ctx.beginPath();
    ctx.ellipse(ex, h / 2, h * 0.16, h * 0.52, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#d9c391';
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(ex, h / 2, h * 0.07, h * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${h * 0.48}px 'UnifrakturMaguntia', serif`;
  ctx.fillText('Civitas', w / 2, h * 0.42);
  ctx.font = `italic ${h * 0.19}px 'IM Fell English', Georgia, serif`;
  ctx.fillStyle = RED;
  ctx.fillText('Anno Domini DCCXXVII', w / 2, h * 0.8);
  ctx.restore();
}

function scaleBar(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, S: number) {
  // Roman paces (passus, ~1.48 m).
  const passus = 1.48, n = 4, per = 5;
  const seg = per * passus * k;
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.8, S * 0.0013);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 ? '#ead8ad' : INK;
    ctx.fillRect(i * seg, 0, seg, S * 0.006);
    ctx.strokeRect(i * seg, 0, seg, S * 0.006);
  }
  ctx.font = `italic ${Math.max(9, S * 0.016)}px 'IM Fell English', Georgia, serif`;
  ctx.fillStyle = INK;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(`passus ${n * per}`, 0, S * 0.012);
  ctx.restore();
}

// ------------------------------------------------------------------ marker

const dir = new THREE.Vector3();
function drawMarker() {
  const ctx = me.getContext('2d')!;
  const S = me.width;
  ctx.clearRect(0, 0, S, S);
  drawMarks(ctx, S, performance.now() / 1000);
  const cam = (window as unknown as { __camera?: THREE.Camera }).__camera;
  if (!cam) return;
  const k = S / (HALF * 2);
  let x = (cam.position.x - (CX - HALF)) * k, y = (cam.position.z - (CZ - HALF)) * k;
  const m = S * 0.04;
  const off = x < m || y < m || x > S - m || y > S - m;
  x = Math.min(S - m, Math.max(m, x));
  y = Math.min(S - m, Math.max(m, y));
  cam.getWorldDirection(dir);
  const ang = Math.atan2(dir.z, dir.x);
  const t = performance.now() / 1000;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
  const r = S * 0.012;
  ctx.save();
  ctx.translate(x, y);
  // Pulsing ink-red halo.
  ctx.strokeStyle = `rgba(142,34,22,${0.55 - pulse * 0.4})`;
  ctx.lineWidth = Math.max(1, S * 0.002);
  ctx.beginPath();
  ctx.arc(0, 0, r * (1.6 + pulse * 1.4), 0, Math.PI * 2);
  ctx.stroke();
  // A little quill-tipped arrowhead along the view direction.
  ctx.rotate(ang);
  ctx.fillStyle = RED;
  ctx.strokeStyle = '#2a120a';
  ctx.lineWidth = Math.max(0.8, S * 0.0012);
  ctx.beginPath();
  ctx.moveTo(r * 2.0, 0);
  ctx.quadraticCurveTo(r * 0.2, -r * 0.35, -r * 1.1, -r * 1.0);
  ctx.quadraticCurveTo(-r * 0.55, 0, -r * 1.1, r * 1.0);
  ctx.quadraticCurveTo(r * 0.2, r * 0.35, r * 2.0, 0);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-r * 0.6, 0);
  ctx.lineTo(r * 1.4, 0);
  ctx.strokeStyle = 'rgba(255,230,200,0.6)';
  ctx.stroke();
  ctx.restore();
  if (!off) {
    ctx.font = `italic ${Math.max(10, S * 0.017)}px 'IM Fell English', Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(236,222,190,0.8)';
    ctx.strokeText('hic es', x, y + r * 3.8);
    ctx.fillStyle = RED;
    ctx.fillText('hic es', x, y + r * 3.8);
  }
}
