"""Textures, card images and the two ambient loops for the site.  python3 assets.py"""
import os, subprocess
import numpy as np
import cv2

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'source')
A = os.path.join(HERE, '..', 'site', 'assets')
AU = os.path.join(HERE, '..', 'site', 'audio')
os.makedirs(A, exist_ok=True); os.makedirs(AU, exist_ok=True)
rng = np.random.default_rng(7)


def webp(name, img, q=86):
    cv2.imwrite(os.path.join(A, name), img, [cv2.IMWRITE_WEBP_QUALITY, q])


# ---- the fresco as a lunette ------------------------------------------------------
# Image coords (3820x2964): arch centre (1915,1722), outer radius of the Greek key
# band 1702, springline y~1490, painted field below it x 340..3480, bottom y 2355,
# door notch bottom-left. Crop box keeps the band: x 213..3617, y 20..2370.
X0, Y0, X1, Y1 = 213, 20, 3617, 2370
ath = cv2.imread(os.path.join(SRC, 'athens.jpg'))
crop = ath[Y0:Y1, X0:X1]
h, w = crop.shape[:2]
yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
X, Y = xx + X0, yy + Y0
inside_arch = np.sqrt((X - 1915) ** 2 + (Y - 1722) ** 2) <= 1700
mask = np.where(Y < 1490, inside_arch, (X >= 340) & (X <= 3480) & (Y <= 2355))
mask &= ~((X < 690) & (Y > 2042))                        # the real door cuts this corner
m = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 1.2)
rgba = np.dstack([crop, (m * 255).astype(np.uint8)])
webp('fresco.webp', rgba, 90)
webp('fresco-s.webp', cv2.resize(rgba, (w // 2, h // 2), interpolation=cv2.INTER_AREA), 88)

soc = cv2.imread(os.path.join(SRC, 'socrates.jpg'))
webp('socrates.webp', soc, 88)
webp('socrates-s.webp', cv2.resize(soc, (1920, 1261), interpolation=cv2.INTER_AREA), 86)
webp('card-athens.webp', cv2.resize(ath, (1000, 776), interpolation=cv2.INTER_AREA), 82)
webp('card-socrates.webp', cv2.resize(soc, (1000, 657), interpolation=cv2.INTER_AREA), 82)
# share/OG image: the two side by side
og = np.zeros((630, 1200, 3), np.uint8); og[:] = (14, 18, 22)
og[65:65 + 466, 0:600] = cv2.resize(ath[700:2400, 690:3140], (600, 466), interpolation=cv2.INTER_AREA)
og[65:65 + 395, 600:1200] = cv2.resize(soc, (600, 395), interpolation=cv2.INTER_AREA)
cv2.imwrite(os.path.join(A, 'og.jpg'), og, [cv2.IMWRITE_JPEG_QUALITY, 84])


# ---- noise helpers ----------------------------------------------------------------
def fbm(n, octaves=6, base=4, seed=0):
    r = np.random.default_rng(seed)
    out = np.zeros((n, n), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        g = base * 2 ** o
        small = r.random((g, g)).astype(np.float32)
        small = np.pad(small, 1, mode='wrap')          # tileable
        up = cv2.resize(small, (n * (g + 2) // g, n * (g + 2) // g), interpolation=cv2.INTER_CUBIC)
        o0 = n // g
        out += amp * up[o0:o0 + n, o0:o0 + n]; tot += amp; amp *= 0.5
    return out / tot


def marble(n, base, vein, seed, freq=3.0, sharp=10.0, angle=0.6):
    f = fbm(n, 6, 3, seed)
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32) / n
    t = (xx * np.cos(angle) + yy * np.sin(angle)) * freq + f * 4.0
    v = (1 - np.abs(np.sin(t * np.pi))) ** sharp
    mott = fbm(n, 5, 2, seed + 9)
    col = np.array(base, np.float32)[None, None] * (0.9 + 0.2 * mott[..., None])
    return col * (1 - v[..., None]) + np.array(vein, np.float32)[None, None] * v[..., None]


def normal_from_height(hm, strength):
    gx = cv2.Sobel(hm, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(hm, cv2.CV_32F, 0, 1, ksize=3)
    nx, ny, nz = -gx * strength, gy * strength, np.ones_like(hm)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    nm = np.dstack([nz / l, ny / l, nx / l])            # BGR = (z, y, x)
    return ((nm * 0.5 + 0.5) * 255).astype(np.uint8)


# ---- inlaid floor: one 4.6 m module ------------------------------------------------
N = 2048
white = marble(N, (226, 230, 232), (150, 150, 152), 1, 2.5, 14)   # BGR
porph = marble(N, (40, 34, 120), (70, 70, 160), 2, 9, 3)          # red porphyry
serp = marble(N, (64, 92, 40), (120, 150, 110), 3, 7, 6)          # green serpentine
giallo = marble(N, (90, 170, 205), (60, 120, 160), 4, 4, 8)       # giallo antico
pav = marble(N, (205, 210, 215), (60, 70, 100), 5, 5, 6, 1.2)     # pavonazzetto
yy, xx = np.mgrid[0:N, 0:N].astype(np.float32) / N
cx, cy = xx - 0.5, yy - 0.5
r = np.sqrt(cx * cx + cy * cy)
edge = np.minimum(np.minimum(xx, 1 - xx), np.minimum(yy, 1 - yy))
floor = white.copy()
lab = np.zeros((N, N), np.int8)
def put(m, mat, k):
    floor[m] = mat[m]; lab[m] = k
put(edge < 0.075, porph, 1)
put((edge >= 0.075) & (edge < 0.095), giallo, 2)
diamond = (np.abs(cx) + np.abs(cy)) < 0.40
put(diamond & (edge >= 0.095), pav, 3)
put(r < 0.36, porph, 4)
put(r < 0.33, giallo, 5)
put(r < 0.29, serp, 6)
put(r < 0.12, porph, 7)
for qx in (0.2, 0.8):
    for qy in (0.2, 0.8):
        rr = np.sqrt((xx - qx) ** 2 + (yy - qy) ** 2)
        put(rr < 0.075, serp, 8); put(rr < 0.05, porph, 9)
floor = floor * 0.82 + floor.mean(axis=2, keepdims=True) * 0.18   # calm the colours
grout = (cv2.morphologyEx(lab.astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((5, 5), np.uint8)) > 0)
floor[grout] *= 0.55
webp('floor.webp', np.clip(floor, 0, 255).astype(np.uint8), 84)
webp('floor-s.webp', cv2.resize(np.clip(floor, 0, 255).astype(np.uint8), (1024, 1024), interpolation=cv2.INTER_AREA), 84)


# ---- coffer: albedo, normal, roughness/metalness -----------------------------------
C = 1024
yy, xx = np.mgrid[0:C, 0:C].astype(np.float32) / C
e = np.minimum(np.minimum(xx, 1 - xx), np.minimum(yy, 1 - yy))     # distance to cell edge
cx, cy = xx - 0.5, yy - 0.5
r = np.sqrt(cx * cx + cy * cy); ang = np.arctan2(cy, cx)
gold = np.array((60, 150, 205), np.float32)        # BGR gilt
stucco = np.array((200, 214, 222), np.float32)
lapis = np.array((120, 40, 22), np.float32)
lap = fbm(C, 6, 4, 11)
fleck = (fbm(C, 2, 128, 12) > 0.86).astype(np.float32)               # pyrite flecks
alb = np.zeros((C, C, 3), np.float32); hgt = np.zeros((C, C), np.float32)
rough = np.full((C, C), 0.8, np.float32); metal = np.zeros((C, C), np.float32)
rib = e < 0.06
alb[rib] = gold; hgt[rib] = 1.0 - (np.abs(e[rib] - 0.03) / 0.03) ** 2 * 0.3; rough[rib] = 0.32; metal[rib] = 1
st1 = (e >= 0.06) & (e < 0.13)
t = (e[st1] - 0.06) / 0.07
alb[st1] = stucco * (0.95 - 0.25 * t)[:, None]; hgt[st1] = 0.9 - 0.5 * t
bead = st1 & (np.abs(e - 0.095) < 0.012)
alb[bead] = gold; metal[bead] = 1; rough[bead] = 0.35
st2 = (e >= 0.13) & (e < 0.16)
alb[st2] = gold * 0.85; hgt[st2] = 0.35; metal[st2] = 1; rough[st2] = 0.4
pan = e >= 0.16
alb[pan] = lapis * (0.75 + 0.5 * lap[pan])[:, None]
alb[pan & (fleck > 0)] = gold * 1.1; hgt[pan] = 0.25; rough[pan] = 0.45
pet = 0.20 + 0.035 * np.cos(ang * 8) ** 2
ros = r < pet
alb[ros] = gold * (0.75 + 0.35 * np.cos(ang[ros] * 16) ** 2)[:, None]
hgt[ros] = 0.25 + 0.55 * np.sqrt(np.clip(1 - r[ros] / pet[ros], 0, 1)); metal[ros] = 1; rough[ros] = 0.3
core = r < 0.05
alb[core] = gold * 1.05; hgt[core] = 0.95
hgt = cv2.GaussianBlur(hgt, (0, 0), 2.0)
webp('coffer.webp', np.clip(alb, 0, 255).astype(np.uint8), 86)
webp('coffer-n.webp', normal_from_height(hgt, 14.0), 90)
rm = np.dstack([metal * 255, rough * 255, np.full_like(rough, 255)])  # BGR -> B=metal, G=rough
webp('coffer-rm.webp', rm.astype(np.uint8), 90)

# ---- plaster, fluting, dado marble -------------------------------------------------
P = 512
pl = fbm(P, 6, 4, 21)
plaster = np.dstack([196 + 20 * pl, 208 + 20 * pl, 220 + 18 * pl])
webp('plaster.webp', np.clip(plaster, 0, 255).astype(np.uint8), 82)
xx = np.arange(256, dtype=np.float32) / 256
flutes = 7
ph = (xx * flutes) % 1.0
prof = np.where((ph > 0.12) & (ph < 0.88), -np.sqrt(np.clip(1 - ((ph - 0.5) / 0.38) ** 2, 0, 1)), 0)
hm = np.tile(prof[None, :], (256, 1)).astype(np.float32)
webp('flute-n.webp', normal_from_height(hm, 12.0), 92)
dado = marble(1024, (70, 95, 140), (40, 50, 80), 31, 2.0, 6)   # warm brecciated dado
webp('dado.webp', np.clip(dado, 0, 255).astype(np.uint8), 84)
bust = marble(512, (225, 228, 230), (175, 175, 180), 41, 2.0, 20)
webp('bust.webp', np.clip(bust, 0, 255).astype(np.uint8), 84)


# ---- ambient loops (periodic by construction, padded so any L-window loops) --------
SR = 44100; L = 32.0; n = int(SR * L)
t = np.arange(n) / SR


def q(f):  # snap a frequency to whole cycles per loop
    return round(f * L) / L


def tone(f, harm, amp_lfo=0.0, lfo=1 / 16):
    s = np.zeros(n)
    for k, a in harm:
        s += a * np.sin(2 * np.pi * q(f * k) * t + rng.random() * 6.28)
    return s * (1 + amp_lfo * np.sin(2 * np.pi * q(lfo) * t + rng.random() * 6.28))


def shaped_noise(lo, hi, tilt):
    spec = np.fft.rfft(rng.standard_normal(n))
    fr = np.fft.rfftfreq(n, 1 / SR)
    g = np.where((fr > lo) & (fr < hi), 1.0, 0.0) / np.maximum(fr, 20) ** tilt
    g = cv2.GaussianBlur(g.astype(np.float32)[None], (0, 0), 200)[0]
    return np.fft.irfft(spec * g, n)


def reverb(x, secs=3.5):
    ir = rng.standard_normal(int(SR * secs)) * np.exp(-np.arange(int(SR * secs)) / (SR * secs / 6))
    ir = np.pad(ir, (0, n - len(ir)))
    return np.fft.irfft(np.fft.rfft(x) * np.fft.rfft(ir), n)   # circular: stays periodic


def norm(x, peak):
    return x / np.max(np.abs(x)) * peak


def write(name, L_, R_):
    pad = SR  # one second of the loop's own content either side
    st = np.stack([L_, R_], 1)
    st = np.concatenate([st[-pad:], st, st[:pad]])
    raw = os.path.join(HERE, name + '.f32')
    st.astype(np.float32).tofile(raw)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', raw,
                    '-c:a', 'libmp3lame', '-b:a', '112k', os.path.join(AU, name + '.mp3')], check=True)
    os.remove(raw)


D2 = 73.42
day_pad = sum(tone(D2 * m, [(1, 1), (2, .35), (3, .12)], .35, lfo) * a for m, a, lfo in
              [(1, .5, 1/32), (1.5, .45, 1/16), (2, .4, 3/32), (2.5, .22, 1/8), (3, .3, 5/32), (4.5, .12, 3/16)])
air = shaped_noise(300, 9000, 0.6)
dl = norm(reverb(day_pad) * 0.6 + day_pad * 0.4, 0.5) + norm(air, 0.08)
dr = norm(reverb(day_pad) * 0.6 + day_pad * 0.4, 0.5) + norm(np.roll(air, n // 3), 0.08)
write('day', norm(dl, 0.55), norm(dr, 0.55))

night_pad = sum(tone(D2 * m, [(1, 1), (2, .2)], .5, lfo) * a for m, a, lfo in
                [(0.5, .6, 1/32), (0.75, .35, 1/16), (1.2, .25, 3/32), (1.5, .2, 1/8)])
hum = shaped_noise(40, 600, 1.0)
crack = np.zeros(n)
for _ in range(70):                 # the lamp: small sputters
    i = rng.integers(0, n - 2000); ln = rng.integers(60, 600)
    crack[i:i + ln] += rng.standard_normal(ln) * np.exp(-np.arange(ln) / (ln / 4)) * rng.random()
crack = np.fft.irfft(np.fft.rfft(crack) * (np.fft.rfftfreq(n, 1 / SR) > 1500), n)
nl = norm(reverb(night_pad) * 0.7 + night_pad * 0.3, 0.45) + norm(hum, 0.12) + norm(crack, 0.10)
nr = norm(reverb(night_pad) * 0.7 + night_pad * 0.3, 0.45) + norm(np.roll(hum, n // 2), 0.12) + norm(np.roll(crack, n // 5), 0.10)
write('night', norm(nl, 0.5), norm(nr, 0.5))
print('ok')
