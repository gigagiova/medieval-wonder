"""
Before/after contact sheets from two capture.mjs runs (same groups, clips and views).

    python3 tools/npc3/compare.py <before_dir> <after_dir> <out_dir> <groups> <anims> <views>

Per group: one image, rows = clips, columns = views, each cell the before
(left) and after (right) frame of the same pose and camera, at half size, as
webp (q 82). Needs Pillow.
"""
import os, sys
from PIL import Image, ImageDraw

before, after, out, groups, anims, views = sys.argv[1:7]
os.makedirs(out, exist_ok=True)
A, V = anims.split(','), views.split(',')
for g in groups.split(','):
    name = g.replace(':', '-')
    tiles = {}
    for a in A:
        for v in V:
            tiles[a, v] = [Image.open(os.path.join(d, f'{name}_{a}_{v}.png')).convert('RGB') for d in (before, after)]
    w, h = tiles[A[0], V[0]][0].size
    w2, h2 = w // 2, h // 2
    sheet = Image.new('RGB', (len(V) * w2 * 2 + (len(V) - 1) * 6, len(A) * h2 + 22), (20, 20, 20))
    d = ImageDraw.Draw(sheet)
    d.text((4, 4), f'{g}: before (left of each pair) / after (right). Rows: {", ".join(A)}. Columns: {", ".join(V)}', fill=(230, 230, 230))
    for r, a in enumerate(A):
        for c, v in enumerate(V):
            for k, im in enumerate(tiles[a, v]):
                sheet.paste(im.resize((w2, h2)), (c * (w2 * 2 + 6) + k * w2, 22 + r * h2))
    sheet.save(os.path.join(out, f'{name}.webp'), quality=82)
    print(os.path.join(out, f'{name}.webp'), os.path.getsize(os.path.join(out, f'{name}.webp')))
