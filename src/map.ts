import * as THREE from 'three';
import { getMapData, type Teleport } from './world';
import { discovered } from './benevento/secrets';

// A hand-drawn map of the town and its surroundings, in the manner of a
// monastic scribe: aged parchment, sepia ink with a trembling hand,
// watercolour washes over the houses. Drawn once to a canvas; a second
// canvas on top carries the pulsing marker of where you stand.

type MapData = ReturnType<typeof getMapData>;

// Region shown: north (-z) up, +x right, metres.
const CX = -70, CZ = -60, HALF = 820;

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
  const r = S * 0.008;
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
    if (h) {
      ctx.font = `italic ${Math.max(11, S * 0.017)}px 'IM Fell English', Georgia, serif`;
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
  const edge = tornEdge(S, rnd);
  ctx.save();
  edge();
  ctx.clip();
  parchment(ctx, S, rnd);
  fields(ctx, d, P, k, rnd);
  rivers(ctx, d, P, k, rnd);
  roads(ctx, d, P, k, rnd);
  plots(ctx, d, P, k);
  houses(ctx, d, P, k);
  for (let i = 0; i < d.trees.length; i += 2) tree(ctx, ...P(d.trees[i].x, d.trees[i].y), Math.max(k, 0.6) * 2.2, rnd);
  wall(ctx, d, P, k, rnd);
  glyphs(ctx, d, P, k, rnd);
  fog(ctx, S, rnd);
  ctx.restore();
  burn(ctx, S, edge);
  compass(ctx, S * 0.12, S * 0.86, S * 0.065);
  cartouche(ctx, S * 0.045, S * 0.04, S);
  scaleBar(ctx, S * 0.6, S * 0.93, k, S);
  ctx.restore();
}

/** Watercolour washes over the houses (the town raster, at 2 m), ink round the blocks. */
function houses(ctx: CanvasRenderingContext2D, d: MapData, P: (x: number, z: number) => [number, number], k: number) {
  const r = d.raster, STEP = 4; // raster cells per map cell (2 m)
  const n = Math.floor(r.nx / STEP), m = Math.floor(r.nz / STEP);
  const f = new Float32Array(n * m), st = new Float32Array(n * m);
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
    let h = 0, s = 0;
    for (let b = 0; b < STEP; b++) for (let a = 0; a < STEP; a++) {
      const v = r.grid[(j * STEP + b) * r.nx + i * STEP + a];
      if (v === d.codes.house) h++; else if (v === d.codes.street) s++;
    }
    f[j * n + i] = h / (STEP * STEP); st[j * n + i] = s / (STEP * STEP);
  }
  const wc = document.createElement('canvas');
  wc.width = n; wc.height = m;
  const wctx = wc.getContext('2d')!;
  const img = wctx.createImageData(n, m);
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
    const q = j * n + i, o = q * 4, v = f[q];
    const x = r.x0 + (i + 0.5) * STEP * r.res, z = r.z0 + (j + 0.5) * STEP * r.res;
    const t = 0.5 + 0.5 * Math.sin(x * 0.02 + Math.sin(z * 0.015) * 2) * Math.cos(z * 0.018 - x * 0.006);
    if (v > 0.3) {
      img.data[o] = 200 - 25 * t; img.data[o + 1] = 135 + 25 * t; img.data[o + 2] = 95 + 10 * t; img.data[o + 3] = Math.min(190, v * 260);
    } else if (st[q] > 0.4) {
      img.data[o] = 240; img.data[o + 1] = 228; img.data[o + 2] = 198; img.data[o + 3] = 110;
    }
  }
  wctx.putImageData(img, 0, 0);
  const [x0, y0] = P(r.x0, r.z0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(wc, x0, y0, n * STEP * r.res * k, m * STEP * r.res * k);
  ctx.restore();
}

/** Gardens, vines, pens and ruins inside the walls: hatched patches with a pale wash. */
function plots(ctx: CanvasRenderingContext2D, d: MapData, P: (x: number, z: number) => [number, number], k: number) {
  const fill: Record<string, string> = { orto: 'rgba(120,150,70,0.22)', vinea: 'rgba(110,80,110,0.18)', pratum: 'rgba(140,160,90,0.16)', ruina: 'rgba(120,110,95,0.22)', stabulum: 'rgba(160,130,80,0.2)' };
  ctx.save();
  for (const p of d.plots) {
    ctx.beginPath();
    p.pts.forEach(([x, z], i) => { const [a, b] = P(x, z); if (i) ctx.lineTo(a, b); else ctx.moveTo(a, b); });
    ctx.closePath();
    ctx.fillStyle = fill[p.kind] ?? 'rgba(140,160,90,0.15)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,60,40,0.3)';
    ctx.lineWidth = Math.max(0.5, k * 0.25);
    ctx.stroke();
  }
  ctx.restore();
}

/** Fields and meadows round the town: strips in loose patches, tufts of grass. */
function fields(ctx: CanvasRenderingContext2D, d: MapData, P: (x: number, z: number) => [number, number], k: number, rnd: () => number) {
  ctx.save();
  for (let f = 0; f < 70; f++) {
    const x = CX - HALF + rnd() * HALF * 2, z = CZ - HALF + rnd() * HALF * 2;
    if (insidePoly(x, z, d.wall)) continue;
    const [px, py] = P(x, z);
    const w = (40 + rnd() * 60) * k, h = (25 + rnd() * 40) * k, rot = rnd() * Math.PI;
    ctx.save();
    ctx.translate(px, py); ctx.rotate(rot);
    ctx.fillStyle = rnd() < 0.5 ? 'rgba(140,150,90,0.1)' : 'rgba(170,140,80,0.1)';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeStyle = 'rgba(80,70,40,0.18)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let y = -h / 2 + 2; y < h / 2; y += Math.max(2.5, k * 5)) { ctx.moveTo(-w / 2 + 1, y); ctx.lineTo(w / 2 - 1, y); }
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** The two rivers: a grey-green wash between trembling banks. */
function rivers(ctx: CanvasRenderingContext2D, d: MapData, P: (x: number, z: number) => [number, number], k: number, rnd: () => number) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const r of d.rivers) {
    const pts = r.pts.map(([x, z]) => P(x, z));
    ctx.strokeStyle = 'rgba(110,130,125,0.45)';
    ctx.lineWidth = r.w * k * 1.2;
    wobblyPath(ctx, pts, rnd, 0.5); ctx.stroke();
    ctx.strokeStyle = INK_SOFT;
    ctx.lineWidth = Math.max(0.6, k * 0.6);
    for (const s of [-1, 1]) {
      const side = r.pts.map(([x, z], i) => {
        const a = r.pts[Math.max(0, i - 1)], b = r.pts[Math.min(r.pts.length - 1, i + 1)];
        const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
        return P(x - (dz / l) * s * r.w * 0.6, z + (dx / l) * s * r.w * 0.6);
      });
      wobblyPath(ctx, side, rnd, 0.6); ctx.stroke();
    }
    const mid = r.pts[Math.floor(r.pts.length * 0.35)], nx = r.pts[Math.floor(r.pts.length * 0.35) + 3];
    const [lx, ly] = P(mid[0], mid[1]);
    label(ctx, r.name === 'Calor' ? 'Calor fluvius' : 'Sabbatus fluvius', lx, ly - r.w * k, Math.max(10, k * 22), Math.atan2(nx[1] - mid[1], nx[0] - mid[0]), true, 'center');
  }
  ctx.restore();
}

function roads(ctx: CanvasRenderingContext2D, d: MapData, P: (x: number, z: number) => [number, number], k: number, rnd: () => number) {
  ctx.save();
  ctx.lineCap = 'round';
  for (const r of d.roads) {
    const pts = r.pts.map(([x, z]) => P(x, z));
    ctx.strokeStyle = 'rgba(200,175,130,0.55)';
    ctx.lineWidth = Math.max(1.5, r.w * k * 1.3);
    wobblyPath(ctx, pts, rnd, 0.5); ctx.stroke();
    if (r.w >= 2.8) {
      ctx.strokeStyle = INK_SOFT; ctx.lineWidth = Math.max(0.5, k * 0.4);
      ctx.setLineDash([3, 2]);
      wobblyPath(ctx, pts, rnd, 0.5); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (r.name.startsWith('Via') && r.pts.length > 3) {
      const i = Math.floor(r.pts.length / 2), a = r.pts[i], b = r.pts[i + 1];
      const [lx, ly] = P(a[0], a[1]);
      label(ctx, r.name, lx, ly - 10, Math.max(9, k * 16), Math.atan2(b[1] - a[1], b[0] - a[0]), true, 'center');
    }
  }
  ctx.restore();
}

function insidePoly(x: number, z: number, poly: [number, number][]) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

function wall(ctx: CanvasRenderingContext2D, d: MapData, P: (x: number, z: number) => [number, number], k: number, rnd: () => number) {
  const pts = d.wall.map(([x, z]) => P(x, z));
  const dense: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const steps = Math.ceil(Math.hypot(bx - ax, by - ay) / 6);
    for (let s = 0; s < steps; s++) dense.push([ax + ((bx - ax) * s) / steps, ay + ((by - ay) * s) / steps]);
  }
  const w = Math.max(2.2, k * 5);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = w;
  wobblyPath(ctx, dense, rnd, 0.6, true); ctx.stroke();
  ctx.strokeStyle = '#e4d0a4'; ctx.lineWidth = w * 0.45;
  wobblyPath(ctx, dense, rnd, 0.4, true); ctx.stroke();
  // Towers along the circuit.
  let acc = 0;
  for (let i = 0; i < dense.length; i++) {
    const [x, y] = dense[i], [nx, ny] = dense[(i + 1) % dense.length];
    acc += Math.hypot(nx - x, ny - y);
    if (acc < 45 * k) continue;
    acc = 0;
    ctx.fillStyle = '#d9c08e'; ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.8, k * 0.6);
    ctx.beginPath();
    if (rnd() < 0.5) ctx.arc(x, y, w * 0.9, 0, Math.PI * 2); else ctx.rect(x - w * 0.8, y - w * 0.8, w * 1.6, w * 1.6);
    ctx.fill(); ctx.stroke();
  }
  for (const g of d.gates) {
    const [x, y] = P(g.at[0], g.at[1]);
    ctx.fillStyle = '#e8d7ae';
    ctx.beginPath(); ctx.arc(x, y, w * 1.2, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = Math.max(1, k * 0.8); ctx.strokeStyle = INK;
    ctx.beginPath();
    ctx.moveTo(x - w * 0.7, y + w * 0.6); ctx.lineTo(x - w * 0.7, y - w * 0.1);
    ctx.arc(x, y - w * 0.1, w * 0.7, Math.PI, 0); ctx.lineTo(x + w * 0.7, y + w * 0.6);
    ctx.stroke();
    label(ctx, g.name, x, y + w * 2.4, Math.max(9, k * 14), 0, true, 'center');
  }
  ctx.restore();
}

/** Landmark glyphs and names; discovered writings get a red dot. */
function glyphs(ctx: CanvasRenderingContext2D, d: MapData, P: (x: number, z: number) => [number, number], k: number, rnd: () => number) {
  const s = Math.max(3.2, k * 7);
  const sz = Math.max(10, k * 17);
  ctx.save();
  ctx.strokeStyle = INK; ctx.lineWidth = Math.max(0.9, k * 1.1); ctx.lineJoin = 'round';
  const church = (x: number, y: number) => {
    ctx.fillStyle = '#ead9b0';
    ctx.beginPath(); ctx.rect(x - s * 1.6, y - s * 0.8, s * 3.2, s * 1.8); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s * 1.9, y - s * 0.7); ctx.lineTo(x, y - s * 2.1); ctx.lineTo(x + s * 1.9, y - s * 0.7); ctx.closePath();
    ctx.fillStyle = '#b8714a'; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - s * 2.1); ctx.lineTo(x, y - s * 3.1); ctx.moveTo(x - s * 0.4, y - s * 2.7); ctx.lineTo(x + s * 0.4, y - s * 2.7); ctx.stroke();
  };
  const ring = (x: number, y: number, rx: number, ry: number, half = false) => {
    ctx.fillStyle = 'rgba(234,217,176,0.8)';
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, half ? -Math.PI / 2 : 0, half ? Math.PI / 2 : Math.PI * 2); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x, y, rx * 0.55, ry * 0.5, 0, half ? -Math.PI / 2 : 0, half ? Math.PI / 2 : Math.PI * 2); ctx.stroke();
  };
  const arch = (x: number, y: number) => {
    ctx.fillStyle = '#efe3c4';
    ctx.beginPath();
    ctx.moveTo(x - s, y + s * 0.8); ctx.lineTo(x - s, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y + s * 0.8);
    ctx.lineTo(x + s * 0.45, y + s * 0.8); ctx.lineTo(x + s * 0.45, y); ctx.arc(x, y, s * 0.45, 0, Math.PI, true); ctx.lineTo(x - s * 0.45, y + s * 0.8); ctx.closePath();
    ctx.fill(); ctx.stroke();
  };
  const tower = (x: number, y: number) => {
    ctx.fillStyle = '#d9c08e';
    ctx.beginPath(); ctx.rect(x - s * 0.7, y - s * 1.6, s * 1.4, s * 2.4); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s * 0.9, y - s * 1.6); ctx.lineTo(x, y - s * 2.4); ctx.lineTo(x + s * 0.9, y - s * 1.6); ctx.closePath(); ctx.fillStyle = '#b8714a'; ctx.fill(); ctx.stroke();
  };
  const mark = (name: string, draw: (x: number, y: number) => void, text = name, dx = 0, dy = 2.4) => {
    const l = d.landmarks.find((q) => q.name === name);
    if (!l) return;
    const [x, y] = P(l.x, l.z);
    draw(x, y);
    label(ctx, text, x + dx * s, y + dy * s, sz, 0, false, 'center');
  };
  mark('Curtis Ducis', tower, 'Curtis Ducis');
  mark('Episcopium', church, 'S. Maria · Episcopium');
  mark('Sanctus Modestus', church, 'S. Modestus', 3, 2.4);
  mark('Sanctus Petrus ad Forum', church, 'S. Petrus ad Forum · Sepulcra', -5, -3);
  mark('Sanctus Petrus extra muros', church, 'S. Petrus');
  mark('Sanctus Hilarius ad Portam Auream', church, 'S. Hilarius', 0, 2.2);
  mark('Theatrum', (x, y) => ring(x, y, 44 * k, 44 * k, true));
  mark('Amphitheatrum', (x, y) => ring(x, y, 48 * k, 38 * k), 'Amphitheatrum');
  mark('Porta Aurea', arch, 'Porta Aurea', 0, -1.6);
  mark('Arcus Sacramenti', arch, 'Arcus', 0, -1.6);
  mark('Turris Catenae', tower);
  mark('Sancti Quadraginta', (x, y) => { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x, y, s * 0.5, 0, Math.PI * 2); ctx.fill(); }, 'SS. Quadraginta');
  mark('Thermae', (x, y) => { ctx.fillStyle = '#efe3c4'; ctx.beginPath(); ctx.arc(x, y, s, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke(); });
  mark('Forum', (x, y) => { ctx.beginPath(); for (let i = 0; i < 4; i++) { ctx.moveTo(x - s + i * s * 0.66, y + s * 0.7); ctx.lineTo(x - s + i * s * 0.66, y - s * 0.7); } ctx.stroke(); });
  mark('Iseum', (x, y) => { ctx.fillStyle = '#c99a7a'; ctx.beginPath(); ctx.moveTo(x - s * 0.3, y + s); ctx.lineTo(x - s * 0.2, y - s * 1.4); ctx.lineTo(x, y - s * 1.8); ctx.lineTo(x + s * 0.2, y - s * 1.4); ctx.lineTo(x + s * 0.3, y + s); ctx.closePath(); ctx.fill(); ctx.stroke(); });
  mark('Coemeterium Langobardorum', (x, y) => { ctx.beginPath(); for (let i = -1; i <= 1; i++) { ctx.moveTo(x + i * s * 0.8, y + s); ctx.lineTo(x + i * s * 0.8, y - s * 1.4); } ctx.stroke(); }, 'Coemeterium');
  mark('Nux Sacra', (x, y) => tree(ctx, x, y + s, s * 0.6, rnd), 'Nux');
  mark('Molendinum', (x, y) => { ctx.beginPath(); ctx.arc(x, y, s * 0.8, 0, Math.PI * 2); for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * s * 0.8, y + Math.sin(a) * s * 0.8); } ctx.stroke(); });
  mark('Pons Leprosus', () => {}, 'Pons Leprosus');
  // Quarters, large and faint.
  ctx.globalAlpha = 0.5;
  for (const q of d.districts) {
    if (!['curtis', 'platea', 'insulaeOccidentales', 'hortiSeptentrionales', 'ripaSabbati'].includes(q.id)) continue;
    const [x, y] = P(q.center[0], q.center[1]);
    label(ctx, q.name, x, y + s * 4, sz * 1.15, -0.06, true, 'center');
  }
  ctx.globalAlpha = 1;
  // Houses one can enter: a little door; found writings: a red dot.
  const found = discovered();
  for (const e of d.explorables) {
    const [x, y] = P(e.x, e.z);
    ctx.fillStyle = found.has(e.id) ? RED : 'rgba(59,42,26,0.6)';
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.8, s * 0.32), 0, Math.PI * 2); ctx.fill();
  }
  for (const r of d.readables) {
    if (!found.has(r.id)) continue;
    const [x, y] = P(r.x, r.z);
    ctx.fillStyle = RED;
    ctx.beginPath(); ctx.arc(x, y, Math.max(1.5, s * 0.25), 0, Math.PI * 2); ctx.fill();
  }
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
  ctx.fillText('Beneventum', w / 2, h * 0.42);
  ctx.font = `italic ${h * 0.19}px 'IM Fell English', Georgia, serif`;
  ctx.fillStyle = RED;
  ctx.fillText('Anno Domini DCC', w / 2, h * 0.8);
  ctx.restore();
}

function scaleBar(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, S: number) {
  // Roman paces (passus, ~1.48 m).
  const passus = 1.48, n = 4, per = 50;
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
