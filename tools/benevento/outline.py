import cv2, numpy as np, json
im = cv2.imread('ref.png')
g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
# Town = drawn lines + grey shading; background white. Blank the legend and labels.
mask = (g < 235).astype(np.uint8)
mask[540:, 640:1100] = 0          # legend
mask[:150, :] = 0                 # top labels / north road stubs
mask[100:160, 930:1000] = 0       # "3"
k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
m = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)
cnts, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
c = max(cnts, key=cv2.contourArea)
# fill and take outer contour
fill = np.zeros_like(m); cv2.drawContours(fill, [c], -1, 1, -1)
cnts, _ = cv2.findContours(fill, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
c = max(cnts, key=cv2.contourArea)[:, 0, :].astype(float)
c = cv2.approxPolyDP(c.astype(np.float32).reshape(-1, 1, 2), 2.0, True)[:, 0, :]
B = np.load('ref_px2world.npy')
W = lambda P: np.hstack([P, np.ones((len(P), 1))]) @ B
world = W(c)
print(len(c), 'pts; world bbox', world.min(0), world.max(0))
# Civitas nova shaded region (grey ~ 150-200 fill)
shade = ((g > 120) & (g < 200)).astype(np.uint8)
shade[540:, 640:1100] = 0
shade = cv2.morphologyEx(shade, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
shade = cv2.morphologyEx(shade, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
cn, _ = cv2.findContours(shade, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
cn = sorted(cn, key=cv2.contourArea, reverse=True)
shapes = []
for s in cn[:2]:
    s = cv2.approxPolyDP(s, 2.0, True)[:, 0, :].astype(float)
    shapes.append(W(s).round(1).tolist())
    print('shade', cv2.contourArea(s.astype(np.float32)), W(s).mean(0))
exec(open('tps.py').read())
px_shades=[cv2.approxPolyDP(s, 2.0, True)[:, 0, :].astype(float) for s in cn[:2]]
json.dump({'outline': px2world(c).round(1).tolist(), 'shades': [px2world(p).round(1).tolist() for p in px_shades], 'outline_px': c.tolist(), 'shades_px': [p.tolist() for p in px_shades]}, open('ref_outline.json', 'w'))
dbg = im.copy()
cv2.polylines(dbg, [c.astype(np.int32)], True, (0, 0, 255), 2)
for s in cn[:2]:
    cv2.polylines(dbg, [s], True, (255, 0, 0), 2)
cv2.imwrite('outline_dbg.png', dbg)
