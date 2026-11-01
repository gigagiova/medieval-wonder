// Just enough of a DOM for the world's modules to build their geometry under
// node: images never load, canvases draw nothing, fonts are "ready", and
// relative fetches read public/. Import before anything else.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const g = globalThis as Record<string, unknown>;
if (typeof g.document === 'undefined') {
  // An object that accepts any call or property access and returns itself.
  const stub = (): unknown => {
    const f = function () { return proxy; };
    const proxy: unknown = new Proxy(f, {
      get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : k === 'width' || k === 'height' ? 1 : k === 'length' ? 0 : proxy),
      set: () => true,
      apply: () => proxy,
      construct: () => proxy as object,
    });
    return proxy;
  };
  const el = () => {
    const ctx = stub();
    return new Proxy({ style: {}, width: 1, height: 1, addEventListener() {}, removeEventListener() {}, setAttribute() {}, appendChild() {}, getContext: () => ctx, toDataURL: () => '' } as Record<string | symbol, unknown>, {
      get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : stub()),
      set: () => true,
    });
  };
  const doc: Record<string | symbol, unknown> = { createElementNS: el, createElement: el, body: el(), head: el(), querySelector: () => null, getElementById: () => null,
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve([]), check: () => true, add() {} } };
  g.document = new Proxy(doc, { get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : stub()) });
  g.window = g;
  g.addEventListener = () => {};
  g.removeEventListener = () => {};
  g.matchMedia = () => ({ matches: false, addEventListener() {} });
  g.innerWidth = 390; g.innerHeight = 844; g.devicePixelRatio = 1;
  g.self = g;
  g.requestAnimationFrame = (f: () => void) => setTimeout(f, 0);
  g.location = { search: '', href: 'http://localhost/' };
  if (!g.navigator) g.navigator = { hardwareConcurrency: 4 };
  const nodeFetch = g.fetch as typeof fetch;
  g.fetch = async (url: string | URL, init?: RequestInit) => {
    const s = String(url);
    if (/^[a-z]+:/i.test(s)) return nodeFetch(url, init);
    try {
      const buf = await readFile(resolve('public', s.replace(/^\.?\//, '')));
      return new Response(buf, { status: 200 });
    } catch {
      return new Response('', { status: 404 });
    }
  };
}
export {};
