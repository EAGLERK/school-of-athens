import * as THREE from 'three';
import { buildRoom, athensToWorld, socToWorld, inFresco, FRESCO, PAINTING } from './room.js';
import { Film } from './film.js';

// ---- timeline ----------------------------------------------------------------------------
// page progress p: [0,FILM0) room by day, [FILM0,FILM1] film, (FILM1,NIGHT_END] night pull-back
const FILM0 = 0.15, FILM1 = 0.86, NIGHT_END = 0.955;
const FRAMES = 540;
const pAtFrame = (f) => FILM0 + (f / (FRAMES - 1)) * (FILM1 - FILM0);
const frameAt = (p) => clamp((p - FILM0) / (FILM1 - FILM0), 0, 1) * (FRAMES - 1);
// first and last film frames as painting crops (keep in sync with build/film.py)
const FIRST = { cx: 1915, cy: 1658, H: 1367 };
const LAST = { cx: 1920, cy: 1261, H: 2160 };
const CHAPTERS = [0, pAtFrame(0) + 0.0004, pAtFrame(70), pAtFrame(136), pAtFrame(236), pAtFrame(332), FILM1 + 0.024];
const CH_NAMES = ['I · The stanza', 'II · The School of Athens', 'III · Plato and Aristotle', 'IV · The painted halls', 'V · The passage', 'VI · The Death of Socrates', 'VII · Night'];

// ---- quality: 0 = everything ... 6 = bare --------------------------------------------------
const LEVELS = [
  { dpr: 2, shadow: 4096, reflect: 1, lampShadow: true, film: '1080', small: false, aa: true, dust: 900, shafts: true, aniso: 16, vaultSeg: 128 },
  { dpr: 2, shadow: 2048, reflect: 0.75, lampShadow: true, film: '1080', small: false, aa: true, dust: 700, shafts: true, aniso: 8, vaultSeg: 96 },
  { dpr: 1.5, shadow: 2048, reflect: 0.5, lampShadow: false, film: '1080', small: false, aa: true, dust: 500, shafts: true, aniso: 8, vaultSeg: 96 },
  { dpr: 1.25, shadow: 1024, reflect: 0.5, lampShadow: false, film: '720', small: false, aa: true, dust: 400, shafts: true, aniso: 4, vaultSeg: 64 },
  { dpr: 1, shadow: 1024, reflect: 0.35, lampShadow: false, film: '720', small: true, aa: false, dust: 250, shafts: true, aniso: 4, vaultSeg: 64 },
  { dpr: 1, shadow: 512, reflect: 0, lampShadow: false, film: '720', small: true, aa: false, dust: 120, shafts: true, aniso: 2, vaultSeg: 48 },
  { dpr: 0.75, shadow: 0, reflect: 0, lampShadow: false, film: '720', small: true, aa: false, dust: 0, shafts: false, aniso: 1, vaultSeg: 48 },
];
const qParam = new URLSearchParams(location.search).get('q');
const pinned = qParam !== null && /^[0-6]$/.test(qParam);
let level = pinned ? +qParam : detectLevel();
let Q = LEVELS[level];

function detectLevel() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) < 600;
  let lvl = coarse ? (small ? 4 : 3) : 2;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 6;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const r = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
    if (/swiftshader|llvmpipe|software|basic render/i.test(r)) lvl = 6;
    else if (!coarse && /apple m\d|rtx|radeon (rx|pro)|geforce|arc\(?tm\)? a/i.test(r)) lvl = 1;
    else if (!coarse && /intel/i.test(r)) lvl = 3;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* keep the guess */ }
  if (navigator.deviceMemory && navigator.deviceMemory < 4) lvl = Math.max(lvl, 4);
  return lvl;
}

// ---- dom --------------------------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const roomCanvas = $('#room'), filmCanvas = $('#film'), fctx = filmCanvas.getContext('2d');
const veil = $('#veil');
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(t, 0, 1));

// ---- renderer ---------------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ canvas: roomCanvas, antialias: Q.aa, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = !!Q.shadow;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.autoClear = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f0d0b);
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 60);

// blot reveal: a full-screen ink layer that opens from the middle
const overlay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: { r: { value: -0.4 }, aspect: { value: 1 }, time: { value: 0 }, ink: { value: new THREE.Color(0x0f0d0b) } },
  transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform float r; uniform float aspect; uniform float time; uniform vec3 ink; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
      return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
    void main(){
      vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
      float d = length(p) / length(vec2(aspect, 1.0) * 0.5);
      float field = d * 0.78 + (fbm(p * 3.2 + 4.0) - 0.5) * 0.7 + (fbm(p * 11.0 - time * 0.03) - 0.5) * 0.16;
      float a = smoothstep(r - 0.015, r + 0.015, field);
      float rim = smoothstep(0.07, 0.0, field - r) * a;
      gl_FragColor = vec4(mix(ink, ink * 0.4, rim), a);
    }`,
}));
overlay.frustumCulled = false;
const overlayScene = new THREE.Scene(); overlayScene.add(overlay);
const overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

// ---- loading with a real count ---------------------------------------------------------------------
const items = [];
function track(url, kind = 'blob') {
  const it = { got: 0, total: 0, done: false };
  items.push(it);
  it.promise = fetch(url).then(async (res) => {
    if (!res.ok) throw new Error(url + ' ' + res.status);
    it.total = +res.headers.get('content-length') || 0;
    const reader = res.body.getReader(), parts = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); it.got += value.length; }
    it.done = true;
    const blob = new Blob(parts);
    return kind === 'buffer' ? blob.arrayBuffer() : blob;
  });
  return it.promise;
}
const progress = () => {
  let s = 0;
  for (const it of items) s += it.done ? 1 : it.total ? Math.min(0.99, it.got / it.total) : 0;
  return items.length ? s / items.length : 0;
};
async function texture(url) {
  const blob = await track(url);
  const img = new Image(); img.src = URL.createObjectURL(blob);
  await img.decode();
  const t = new THREE.Texture(img); t.needsUpdate = true;
  return t;
}

const sfx = Q.small ? '-s' : '';
const TEX = {
  plaster: 'assets/plaster.webp', dado: 'assets/dado.webp', flute: 'assets/flute-n.webp', bust: 'assets/bust.webp',
  coffer: 'assets/coffer.webp', cofferN: 'assets/coffer-n.webp', cofferRM: 'assets/coffer-rm.webp',
  floor: `assets/floor${sfx}.webp`, fresco: `assets/fresco${sfx}.webp`,
};
let room, manifest, film, filmTier;
const films = {};
const audioBufs = {};
const isPortrait = () => innerWidth < innerHeight;
const tierFor = () => (isPortrait() ? 'p720' : Q.film);

async function load() {
  const texP = Promise.all(Object.entries(TEX).map(async ([k, u]) => [k, await texture(u)]));
  const manP = track('film/manifest.json').then((b) => b.text()).then(JSON.parse);
  const dayP = track('audio/day.mp3', 'buffer').then((b) => (audioBufs.day = b));
  manifest = await manP;
  film = getFilm(tierFor());
  // the first pack counts toward the preloader
  const first = { got: 0, total: film.packs[0].bytes, done: false }; items.push(first);
  film.onbytes = () => { first.got = Math.min(film.loadedBytes, first.total); };
  const primeP = film.prime([0, 1, 2, 3, 4, 5, 6, 7, 8]).then(() => (first.done = true));
  const tex = Object.fromEntries(await texP);
  tex.socrates = new THREE.Texture();      // swapped in after Enter
  room = buildRoom(renderer, scene, tex, Q);
  room.setMood(0);
  resize();
  room.bakeEnv();
  renderer.compile(scene, camera);
  await Promise.all([primeP, dayP]);
}

function getFilm(tier) {
  if (!films[tier]) { films[tier] = new Film('film/', tier, manifest[tier]); films[tier].pump(); }
  return films[tier];
}

// ---- preloader: count up, draw the frame into the Enter button ---------------------------------------
const countEl = $('#count'), framePath = $('#enter-frame'), enterBtn = $('#enter'), loaderEl = $('#loader');
let shown = 0, loaded = false;
function tickLoader(dt) {
  const target = loaded ? 1 : progress() * 0.97;
  shown = Math.min(target, shown + Math.max(0.004, (target - shown) * (1 - Math.exp(-dt * 5))));
  countEl.textContent = String(Math.floor(shown * 100)).padStart(3, '0');
  framePath.style.strokeDashoffset = String(1 - shown);
  if (loaded && shown >= 1 && enterBtn.disabled) {
    enterBtn.disabled = false; enterBtn.setAttribute('aria-label', 'Enter');
    loaderEl.classList.add('ready'); enterBtn.focus({ preventScroll: true });
  }
}
load().then(() => (loaded = true), (e) => { console.error(e); countEl.textContent = 'Could not load. Reload the page.'; });

let entered = false, reveal = -1, revealStart = 0;
enterBtn.addEventListener('click', () => {
  if (entered) return;
  entered = true;
  audio.start();
  loaderEl.classList.add('leaving');
  setTimeout(() => {
    loaderEl.hidden = true;
    document.body.classList.remove('is-loading');
    document.body.classList.add('entered');
    reveal = 0; revealStart = performance.now();
    // background work once we're in: David's canvas for the night, the night loop
    texture(`assets/socrates${sfx}.webp`).then((t) => room.setPaintingTexture(t));
    track('audio/night.mp3', 'buffer').then((b) => audio.add('night', b));
  }, 480);
});

// ---- audio: two loops cross-fading along the timeline ----------------------------------------------
const audio = {
  ctx: null, master: null, g: {}, on: true, mix: 0,
  async start() {
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0; this.master.connect(this.ctx.destination);
      this.master.gain.setTargetAtTime(this.on ? 0.8 : 0, this.ctx.currentTime + 0.2, 1.2);
      await this.add('day', audioBufs.day);
    } catch (e) { console.warn('audio off', e); }
  },
  async add(name, ab) {
    if (!this.ctx) return;
    const buf = await this.ctx.decodeAudioData(ab);
    const src = this.ctx.createBufferSource(), g = this.ctx.createGain();
    src.buffer = buf; src.loop = true;
    // files carry one second of the loop's own sound either side; any 32 s window loops cleanly
    src.loopStart = 1; src.loopEnd = buf.duration - 1;
    g.gain.value = 0; src.connect(g).connect(this.master); src.start(0, 1);
    this.g[name] = g;
  },
  set(mix) {
    if (!this.ctx) return;
    this.mix = mix;
    const t = this.ctx.currentTime;
    this.g.day?.gain.setTargetAtTime(Math.cos(mix * Math.PI / 2), t, 0.25);
    this.g.night?.gain.setTargetAtTime(Math.sin(mix * Math.PI / 2), t, 0.25);
  },
  toggle() {
    this.on = !this.on;
    $('#sound').setAttribute('aria-pressed', String(this.on));
    if (this.ctx) { this.ctx.resume(); this.master.gain.setTargetAtTime(this.on ? 0.8 : 0, this.ctx.currentTime, 0.3); }
  },
};
$('#sound').addEventListener('click', () => audio.toggle());
document.addEventListener('visibilitychange', () => { if (audio.ctx) document.hidden ? audio.ctx.suspend() : audio.ctx.resume(); });

// ---- camera paths ------------------------------------------------------------------------------------
const START = { pos: new THREE.Vector3(0, 1.65, 6.6), look: new THREE.Vector3(0, 4.25, -8) };
let dayPath, nightPath, vfov = 50;
function pose(toWorld, S, crop, aspect) {
  // the 3D view that shows exactly what a cover-fitted film frame shows
  const A = film.w / film.h;
  const visH = (aspect > A ? crop.H * (A / aspect) : crop.H) * S;
  const c = toWorld(crop.cx, crop.cy);
  const d = visH / 2 / Math.tan(THREE.MathUtils.degToRad(vfov) / 2);
  return { pos: new THREE.Vector3(c.x, c.y, c.z + d), look: c };
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);
function buildPaths() {
  const a = innerWidth / innerHeight;
  vfov = a < 1 ? 62 : 50;
  const end = pose(athensToWorld, FRESCO.S, FIRST, a);
  dayPath = {
    pos: new THREE.CatmullRomCurve3([START.pos, V(0.55, 1.62, 3.6), V(0.15, 1.45, 0.6), V(0, 1.5, -1.8), V(0, 2.9, -3.3), end.pos], false, 'centripetal'),
    look: new THREE.CatmullRomCurve3([START.look, V(0, 4.0, -8), V(0, 3.4, -8), V(0, 3.6, -8), V(0, 4.3, -8), end.look], false, 'centripetal'),
  };
  const st = pose(socToWorld, PAINTING.S, LAST, a);
  nightPath = {
    pos: new THREE.CatmullRomCurve3([st.pos, V(0, 2.6, -3.4), V(-0.4, 1.7, 0.3), V(0.2, 1.62, 3.8), START.pos], false, 'centripetal'),
    look: new THREE.CatmullRomCurve3([st.look, V(0, 3.3, -8), V(0, 3.7, -8), V(0, 4.1, -8), START.look], false, 'centripetal'),
  };
}
function placeCamera(path, t, time, sway) {
  camera.position.copy(path.pos.getPointAt(t));
  const look = path.look.getPointAt(t);
  if (sway > 0) {
    camera.position.x += Math.sin(time * 0.31) * 0.05 * sway;
    camera.position.y += Math.sin(time * 0.23 + 1) * 0.025 * sway;
  }
  camera.lookAt(look);
}

// ---- resize --------------------------------------------------------------------------------------------
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, Q.dpr));
  renderer.setSize(w, h, false);
  const fd = Math.min(devicePixelRatio, 2);
  filmCanvas.width = Math.round(w * fd); filmCanvas.height = Math.round(h * fd);
  filmDirty = true;
  if (manifest) {
    const t = tierFor();
    if (t !== filmTier) { filmTier = t; film = getFilm(t); film.update(frameAt(pSmooth)); }
    buildPaths();
  }
  camera.aspect = w / h; camera.fov = vfov; camera.updateProjectionMatrix();
  overlay.material.uniforms.aspect.value = w / h;
  if (room) room.setMirrorSize(w * renderer.getPixelRatio(), h * renderer.getPixelRatio(), Q.reflect);
}
addEventListener('resize', resize);

// ---- beats, rail, card, cursor ----------------------------------------------------------------------------
const beats = [...document.querySelectorAll('.beat')].map((el) => {
  const [kind, range] = el.dataset.at.split(':');
  let [a, b] = range.split('-').map(Number);
  if (kind === 'f') { a = pAtFrame(a); b = pAtFrame(b); }
  return { el, a, b, o: -1 };
});
function updateBeats(p) {
  const fade = 0.0065;
  for (const bt of beats) {
    let o = smooth(bt.a, bt.a + fade, p) * (1 - smooth(bt.b - fade, bt.b, p));
    if (restoring) o = 0;
    if (Math.abs(o - bt.o) < 0.002) continue;
    bt.o = o;
    bt.el.style.opacity = o.toFixed(3);
    bt.el.style.visibility = o > 0.001 ? 'visible' : 'hidden';
    bt.el.style.transform = `translateY(${((1 - o) * 14).toFixed(1)}px)`;
  }
}

const railBtns = [...document.querySelectorAll('#rail button')];
const railBar = $('#rail-bar'), railNow = $('#rail-now');
let chapter = -1;
function updateRail(p) {
  let c = 0;
  CHAPTERS.forEach((cp, i) => { if (p >= cp - 0.002) c = i; });
  const portrait = matchMedia('(max-width: 700px) and (orientation: portrait)').matches;
  railBar.style.transform = portrait ? `scaleX(${p.toFixed(4)})` : `scaleY(${p.toFixed(4)})`;
  if (c === chapter) return;
  chapter = c;
  railBtns.forEach((b, i) => { b.classList.toggle('on', i === c); b.toggleAttribute('aria-current', i === c); });
  railNow.textContent = CH_NAMES[c];
}
function jump(i) {
  const p = CHAPTERS[i] + (i ? 0.004 : 0);
  veil.classList.add('on');
  setTimeout(() => {
    scrollTo({ top: p * maxScroll(), behavior: 'instant' });
    pSmooth = p; film?.update(frameAt(p));
    setTimeout(() => veil.classList.remove('on'), 120);
  }, 260);
  $('#rail').classList.remove('open'); $('#open-rail').setAttribute('aria-expanded', 'false');
}
document.querySelectorAll('[data-chapter]').forEach((b) => b.addEventListener('click', (e) => { e.preventDefault(); if (entered) jump(+b.dataset.chapter); }));
$('#open-rail').addEventListener('click', (e) => {
  const open = $('#rail').classList.toggle('open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
});

const card = $('#card'), tabs = [$('#tab-athens'), $('#tab-socrates')], panes = [$('#pane-athens'), $('#pane-socrates')];
function selectTab(i) {
  tabs.forEach((t, j) => { t.setAttribute('aria-selected', String(i === j)); t.tabIndex = i === j ? 0 : -1; panes[j].hidden = i !== j; });
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(i));
  t.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { selectTab(1 - i); tabs[1 - i].focus(); } });
});
$('#open-card').addEventListener('click', () => { selectTab(pSmooth > pAtFrame(236) ? 1 : 0); card.showModal(); card.scrollTop = 0; });
card.addEventListener('click', (e) => { if (e.target === card) card.close(); });   // backdrop

// "Please do not touch!" over the painting
const touchEl = $('#touch');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const mouse = { x: -1, y: -1, in: false, overUI: false };
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  mouse.x = e.clientX; mouse.y = e.clientY; mouse.in = true;
  mouse.overUI = !!e.target.closest('button, a, dialog, #rail, #top, .beat.end');
});
document.documentElement.addEventListener('pointerleave', () => (mouse.in = false));
addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' || !entered || e.target.closest('button, a, dialog, #rail, #top')) return;
  if (!overPainting(e.clientX, e.clientY)) return;
  touchEl.style.left = e.clientX + 'px'; touchEl.style.top = e.clientY - 56 + 'px';
  touchEl.classList.add('on'); clearTimeout(touchEl._t);
  touchEl._t = setTimeout(() => touchEl.classList.remove('on'), 1300);
});
function overPainting(x, y) {
  if (mode === 'film') return true;
  const target = mode === 'day' ? room.fresco : room.painting;
  if (!target.visible) return false;
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects([target, ...occluders()], false)[0];
  if (!hit || hit.object !== target) return false;
  if (mode !== 'day') return true;
  return inFresco(213 + hit.uv.x * 3404, 20 + (1 - hit.uv.y) * 2350);
}
const occluders = () => [room.lamp];
function updateCursor() {
  if (!finePointer.matches || !entered) return;
  const on = mouse.in && !mouse.overUI && !card.open && overPainting(mouse.x, mouse.y);
  document.body.classList.toggle('no-touch-cursor', on);
  touchEl.classList.toggle('on', on);
  if (on) { touchEl.style.left = mouse.x + 'px'; touchEl.style.top = mouse.y + 'px'; }
}

// ---- watch again: day and the fresco come back, the page is a circle ------------------------------------
let restoring = false, restoreStart = 0, restoreT = 0;   // wall-clock, so slow frames can't stretch it
$('#again').addEventListener('click', () => {
  if (restoring) return;
  restoring = true; restoreStart = performance.now();
  document.body.classList.add('is-locked');
});

// ---- auto quality ---------------------------------------------------------------------------------------
let perfAcc = 0, perfN = 0, perfHold = 3;
function watchPerf(dt) {
  if (pinned || level >= 6) return;
  if ((perfHold -= dt) > 0) return;
  perfAcc += dt; perfN++;
  if (perfN < 90) return;
  const avg = perfAcc / perfN; perfAcc = perfN = 0;
  if (avg > 1 / 38) {
    level++; Q = { ...LEVELS[level], small: Q.small, aa: Q.aa, lampShadow: Q.lampShadow, vaultSeg: Q.vaultSeg, film: Q.film };
    room.setQuality(Q); resize(); perfHold = 2.5;
    console.info('quality ->', level);
  }
}

// ---- main loop ------------------------------------------------------------------------------------------
const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);
let pSmooth = 0, mode = 'day', filmDirty = true, lastFrame = -1, last = performance.now(), time = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000); last = now; time += dt;
  if (!loaderEl.hidden) tickLoader(dt);
  if (!room) return;

  const pTarget = restoring ? 1 : clamp(scrollY / maxScroll(), 0, 1);
  pSmooth += (pTarget - pSmooth) * (1 - Math.exp(-dt * 7));
  if (Math.abs(pTarget - pSmooth) < 1e-5) pSmooth = pTarget;
  const p = pSmooth;

  mode = p < FILM0 ? 'day' : p <= FILM1 ? 'film' : 'night';
  if (restoring) mode = 'night';
  updateBeats(p); updateRail(p);
  audio.set(restoring ? clamp(1 - (performance.now() - restoreStart) / 2400, 0, 1) : smooth(pAtFrame(200), pAtFrame(330), p));

  // film
  const f = frameAt(p);
  film?.update(f, f > 4 && f < FRAMES - 5 ? 12 : 8);
  if (mode === 'film') {
    if (filmCanvas.style.visibility !== 'visible') filmCanvas.style.visibility = 'visible';
    if (film.dirty || filmDirty || Math.abs(f - lastFrame) > 1e-3) {
      if (film.draw(fctx, f, filmCanvas.width, filmCanvas.height)) { lastFrame = f; filmDirty = false; film.dirty = false; }
    }
  } else if (filmCanvas.style.visibility !== 'hidden') filmCanvas.style.visibility = 'hidden';

  // the room
  if (mode !== 'film') {
    if (mode === 'day') {
      const t = ease(p / FILM0);
      room.setMood(0);
      room.lit.fresco = THREE.MathUtils.lerp(0.97, 1, smooth(0.8, 1, t));
      placeCamera(dayPath, t, time, 1 - smooth(0, 0.08, t));
    } else if (restoring) {
      restoreT = (performance.now() - restoreStart) / 1000;
      const m = 1 - ease(restoreT / 2.4);
      room.setMood(m);
      room.lit.fresco = 0.97; room.lit.painting = 0;
      placeCamera(nightPath, 1, time, 0);
      if (restoreT > 2.6) {
        restoring = false;
        document.body.classList.remove('is-locked');
        scrollTo({ top: 0, behavior: 'instant' });
        pSmooth = 0;
      }
    } else {
      const t = ease((p - FILM1) / (NIGHT_END - FILM1));
      room.setMood(1);
      room.lit.painting = 1 - smooth(0, 0.3, t);
      placeCamera(nightPath, t, time, smooth(0.9, 1, t));
    }
    room.update(time, dt);
    renderer.clear();
    renderer.render(scene, camera);
    if (reveal < 1.25) watchPerf(0); else watchPerf(dt);
  }

  // the ink reveal sits on top of whatever is showing
  if (reveal >= 0 && reveal < 1.25) {
    reveal = (performance.now() - revealStart) / 1000 / (matchMedia('(prefers-reduced-motion: reduce)').matches ? 1.2 : 2.8);
    overlay.material.uniforms.r.value = -0.35 + ease(reveal / 1.25) * 1.75;
    overlay.material.uniforms.time.value = time;
    if (mode === 'film') { renderer.clear(); renderer.render(scene, camera); }
    renderer.render(overlayScene, overlayCam);
  } else if (reveal < 0) {
    renderer.render(overlayScene, overlayCam);
  }
  updateCursor();
}
requestAnimationFrame(frame);
if (new URLSearchParams(location.search).has('debug')) window.__dbg = { THREE, camera, scene, renderer, get room() { return room; } };
