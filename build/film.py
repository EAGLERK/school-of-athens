"""Render the scroll film from the two paintings.

Every frame is a virtual camera over a painting: a centre (cx, cy) and the visible
height H, both in source-image pixels. Landscape and portrait tiers share that
camera, so a portrait frame is exactly the cover-fit crop of the landscape one,
which is what lets the page line up the 3D wall with frame 0 and the last frame.

Usage: python3 film.py [tier ...]   tiers: 1080 720 p720  (default: all)
"""
import os, sys, math
from multiprocessing import Pool
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
N = 540
TIERS = {'1080': (1920, 1080), '720': (1280, 720), 'p720': (720, 1280)}

# ---- camera keyframes: (frame, cx, cy, H, u) -------------------------------------
# u = tunnel-dolly strength (k * H, dimensionless); FOE = focus of expansion.
ATHENS_FOE = (1975.0, 1292.0)
SEG_A = [  # The School of Athens. 6th field: False = keep moving through this key
    (0, 1915, 1658, 1367, 0.0),
    (8, 1915, 1658, 1367, 0.0),      # hold: frame 0 must match the 3D wall
    (72, 1958, 1452, 760, 0.0),      # Plato and Aristotle
    (104, 1960, 1434, 700, 0.06),
    (168, 1970, 1340, 560, 1.5, False),   # walking past them, the halls stream outward
    (228, 1980, 1262, 440, 3.0),     # into the far arch, the light dying
]
SOC_PORTAL = (2290, 1160, 1100)       # corridor portal == first Socrates crop
SEG_C = [  # The Death of Socrates
    (330, 2290, 1160, 1100, 0),
    (376, 2560, 958, 820, 0),        # the raised finger
    (404, 2530, 975, 790, 0),
    (444, 1850, 1180, 860, 0),       # the cup, the jailer
    (478, 1060, 1150, 900, 0),       # Plato at the foot of the bed
    (502, 860, 1050, 840, 0),        # the stair, Xanthippe
    (530, 1920, 1261, 2160, 0),      # the whole canvas
    (539, 1920, 1261, 2160, 0),
]
B0, B1 = 205, 330     # corridor frames (overlaps A's tail for the dissolve)
XF0, XF1 = 205, 232   # dissolve A -> corridor
DARK0, DARK1 = 160, 228


def hermite(keys, f):
    """Cardinal (Catmull-Rom style) spline through keys; flat ends."""
    ts = [k[0] for k in keys]
    if f <= ts[0]:
        return np.array(keys[0][1:5], float)
    if f >= ts[-1]:
        return np.array(keys[-1][1:5], float)
    i = max(j for j in range(len(ts) - 1) if ts[j] <= f)
    P = [np.array(k[1:5], float) for k in keys]
    stop = [len(k) < 6 or k[5] for k in keys]
    # interpolate H in log space so zooms feel uniform
    P = [np.array([p[0], p[1], math.log(p[2]), p[3]]) for p in P]
    t0, t1 = ts[i], ts[i + 1]
    def tan(j):
        if stop[j]:
            return np.zeros(4)  # ease in and out: frames at keys are sharp, text sits there
        return (P[j + 1] - P[j - 1]) / (ts[j + 1] - ts[j - 1])
    s = (f - t0) / (t1 - t0)
    h00, h10 = 2*s**3 - 3*s**2 + 1, s**3 - 2*s**2 + s
    h01, h11 = -2*s**3 + 3*s**2, s**3 - s**2
    d = t1 - t0
    v = h00*P[i] + h10*d*tan(i) + h01*P[i+1] + h11*d*tan(i+1)
    return np.array([v[0], v[1], math.exp(v[2]), v[3]])


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


class Src:
    def __init__(self, path):
        im = cv2.imread(path, cv2.IMREAD_COLOR).astype(np.float32)
        self.lv = [im]
        for _ in range(3):
            self.lv.append(cv2.pyrDown(self.lv[-1]))

    def sample(self, mx, my, mag):
        """Sample at source coords, choosing a pyramid level from magnification."""
        lvl = 0
        while lvl < 3 and mag * (2 ** lvl) < 0.7:
            lvl += 1
        sc = 0.5 ** lvl
        return cv2.remap(self.lv[lvl], (mx * sc - 0.5 * (1 - sc)).astype(np.float32),
                         (my * sc - 0.5 * (1 - sc)).astype(np.float32),
                         cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def grid(w, h):
    xs = np.arange(w, dtype=np.float32) - (w - 1) / 2
    ys = np.arange(h, dtype=np.float32) - (h - 1) / 2
    return np.meshgrid(xs, ys)


def crop_view(src, gx, gy, h_out, cx, cy, H, u, foe):
    sc = H / h_out
    px, py = cx + gx * sc, cy + gy * sc
    if u > 1e-4:
        k = u / H
        dx, dy = px - foe[0], py - foe[1]
        r = np.sqrt(dx * dx + dy * dy)
        w = 1.0 / (1.0 + k * r)
        px, py = foe[0] + dx * w, foe[1] + dy * w
    return src.sample(px, py, h_out / H)


def vignette(gx, gy, h_out, amt):
    r2 = (gx * gx + gy * gy) / (h_out * h_out)
    return (1.0 - amt * np.clip(r2 * 1.1, 0, 1))[..., None]


# ---- the passage ----------------------------------------------------------------
CA, CB = 1.6, 0.9                 # corridor half width / height (16:9 like the portal)
VFOV = math.radians(56)
D_FINAL = CB / math.tan(VFOV / 2)   # portal exactly fills the frame
Z_END = 15.0
TEX_PER_UNIT = 520.0


def corridor_cam(f):
    s = smooth(B0, B1, f)
    s = 1 - (1 - s) ** 2.2          # decelerate into the cell
    return s * (Z_END - D_FINAL)


def corridor(stone, soc, gx, gy, h_out, f):
    foc = (h_out / 2) / math.tan(VFOV / 2)
    zc = corridor_cam(f)
    sway = 0.04 * math.sin(f * 0.11)
    dx, dy = gx / foc, gy / foc
    tx = CA / np.maximum(np.abs(dx), 1e-6)
    ty = CB / np.maximum(np.abs(dy), 1e-6)
    tw = np.minimum(tx, ty)
    tp = Z_END - zc
    portal = tw >= tp
    t = np.where(portal, tp, tw)
    zh = zc + t
    side = tx < ty
    # wall texture coords: along the corridor and across the wall
    across = np.where(side, dy * t, dx * t + sway)
    U = zh * TEX_PER_UNIT
    V = across * TEX_PER_UNIT + np.where(side, np.where(dx > 0, 1300, 300), np.where(dy > 0, 2100, 2700))
    sh, sw = stone.lv[0].shape[:2]
    U = np.abs(((U / sw) % 2) - 1) * (sw - 2)   # mirror-repeat, no seams
    V = np.abs(((V / sh) % 2) - 1) * (sh - 2)
    wall = 0.5 * (stone.sample(U, V, 1.0) + stone.sample(U, V, 0.15))
    # light: from the cell ahead, plus a faint ambient
    dist_end = Z_END - zh
    light = 0.06 + 1.25 * np.exp(-dist_end / 2.6) + 0.10 * np.exp(-t / 3.0)
    warm = np.array([0.62, 0.82, 1.0], np.float32)   # BGR: warm
    wall = wall * light[..., None] * warm
    # portal: the cell, a crop of David's canvas
    pcx, pcy, pH = SOC_PORTAL
    ppx = pcx + dx * tp * (pH / (2 * CB))
    ppy = pcy + dy * tp * (pH / (2 * CB))
    pmag = (CB * foc / tp) / (pH / 2)
    pv = soc.sample(ppx, ppy, pmag)
    reach = smooth(B0, B1, f)
    pv = pv * (0.55 + 0.45 * reach)
    out = np.where(portal[..., None], pv, wall)
    return out


# ---- frames -----------------------------------------------------------------------
_S = {}


def sources():
    if not _S:
        _S['a'] = Src(os.path.join(HERE, 'source', 'athens.jpg'))
        _S['s'] = Src(os.path.join(HERE, 'source', 'socrates.jpg'))
        soc = cv2.imread(os.path.join(HERE, 'source', 'socrates.jpg')).astype(np.float32)
        st = soc[40:700, 1880:3560]          # David's cell wall: stone blocks
        st = cv2.GaussianBlur(st, (0, 0), 0.6)
        st = st / max(1.0, st.mean()) * 70    # normalise brightness; lit later
        fg = cv2.imread(os.path.join(HERE, 'source', 'fg.png'), cv2.IMREAD_UNCHANGED).astype(np.float32)
        a = fg[..., 3:4] / 255.0
        _S['fg'] = Src.__new__(Src); _S['fg'].lv = [np.dstack([fg[..., :3] * a, a[..., 0] * 255])]  # premultiplied
        for _ in range(3):
            _S['fg'].lv.append(cv2.pyrDown(_S['fg'].lv[-1]))
        _S['bg'] = Src(os.path.join(HERE, 'source', 'bg.png'))
        _S['stone'] = Src.__new__(Src)
        _S['stone'].lv = [st]
        for _ in range(3):
            _S['stone'].lv.append(cv2.pyrDown(_S['stone'].lv[-1]))
    return _S


# Walking past Plato and Aristotle: two depth layers instead of one warped picture.
# s = how far the camera has walked toward the near layer (1 = through it).
LAYER0 = 72                 # from here the crowd and the hall are rendered separately
ZB = 3.0                    # the hall behind is three times as far as the crowd


def walk(f):
    return 0.93 * smooth(LAYER0 + 24, 222, f) ** 1.6


def layer_coords(gx, gy, h_out, cx, cy, H, m, u, foe):
    # crop -> optional tunnel warp -> scale by m about the focus of expansion
    sc = H / h_out
    px, py = cx + gx * sc, cy + gy * sc
    dx, dy = px - foe[0], py - foe[1]
    if u > 1e-4:
        r = np.sqrt(dx * dx + dy * dy)
        w = 1.0 / (1.0 + (u / H) * r)
        dx, dy = dx * w, dy * w
    return foe[0] + dx / m, foe[1] + dy / m


def athens(S, f, gx, gy, h):
    cx, cy, H, u = hermite(SEG_A, f)
    if f < LAYER0:
        img = crop_view(S['a'], gx, gy, h, cx, cy, H, u, ATHENS_FOE)
    else:
        s = walk(f)
        g, b = 1 / (1 - s), ZB / (ZB - s)
        bx, by = layer_coords(gx, gy, h, cx, cy, H, b, 0.6 * u, ATHENS_FOE)
        bg = S['bg'].sample(bx, by, h / H * b)
        fx, fy = layer_coords(gx, gy, h, cx, cy, H, g, 0, ATHENS_FOE)
        fg = S['fg'].sample(fx, fy, h / H * g)
        fade = 1 - smooth(6, 10, g)               # anything still in view once you're past them
        img = fg[..., :3] * fade + bg * (1 - fg[..., 3:4] / 255.0 * fade)   # fg is premultiplied
    dark = 1 - 0.8 * smooth(DARK0, DARK1, f)
    return img * dark * vignette(gx, gy, h, 0.5 * smooth(110, DARK1, f))


def render_at(f, w, h):
    S = sources()
    gx, gy = grid(w, h)
    if f < B0:
        return athens(S, f, gx, gy, h)
    if f < B1:
        cor = corridor(S['stone'], S['s'], gx, gy, h, f)
        if f < XF1:
            m = smooth(XF0, XF1, f)
            return athens(S, f, gx, gy, h) * (1 - m) + cor * m
        return cor
    cx, cy, H, u = hermite(SEG_C, f)
    img = crop_view(S['s'], gx, gy, h, cx, cy, H, 0, None)
    return img


def speed(f):
    # rough motion amount: decides how many motion-blur subframes to average
    if LAYER0 + 24 <= f < B1:
        return 5
    if B0 <= f < B1:
        return 3
    keys = SEG_A if f < B0 else SEG_C
    a, b = hermite(keys, f - 0.5), hermite(keys, f + 0.5)
    mv = abs(a[0] - b[0]) / a[2] + abs(a[1] - b[1]) / a[2] + abs(math.log(a[2] / b[2])) + abs(a[3] - b[3]) * 0.05
    return 1 if mv < 0.004 else 3


def render(f, w, h):
    n = speed(f)
    if n == 1:
        img = render_at(f, w, h)
    else:
        span = 0.35 if n == 5 else 0.25
        img = sum(render_at(f + d, w, h) for d in np.linspace(-span, span, n)) / n
    return np.clip(img, 0, 255).astype(np.uint8)


QUALITY = {'1080': 72, '720': 70, 'p720': 70}


def job(args):
    tier, f = args
    w, h = TIERS[tier]
    path = os.path.join(OUT, tier, f'{f:04d}.webp')
    if os.path.exists(path):
        return
    img = render(f, w, h)
    cv2.imwrite(path, img, [cv2.IMWRITE_WEBP_QUALITY, QUALITY[tier]])


if __name__ == '__main__':
    tiers = sys.argv[1:] or ['1080', '720', 'p720']
    only = os.environ.get('FRAMES')   # e.g. FRAMES=0,58,140 for previews
    frames = [int(x) for x in only.split(',')] if only else range(N)
    jobs = []
    for t in tiers:
        os.makedirs(os.path.join(OUT, t), exist_ok=True)
        jobs += [(t, f) for f in frames]
    with Pool(4) as p:
        for i, _ in enumerate(p.imap_unordered(job, jobs, chunksize=2)):
            if i % 50 == 0:
                print(i, '/', len(jobs), flush=True)
