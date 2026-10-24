import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Our models are glTF JSON with embedded base64 buffers/images (the host won't serve .glb/.bin).
// Mobile Safari refuses multi-MB data: URIs, so decode them here into Blob URLs before parsing.
function dataToBlobUrl(uri: string, urls: string[]): string {
  const comma = uri.indexOf(',');
  const mime = uri.slice(5, comma).split(';')[0] || 'application/octet-stream';
  const b64 = uri.slice(comma + 1);
  const bytes = new Uint8Array(Math.floor((b64.length * 3) / 4));
  let n = 0;
  const CH = 1 << 20; // multiple of 4: decode in 1 MB slices
  for (let i = 0; i < b64.length; i += CH) {
    const s = atob(b64.slice(i, i + CH));
    for (let j = 0; j < s.length; j++) bytes[n++] = s.charCodeAt(j);
  }
  const url = URL.createObjectURL(new Blob([bytes.subarray(0, n)], { type: mime }));
  urls.push(url);
  return url;
}

export async function loadGltf(url: string, loader = new GLTFLoader()): Promise<GLTF> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const json = JSON.parse(await res.text());
  const urls: string[] = [];
  for (const b of json.buffers ?? []) if (b.uri?.startsWith('data:')) b.uri = dataToBlobUrl(b.uri, urls);
  for (const im of json.images ?? []) if (im.uri?.startsWith('data:')) im.uri = dataToBlobUrl(im.uri, urls);
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  try {
    return await loader.parseAsync(json, base);
  } finally {
    for (const u of urls) URL.revokeObjectURL(u);
  }
}
