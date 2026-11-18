"""Split the School of Athens into two depth layers for the walk past Plato and Aristotle.

fg.png  : the crowd on the top step (alpha = mask), Plato and Aristotle traced by hand,
          the rest found by GrabCut seeded from those traces.
bg.png  : the hall without them. Holes are filled by extruding the architecture down to
          the horizon and the floor up to it, the way the perspective runs.
python3 layers.py   (writes into build/source/, film.py reads them)
"""
import os
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source')
im = cv2.imread(os.path.join(SRC, 'athens.jpg'))
H, W = im.shape[:2]


def pts(display):
    # traced on a 1.6x crop whose origin is (1780, 1260)
    return np.array([[1780 + x / 1.6, 1260 + y / 1.6] for x, y in display], np.int32)


PLATO = pts([(30, 30), (46, 45), (52, 150), (70, 180), (115, 165), (118, 105), (150, 66), (200, 70), (218, 100),
             (215, 160), (265, 195), (300, 215), (312, 300), (310, 380), (300, 445), (280, 475), (268, 530),
             (272, 620), (265, 700), (262, 770), (240, 795), (180, 790), (165, 822), (120, 822), (90, 795),
             (68, 700), (55, 600), (48, 500), (42, 400), (35, 300), (22, 180), (18, 80)])
ARISTOTLE = pts([(282, 228), (300, 200), (372, 160), (370, 95), (395, 58), (450, 52), (458, 92), (462, 138),
                 (520, 198), (580, 280), (598, 380), (612, 430), (600, 470), (560, 480), (552, 600), (552, 770),
                 (540, 822), (470, 818), (440, 812), (380, 812), (350, 765), (338, 700), (328, 600), (318, 500),
                 (298, 420), (290, 330), (282, 300)])

# the standing figure in white on the steps at right (nearer than the top step)
WHITE = np.array([(2470, 1428), (2532, 1428), (2548, 1480), (2592, 1518), (2612, 1600), (2602, 1700),
                  (2584, 1800), (2566, 1895), (2466, 1895), (2448, 1800), (2438, 1650), (2444, 1530), (2460, 1480)], np.int32)
# the man in green at left, whose robe GrabCut reads as wall
GREEN = np.array([(1380, 1283), (1430, 1290), (1440, 1340), (1470, 1360), (1495, 1420), (1490, 1500), (1480, 1580),
                  (1500, 1650), (1495, 1720), (1450, 1735), (1400, 1700), (1370, 1600), (1345, 1520), (1335, 1420),
                  (1355, 1370), (1372, 1340)], np.int32)
GROUND = 1800                                   # below this everything is nearer than the top step

# ---- GrabCut over the band of the top step ------------------------------------------
X0, Y0, X1, Y1 = 1150, 1180, 2800, 1880
roi = im[Y0:Y1, X0:X1].copy()
m = np.full(roi.shape[:2], cv2.GC_PR_BGD, np.uint8)
yy = np.arange(Y0, Y1)[:, None] + np.zeros((1, X1 - X0), int)
m[yy < 1262] = cv2.GC_BGD                       # architecture and sky above the heads
m[(yy >= 1330) & (yy < 1770)] = cv2.GC_PR_FGD   # bodies
m[yy >= GROUND] = cv2.GC_FGD
def seed(poly, val, core=None):
    t = np.zeros_like(m); cv2.fillPoly(t, [poly - [X0, Y0]], 1)
    if core: t = cv2.erode(t, np.ones((core, core), np.uint8))
    m[t > 0] = val
seed(WHITE, cv2.GC_PR_FGD); seed(WHITE, cv2.GC_FGD, 25)
for poly in (PLATO, ARISTOTLE): seed(poly, cv2.GC_FGD, 9)
seed(GREEN, cv2.GC_PR_FGD); seed(GREEN, cv2.GC_FGD, 21)
bgd, fgd = np.zeros((1, 65)), np.zeros((1, 65))
cv2.grabCut(roi, m, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
band = np.where((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

mask = np.zeros((H, W), np.uint8)
mask[Y0:Y1, X0:X1] = band
mask[GROUND:, :] = 255
for poly in (PLATO, ARISTOTLE):                  # the traces win over GrabCut
    cv2.fillPoly(mask, [poly], 255)
# clean: drop specks, close small gaps, keep only blobs that reach the ground
mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
n, lab, stats, _ = cv2.connectedComponentsWithStats(mask)
keep = np.zeros_like(mask)
for i in range(1, n):
    x, y, w, h, a = stats[i]
    if a > 4000 and y + h > 1500:
        keep[lab == i] = 255
mask = keep
# everything below the skyline of heads is the near layer: crowd, landing, steps
for x in range(X0, X1):
    ys = np.where(mask[:, x])[0]
    if len(ys): mask[ys.min():, x] = 255

# the sky between Plato's raised hand and his head is background, not crowd
cv2.fillPoly(mask, [pts([(60, 0), (160, 0), (150, 64), (118, 100), (114, 160), (72, 172), (62, 160)])], 0)
cv2.fillPoly(mask, [pts([(-40, -20), (12, -20), (14, 80), (16, 140), (-40, 140)])], 0)      # pilaster by his finger
cv2.fillPoly(mask, [pts([(458, -20), (540, -20), (540, 190), (520, 198), (462, 138), (458, 92)])], 0)  # sky by Aristotle
cv2.fillPoly(mask, [np.array([(1803, 1250), (1830, 1250), (1830, 1318), (1812, 1318), (1805, 1290)], np.int32)], 0)  # sky right of the finger

alpha = cv2.GaussianBlur(mask.astype(np.float32) / 255, (0, 0), 1.5)
cv2.imwrite(os.path.join(SRC, 'fg.png'), np.dstack([im, (alpha * 255).astype(np.uint8)]))

# ---- background plate: the hall continues behind them ------------------------------
# Above the eye line each column carries on the architecture from a clean band above every
# head (pillars run down, arch openings stay sky); below it, the landing's floor colour.
HORIZON = 1440
hole = cv2.dilate(mask, np.ones((15, 15), np.uint8)) > 0
orig = im.astype(np.float32)
top = cv2.blur(orig[1236:1262].mean(axis=0, keepdims=True), (7, 1))      # 1 x W x 3
floor = np.median(orig[1600:1760, 1952:1984].reshape(-1, 3), axis=0)   # the landing between Plato and Aristotle
ys = np.arange(H, dtype=np.float32)[:, None, None]
k = np.clip((ys - (HORIZON - 25)) / 50, 0, 1)                             # blend across the eye line
plate = top * (1 - k) + floor[None, None] * k
shade = 1 - 0.10 * np.clip((ys - HORIZON) / 400, 0, 1)                   # floor darkens toward us
plate = plate * shade
rng = np.random.default_rng(3)
plate += rng.normal(0, 2.5, (H, W, 3)).astype(np.float32)
hb = cv2.GaussianBlur(hole.astype(np.float32), (0, 0), 3)[..., None]
bg = np.clip(orig * (1 - hb) + plate * hb, 0, 255).astype(np.uint8)
cv2.imwrite(os.path.join(SRC, 'bg.png'), bg)
print('fg px', int(mask.sum() / 255))
