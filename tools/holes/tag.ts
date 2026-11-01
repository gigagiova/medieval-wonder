// Source tagging for the geometry audits (tools/audit-holes.ts).
//
// The Builder merges everything per material, so by the time geometry reaches
// the GPU nobody knows which module made a triangle. For the audit only, the
// Builder's add() and the house kit's Acc.tri() are wrapped (no change to the
// game's code paths): every piece, and every Acc triangle, gets a tag naming
// the module function that made it and the helper it went through, read from
// the V8 call stack (structured call sites, no source maps: cheap).
import * as THREE from 'three';
import { Builder } from '../../src/builder';
import { Acc } from '../../src/arch/kit';
import type { MatName } from '../../src/materials';

export const TAGS: string[] = [];
const tagIds = new Map<string, number>();
export function tagId(s: string) {
  let t = tagIds.get(s);
  if (t === undefined) { t = TAGS.length; TAGS.push(s); tagIds.set(s, t); }
  return t;
}

// Helpers that only pass geometry on: the tag names the first frame that is
// not one of them (the owner) plus the nearest helper.
const PLUMBING = /(\/builder\.ts|\/tools\/holes\/|node:internal|node_modules)/;
const HELPERS = /(\/shapes\.ts|\/arch\/kit\.ts|\/lights\.ts|\/displace\.ts|\/arch\/roof\.ts|\/arch\/dress\.ts|\/arch\/facade\.ts)/;
const root = process.cwd().replace(/\\/g, '/') + '/';
const short = (f: string) => f.replace(/^file:\/\//, '').replace(root, '').replace(/^src\//, '');

function frames(): NodeJS.CallSite[] {
  const orig = Error.prepareStackTrace;
  const lim = Error.stackTraceLimit;
  Error.stackTraceLimit = 16;
  Error.prepareStackTrace = (_e, cs) => cs;
  const o: { stack?: NodeJS.CallSite[] } = {};
  Error.captureStackTrace(o, frames);
  const cs = o.stack ?? [];
  Error.prepareStackTrace = orig;
  Error.stackTraceLimit = lim;
  return cs;
}
const siteCache = new Map<string, number>();
/** Tag of the current call: "owner-file#fn > helper-file#fn". */
export function callTag(): number {
  const cs = frames();
  let helper = '', owner = '';
  for (const c of cs) {
    const f = c.getFileName() ?? '';
    if (!f || PLUMBING.test(f)) continue;
    const name = `${short(f)}#${c.getFunctionName() ?? c.getMethodName() ?? '?'}`;
    if (!helper && !/\/arch\/kit\.ts/.test(f)) helper = name;
    if (!HELPERS.test(f)) { owner = name; break; }
  }
  const key = !helper || owner === helper || !owner ? (owner || helper || "?") : `${owner} > ${helper}`;
  let id = siteCache.get(key);
  if (id === undefined) { id = tagId(key); siteCache.set(key, id); }
  return id;
}

/** Per-triangle tags of a geometry produced by the instrumented Builder. */
export interface Tagged { tags: Uint32Array }
type AccT = Acc & { __tags?: Map<MatName, number[]> };
let pendingAcc: Map<MatName, number[]> | null = null;
/** Optional prefix (e.g. the landmark being built) added to every tag. */
export const TAG_CTX = { prefix: '' };

let installed = false;
export function installTagging() {
  if (installed) return;
  installed = true;
  const tri0 = Acc.prototype.tri;
  Acc.prototype.tri = function (this: AccT, m: MatName, ...rest: unknown[]) {
    const parts = (this as unknown as { parts: Map<MatName, number[]> }).parts;
    const before = parts.get(m)?.length ?? 0;
    (tri0 as (...a: unknown[]) => void).call(this, m, ...rest);
    const after = parts.get(m)?.length ?? 0;
    if (after > before) {
      this.__tags ??= new Map();
      let t = this.__tags.get(m);
      if (!t) this.__tags.set(m, (t = []));
      t.push(callTag());
    }
  } as typeof Acc.prototype.tri;
  const flush0 = Acc.prototype.flush;
  Acc.prototype.flush = function (this: AccT, b: Builder) {
    pendingAcc = this.__tags ?? new Map();
    this.__tags = new Map();
    try { flush0.call(this, b); } finally { pendingAcc = null; }
  };
  const add0 = Builder.prototype.add;
  Builder.prototype.add = function (this: Builder, g: THREE.BufferGeometry, m: MatName, ...rest: unknown[]) {
    const list = this.parts.get(m), before = list?.length ?? 0;
    const accTags = pendingAcc?.get(m);
    const own = accTags ? -1 : callTag();
    (add0 as (...a: unknown[]) => void).call(this, g, m, ...rest);
    const after = this.parts.get(m)?.length ?? 0;
    for (let i = before; i < after; i++) {
      const geo = this.parts.get(m)![i];
      const n = geo.attributes.position.count / 3;
      const tags = new Uint32Array(n);
      if (accTags && accTags.length === n) tags.set(accTags);
      else tags.fill(own >= 0 ? own : callTag());
      if (TAG_CTX.prefix) for (let k = 0; k < n; k++) tags[k] = tagId(TAG_CTX.prefix + ' :: ' + TAGS[tags[k]]);
      (geo.userData as Tagged).tags = tags;
    }
  } as typeof Builder.prototype.add;
  const addWorld0 = Builder.prototype.addWorld;
  Builder.prototype.addWorld = function (this: Builder, geo: THREE.BufferGeometry, m: MatName) {
    const before = this.parts.get(m)?.length ?? 0;
    addWorld0.call(this, geo, m);
    const after = this.parts.get(m)?.length ?? 0;
    const own = callTag();
    for (let i = before; i < after; i++) {
      const g = this.parts.get(m)![i];
      const n = g.attributes.position.count / 3;
      const id = TAG_CTX.prefix ? tagId(TAG_CTX.prefix + ' :: ' + TAGS[own]) : own;
      (g.userData as Tagged).tags = new Uint32Array(n).fill(id);
    }
  };
}
