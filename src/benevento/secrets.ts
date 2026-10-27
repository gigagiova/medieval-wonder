import * as THREE from 'three';
import { PLACED } from './readables';
import { LORE, VIPER_TRAIL, type Lore } from './lore';

// Reading what the town has to say: walk up to an inscription, a scrap of
// writing or a relic and a button offers to read it (or press E). The card
// shows the text as written and its translation. Sources and reconstruction
// status remain in lore metadata and development notes, outside the game UI.
// What you have found is remembered (in this browser only) and the map can
// mark it.

const KEY = 'beneventum-found-v1';
let found = new Set<string>();
try { found = new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]')); } catch { /* private mode */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...found])); } catch { /* ignore */ } };
export const discovered = () => found;

let btn: HTMLButtonElement | null = null, card: HTMLDivElement | null = null;
let target: Lore | null = null;
let open = false;
export const isReadingSecret = () => open;

function ui() {
  const style = document.createElement('style');
  style.textContent = `
  #lorebtn { position: fixed; z-index: 6; left: 50%; transform: translateX(-50%);
    bottom: max(84px, calc(env(safe-area-inset-bottom, 0px) + 76px));
    display: flex; align-items: center; gap: 10px; padding: 9px 20px 9px 14px; border-radius: 26px; cursor: pointer;
    border: 2px solid rgba(201,154,86,0.85); color: #f0dcae; font: 19px 'IM Fell English', Georgia, serif; letter-spacing: 0.05em;
    background: radial-gradient(circle at 30% 30%, rgba(70,58,40,0.95), rgba(18,14,9,0.95)); box-shadow: 0 0 18px rgba(0,0,0,0.6);
    touch-action: manipulation; -webkit-tap-highlight-color: transparent; max-width: 86vw; }
  #lorebtn small { font-size: 13px; opacity: 0.75; font-style: italic; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #lorecard { position: fixed; inset: 0; z-index: 20; display: none; align-items: center; justify-content: center; padding: 16px;
    background: radial-gradient(ellipse at center, rgba(8,7,6,0.55), rgba(2,2,2,0.9)); }
  #lorecard.open { display: flex; }
  #lorecard .sheet { position: relative; max-width: 640px; width: 100%; max-height: 88vh; overflow-y: auto; padding: 26px 26px 20px;
    background: linear-gradient(160deg, #d8c9a3, #c9b68b 60%, #b9a476); color: #2a1d10; border-radius: 4px;
    box-shadow: 0 0 40px rgba(0,0,0,0.8), inset 0 0 60px rgba(90,60,20,0.35); font-family: 'IM Fell English', Georgia, serif; }
  #lorecard h2 { margin: 0 0 10px; font-weight: 400; font-size: 22px; color: #5a1a0c; }
  #lorecard .latin { font-family: 'Cardo', 'IM Fell English', Georgia, serif; font-size: 18px; line-height: 1.45; white-space: pre-wrap; margin: 0 0 14px; letter-spacing: 0.02em; }
  #lorecard .latin.ins { text-transform: uppercase; letter-spacing: 0.12em; font-size: 16px; }
  #lorecard .eng { font-size: 16px; line-height: 1.5; margin: 0 0 12px; }
  #lorecard .trail { margin-top: 12px; font-size: 14px; color: #5a1a0c; }
  #lorecard button { position: absolute; top: 8px; right: 10px; border: 0; background: none; font-size: 26px; color: #5a1a0c; cursor: pointer; min-width: 44px; min-height: 44px; }`;
  document.head.appendChild(style);
  btn = document.createElement('button');
  btn.id = 'lorebtn'; btn.type = 'button'; btn.hidden = true;
  btn.innerHTML = '<span>Lege</span><small></small>';
  btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (target) show(target); });
  document.body.appendChild(btn);
  card = document.createElement('div');
  card.id = 'lorecard';
  card.addEventListener('pointerdown', (e) => e.stopPropagation());
  card.addEventListener('click', (e) => { e.stopPropagation(); if (e.target === card || (e.target as HTMLElement).tagName === 'BUTTON') hide(); });
  document.body.appendChild(card);
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && open) hide();
    else if (e.code === 'KeyE' && !open && target) show(target);
  });
}

function show(l: Lore) {
  if (!card) return;
  open = true;
  if (!found.has(l.id)) { found.add(l.id); save(); }
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const t = VIPER_TRAIL.indexOf(l.id);
  const trail = t >= 0 ? `<p class="trail">The golden viper: ${VIPER_TRAIL.filter((id) => found.has(id)).length} of ${VIPER_TRAIL.length} found.</p>` : '';
  card.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(l.title)}"><button aria-label="Close">×</button>
    <h2>${esc(l.title)}</h2>
    <p lang="${l.language ?? (l.greek ? 'el' : 'la')}" dir="${l.language === 'he' ? 'rtl' : 'ltr'}" class="latin ${l.kind === 'inscription' || l.kind === 'graffito' ? 'ins' : ''}">${esc(l.latin)}</p>
    <p class="eng">${esc(l.english)}</p>
    ${trail}</div>`;
  card.classList.add('open');
  if (document.pointerLockElement) document.exitPointerLock();
}
function hide() { open = false; card?.classList.remove('open'); }

const tmp = new THREE.Vector3(), dir = new THREE.Vector3();
/** Each frame: offer to read whatever is near and looked at. */
export function updateSecrets(camera: THREE.Camera) {
  if (!btn) ui();
  camera.getWorldDirection(dir);
  let best: Lore | null = null, bs = Infinity;
  for (const p of PLACED) {
    const l = LORE[p.id];
    if (!l) continue;
    tmp.subVectors(p.pos, camera.position);
    const d = tmp.length(), r = l.range ?? 2.2;
    if (d > r) continue;
    const c = tmp.dot(dir) / Math.max(d, 1e-3);
    if (c < (d < 1.6 ? 0.2 : r > 5 ? 0.97 : 0.75)) continue;
    const s = d / r + (1 - c);
    if (s < bs) { bs = s; best = l; }
  }
  target = open ? null : best;
  btn!.hidden = !target;
  if (target) {
    btn!.querySelector('small')!.textContent = (found.has(target.id) ? '✓ ' : '') + target.title;
    btn!.setAttribute('aria-label', 'Read: ' + target.title);
  }
}
