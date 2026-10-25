import { Builder } from '../builder';
import { buildChunk, bake, packLights, type ChunkItems, type ChunkResult } from './fabric';

// Builds the render geometry of town chunks off the main thread: houses,
// bridges, plots, walls and ground, bent and lifted onto the terrain, merged
// per material. The main thread uploads them as they arrive.

self.onmessage = (e: MessageEvent<{ items: ChunkItems }>) => {
  const it = e.data.items;
  const t0 = performance.now();
  const b = new Builder();
  b.mode = 'render';
  let res: ChunkResult;
  try {
    buildChunk(b, it);
    const baked = bake(b);
    const { lamps, flames } = packLights(b.lamps, b.flames);
    res = { key: it.key, baked, lamps, flames, ms: performance.now() - t0 };
  } catch (err) {
    console.error('chunk failed', it.key, err);
    res = { key: it.key, baked: [], lamps: [], flames: [], ms: performance.now() - t0 };
  }
  const transfer: Transferable[] = [];
  for (const x of res.baked) transfer.push(x.pos.buffer, x.nor.buffer);
  (self as unknown as Worker).postMessage(res, transfer);
};
