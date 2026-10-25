// node tools/trees/montage.mjs out.jpg cols width img1 img2 ...  -> grid of images (dev helper for reviewing screenshots)
import sharp from 'sharp';
const [out, colsS, widthS, ...imgs] = process.argv.slice(2);
const cols = Number(colsS), W = Number(widthS);
const tiles = [];
let H = 0;
const metas = await Promise.all(imgs.map((f) => sharp(f).metadata()));
H = Math.round((W * metas[0].height) / metas[0].width);
for (let i = 0; i < imgs.length; i++) {
  const name = imgs[i].split('/').pop();
  const svg = Buffer.from(`<svg width="${W}" height="${H}"><rect width="${W}" height="18" fill="black" opacity="0.6"/><text x="4" y="13" font-size="12" fill="white" font-family="sans-serif">${name}</text></svg>`);
  const t = await sharp(imgs[i]).resize(W, H, { fit: 'contain', background: '#222' }).composite([{ input: svg }]).png().toBuffer();
  tiles.push({ input: t, left: (i % cols) * W, top: Math.floor(i / cols) * H });
}
await sharp({ create: { width: cols * W, height: Math.ceil(imgs.length / cols) * H, channels: 3, background: '#222' } }).composite(tiles).jpeg({ quality: 85 }).toFile(out);
