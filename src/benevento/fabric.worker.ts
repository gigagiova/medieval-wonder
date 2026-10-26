import { Builder, DETAIL } from '../builder';
import { buildChunk, bake, packLights, type ChunkItems, type ChunkResult } from './fabric';
import { setTessScale } from '../displace';

// Builds the render geometry of town chunks off the main thread: houses,
// bridges, plots, walls and ground, bent and lifted onto the terrain, merged
// per material. The main thread uploads them as they arrive.

// Town houses are many: walls and roofs are subdivided at about twice the
// spacing of the monuments (the bend of the walls still shows; the triangle
// count falls by about three quarters).
setTessScale(1.9);

self.onmessage = (e: MessageEvent<{ items: ChunkItems; mid?: boolean }>) => {
  const it = e.data.items, mid = !!e.data.mid;
  const t0 = performance.now();
  // Middle detail (seen from 40-96 m): see DETAIL in builder.ts.
  DETAIL.mid = mid;
  setTessScale(mid ? 5 : 1.9);
  const b = new Builder();
  b.mode = 'render';
  let res: ChunkResult;
  try {
    buildChunk(b, it);
    const baked = bake(b);
    const { lamps, flames } = packLights(b.lamps, b.flames);
    res = { key: it.key, baked, lamps: mid ? [] : lamps, flames: mid ? [] : flames, ms: performance.now() - t0 };
  } catch (err) {
    console.error('chunk failed', it.key, err);
    res = { key: it.key, baked: [], lamps: [], flames: [], ms: performance.now() - t0 };
  }
  const transfer: Transferable[] = [];
  for (const x of res.baked) transfer.push(x.pos.buffer, x.nor.buffer);
  (self as unknown as Worker).postMessage({ ...res, mid }, transfer);
};
