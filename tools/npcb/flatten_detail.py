"""
Flatten the painted folds of a grey detail map (the monk's-robe texture used by the
robe, long robe, tunic, hood and cowl), keeping its weave.

    python3 tools/npcb/flatten_detail.py <in.webp> <out.webp> [keep=0.25]

The map is multiplied in as twice its value (src/npc2/dress.ts detailMap), so its
painted broad light and dark fold stripes showed as long dark streaks down the
robes. The broad part (a masked Gaussian blur, sigma 6 px at 512 px, over the UV
islands only) is pulled towards the island's mean, keeping `keep` of it; the fine
weave above it is untouched. Pixels outside the islands are left as they are.
"""
import sys
import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

src, dst = sys.argv[1:3]
keep = float(sys.argv[3]) if len(sys.argv) > 3 else 0.25
im = np.asarray(Image.open(src).convert('RGB')).astype(np.float64)
L = im.mean(2)
mask = (L > 10).astype(np.float64)
s = 6 * im.shape[0] / 512
num = gaussian_filter(L * mask, s)
den = gaussian_filter(mask, s)
low = num / np.maximum(den, 1e-6)
mean = (L * mask).sum() / mask.sum()
target = mean + keep * (low - mean)
scale = np.where(mask > 0, (L - low + target) / np.maximum(L, 1), 1)
out = np.clip(im * scale[..., None], 0, 255).astype(np.uint8)
Image.fromarray(out).save(dst, quality=92)
print(dst, 'mean', round(mean, 1), 'broad std before', round(float(low[mask > 0].std()), 1), 'after', round(float(target[mask > 0].std()), 1))
