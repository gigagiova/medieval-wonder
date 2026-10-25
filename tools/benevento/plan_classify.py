import cv2, numpy as np, json
from skimage.morphology import skeletonize as _sk
skeletonize = lambda m: _sk(m > 0).astype(np.uint8)
im = cv2.imread('ref.png')
g = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY)
K = 3
G = cv2.resize(g, None, fx=K, fy=K, interpolation=cv2.INTER_CUBIC)
H, W = G.shape
line = (G < 120).astype(np.uint8)
line[540 * K:, 640 * K:1100 * K] = 0
# erase the label glyphs and triangle markers (they are not parcels)
for (x0, y0, x1, y1) in [(895, 145, 955, 205), (440, 395, 500, 460), (100, 440, 135, 475), (305, 470, 345, 520), (455, 460, 480, 495), (945, 115, 975, 145)]:
    sub = line[y0 * K:y1 * K, x0 * K:x1 * K]
    # keep thin lines (parcel edges), drop thick marker strokes: open with a big kernel to find thick parts
    thick = cv2.morphologyEx(sub, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    sub[thick > 0] = 0
mk = (g < 235).astype(np.uint8); mk[540:, 640:1100] = 0; mk[:150, :] = 0
mk = cv2.morphologyEx(mk, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)), iterations=2)
cs, _ = cv2.findContours(mk, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
c = max(cs, key=cv2.contourArea)
town = np.zeros_like(G, np.uint8)
cv2.drawContours(town, [c * K], -1, 1, -1)
paper = ((1 - line) & town).astype(np.uint8)
n, lab, stats, cent = cv2.connectedComponentsWithStats(paper, connectivity=4)
dist = cv2.distanceTransform(paper, cv2.DIST_L2, 5)
sk = skeletonize(paper)
info = []
kind = np.zeros(n, np.uint8)  # 1 street, 2 parcel, 3 open
for l in range(1, n):
    x, y, w, h, a = stats[l]
    if a < 12: continue
    m = lab[y:y + h, x:x + w] == l
    d = dist[y:y + h, x:x + w][m]
    s = sk[y:y + h, x:x + w][m].sum()
    rmax = d.max()
    # mean half-width along the skeleton
    hw = dist[y:y + h, x:x + w][(sk[y:y + h, x:x + w] > 0) & m]
    mw = 2 * (hw.mean() if hw.size else rmax)
    elong = s / max(mw, 1)
    wm = mw / K  # width in plan px (~ metres)
    if wm < 10.5 and elong > 7: kind[l] = 1
    elif a / (K * K) > 2500 and wm > 14: kind[l] = 3
    else: kind[l] = 2
    info.append((l, a / (K * K), wm, elong, kind[l]))
info = np.array(info)
print('components', len(info), 'streets', (info[:, 4] == 1).sum(), 'parcels', (info[:, 4] == 2).sum(), 'open', (info[:, 4] == 3).sum())
vis = np.full((H, W, 3), 255, np.uint8)
vis[kind[lab] == 1] = (60, 60, 230)
vis[kind[lab] == 2] = (200, 200, 200)
vis[kind[lab] == 3] = (120, 200, 120)
vis[line > 0] = (0, 0, 0)
cv2.imwrite('plan_class.png', cv2.resize(vis, (W // 2, H // 2), interpolation=cv2.INTER_AREA))
np.save('plan_lab.npy', lab); np.save('plan_kind.npy', kind)
