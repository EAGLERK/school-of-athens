// The stanza: a coffered barrel-vaulted room, the fresco as the end-wall lunette,
// and the night version with David's canvas and an oil lamp.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';

export const ROOM = { W: 9.2, L: 16, HS: 4.4 };            // width, length, springline
const R = ROOM.W / 2, ZEND = -ROOM.L / 2;

// Painting pixel -> world. Fresco: 1px = 2.5mm, arch centre (1915,1722) on the springline.
export const FRESCO = { S: 0.0025, cx: 1915, cy: 1722, z: ZEND + 0.012 };
export const athensToWorld = (px, py) => new THREE.Vector3((px - FRESCO.cx) * FRESCO.S, ROOM.HS - (py - FRESCO.cy) * FRESCO.S, FRESCO.z);
export const PAINTING = { S: 4.2 / 3840, cx: 1920, cy: 1261, y: 3.3, z: ZEND + 0.06 };
export const socToWorld = (px, py) => new THREE.Vector3((px - PAINTING.cx) * PAINTING.S, PAINTING.y - (py - PAINTING.cy) * PAINTING.S, PAINTING.z);

// same shape as the alpha mask baked into fresco.webp (build/assets.py)
export function inFresco(px, py) {
  if (py < 1490) return Math.hypot(px - 1915, py - 1722) <= 1700;
  return px >= 340 && px <= 3480 && py <= 2355 && !(px < 690 && py > 2042);
}

const SUN_DIR = new THREE.Vector3(0.62, -0.5, -0.3).normalize();
const WINDOWS = [2.55, -1.55];   // z of the two windows in the left wall
const WIN = { w: 1.3, y0: 2.3, y1: 3.75 };

export function buildRoom(renderer, scene, tex, Q) {
  const aniso = Math.min(Q.aniso, renderer.capabilities.getMaxAnisotropy());
  const T = (t, rx = 1, ry = 1, srgb = true) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = aniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const clone = (t, rx, ry, srgb = true) => T(t.clone(), rx, ry, srgb);

  const plaster = new THREE.MeshStandardMaterial({ map: clone(tex.plaster, 0.5, 0.5), color: 0xf3e8d6, roughness: 0.92, shadowSide: THREE.DoubleSide });
  const stucco = new THREE.MeshStandardMaterial({ color: 0xe6d8bf, roughness: 0.75 });
  const dado = new THREE.MeshStandardMaterial({ map: clone(tex.dado, 0.6, 0.25), roughness: 0.35 });
  const gilt = new THREE.MeshStandardMaterial({ color: 0xd9a54a, metalness: 1, roughness: 0.32 });
  const g = new THREE.Group(); scene.add(g);
  const add = (geo, mat, x = 0, y = 0, z = 0, shadow = true) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    m.castShadow = shadow; m.receiveShadow = true; g.add(m); return m;
  };

  // ---- floor: inlaid marble under a soft mirror -----------------------------------
  const floorMat = new THREE.MeshStandardMaterial({ map: T(tex.floor, 2, ROOM.L / R), roughness: Q.reflect ? 0.3 : 0.16 });
  const floor = add(new THREE.PlaneGeometry(ROOM.W, ROOM.L), floorMat, 0, 0, 0, false);
  floor.rotation.x = -Math.PI / 2;
  let mirror = null;
  if (Q.reflect) {
    mirror = new Reflector(new THREE.PlaneGeometry(ROOM.W, ROOM.L), {
      textureWidth: 512, textureHeight: 512, clipBias: 0.003, shader: MirrorShader,
    });
    mirror.material.transparent = true;
    mirror.material.uniforms.strength = { value: 0.42 };
    mirror.rotation.x = -Math.PI / 2; mirror.position.y = 0.002;
    g.add(mirror);
  }

  // ---- walls -----------------------------------------------------------------------
  // left wall carries the two high windows: extruded so the openings have depth
  const lw = new THREE.Shape();
  lw.moveTo(-ROOM.L / 2, 0); lw.lineTo(ROOM.L / 2, 0); lw.lineTo(ROOM.L / 2, ROOM.HS); lw.lineTo(-ROOM.L / 2, ROOM.HS); lw.closePath();
  for (const z of WINDOWS) {
    const h = new THREE.Path(), a = WIN.w / 2, top = WIN.y1 - a;
    h.moveTo(z - a, WIN.y0); h.lineTo(z + a, WIN.y0); h.lineTo(z + a, top);
    h.absarc(z, top, a, 0, Math.PI, false); h.lineTo(z - a, WIN.y0);
    lw.holes.push(h);
  }
  const lwGeo = new THREE.ExtrudeGeometry(lw, { depth: 0.45, bevelEnabled: false, curveSegments: 24 });
  const left = add(lwGeo, plaster);
  left.rotation.y = -Math.PI / 2; left.position.x = -R;   // shape x -> world +z, extrusion -> outward
  const right = add(new THREE.PlaneGeometry(ROOM.L, ROOM.HS), plaster, R, ROOM.HS / 2, 0);
  right.rotation.y = -Math.PI / 2;
  const back = add(new THREE.PlaneGeometry(ROOM.W, ROOM.HS + R), plaster, 0, (ROOM.HS + R) / 2, ROOM.L / 2);
  back.rotation.y = Math.PI;
  // end wall: rectangle + the lunette under the vault
  const ew = new THREE.Shape();
  ew.moveTo(-R, 0); ew.lineTo(R, 0); ew.lineTo(R, ROOM.HS); ew.absarc(0, ROOM.HS, R, 0, Math.PI, false); ew.lineTo(-R, 0);
  add(new THREE.ShapeGeometry(ew, 48), plaster, 0, 0, ZEND);

  // iron mullions in the openings
  const iron = new THREE.MeshStandardMaterial({ color: 0x1d1a17, roughness: 0.6, metalness: 0.4 });
  for (const z of WINDOWS) {
    add(new THREE.BoxGeometry(0.04, WIN.y1 - WIN.y0, 0.04), iron, -R - 0.2, (WIN.y0 + WIN.y1) / 2, z);
    for (const y of [WIN.y0 + 0.5, WIN.y0 + 1.0]) add(new THREE.BoxGeometry(0.04, 0.035, WIN.w), iron, -R - 0.2, y, z);
  }

  // sky beyond the windows
  const skyMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const sky = add(new THREE.PlaneGeometry(ROOM.L, 6), skyMat, -R - 1.2, 3, 0, false);
  sky.rotation.y = Math.PI / 2;

  // dado along the walls, with a moulding
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.05, 1.05, ROOM.L), dado, s * (R - 0.025), 0.525, 0);
    add(new THREE.BoxGeometry(0.1, 0.07, ROOM.L), stucco, s * (R - 0.05), 1.08, 0);
  }
  add(new THREE.BoxGeometry(ROOM.W, 1.05, 0.05), dado, 0, 0.525, ZEND + 0.025);
  add(new THREE.BoxGeometry(ROOM.W, 0.07, 0.1), stucco, 0, 1.08, ZEND + 0.05);
  // cornice under the fresco (day only: David's canvas hangs across it at night)
  const cornice = add(new THREE.BoxGeometry(7.9, 0.12, 0.16), stucco, 0, 2.72, ZEND + 0.08);
  // the real door that cuts the fresco's lower-left corner
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x0c0a08, roughness: 1 });
  const dx0 = athensToWorld(355, 0).x, dx1 = athensToWorld(690, 0).x, dtop = athensToWorld(0, 2042).y;
  add(new THREE.PlaneGeometry(dx1 - dx0 - 0.24, dtop - 0.2), doorMat, (dx0 + dx1) / 2, (dtop - 0.2) / 2, ZEND + 0.02);
  for (const x of [dx0 + 0.06, dx1 - 0.06]) add(new THREE.BoxGeometry(0.12, dtop, 0.12), stucco, x, dtop / 2, ZEND + 0.06);
  add(new THREE.BoxGeometry(dx1 - dx0 + 0.1, 0.16, 0.14), stucco, (dx0 + dx1) / 2, dtop - 0.06, ZEND + 0.07);

  // ---- pilasters, entablature ------------------------------------------------------
  const fluted = new THREE.MeshStandardMaterial({ color: 0xe9dcc4, roughness: 0.7, normalMap: T(tex.flute, 1, 4, false), normalScale: new THREE.Vector2(0.9, 0.9) });
  const PH = ROOM.HS - 0.55;
  const pilaster = (x, z, rotY) => {
    const p = new THREE.Group(); p.position.set(x, 0, z); p.rotation.y = rotY; g.add(p);
    const part = (geo, mat, y) => { const m = new THREE.Mesh(geo, mat); m.position.set(0, y, geo.parameters.depth / 2); m.castShadow = m.receiveShadow = true; p.add(m); };
    part(new THREE.BoxGeometry(0.78, 0.3, 0.26), stucco, 0.15);
    part(new THREE.BoxGeometry(0.62, PH - 0.7, 0.16), fluted, 0.3 + (PH - 0.7) / 2);
    part(new THREE.BoxGeometry(0.76, 0.18, 0.24), stucco, PH - 0.31);
    part(new THREE.BoxGeometry(0.84, 0.22, 0.28), gilt, PH - 0.11);
  };
  for (const z of [7.4, 4.6, 0.5, -3.6, -7.35]) { pilaster(-R, z, Math.PI / 2); pilaster(R, z, -Math.PI / 2); }
  for (const s of [-1, 1]) pilaster(s * 4.25, ZEND, 0);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.34, 0.4, ROOM.L), stucco, s * (R - 0.17), PH + 0.2, 0);
    add(new THREE.BoxGeometry(0.5, 0.15, ROOM.L), gilt, s * (R - 0.25), ROOM.HS - 0.075, 0);
  }

  // ---- coffered barrel vault ---------------------------------------------------------
  const seg = Q.vaultSeg, around = 9, along = 10;
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) {
    const th = (i / seg) * Math.PI, c = Math.cos(th), s = Math.sin(th);
    for (let j = 0; j <= 1; j++) {
      pos.push(R * c, ROOM.HS + R * s, ROOM.L / 2 - j * ROOM.L);
      nor.push(-c, -s, 0); uv.push((i / seg) * around, j * along);
    }
  }
  for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const vg = new THREE.BufferGeometry();
  vg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  vg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  vg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  vg.setIndex(idx);
  const vaultMat = new THREE.MeshStandardMaterial({
    map: T(tex.coffer), normalMap: T(tex.cofferN, 1, 1, false), normalScale: new THREE.Vector2(1.4, 1.4),
    roughnessMap: T(tex.cofferRM, 1, 1, false), metalnessMap: tex.cofferRM, metalness: 1, roughness: 1,
  });
  add(vg, vaultMat, 0, 0, 0, false);
  // transverse ribs at both ends
  for (const z of [ROOM.L / 2 - 0.15, ZEND + 0.15]) {
    const rib = add(new THREE.TorusGeometry(R - 0.05, 0.13, 8, 64, Math.PI), gilt, 0, ROOM.HS, z, false);
    rib.scale.z = 1.4;
  }

  // ---- the fresco and, at night, David's canvas --------------------------------------
  const fw = 3404 * FRESCO.S, fh = 2350 * FRESCO.S;
  const frescoMat = new THREE.MeshBasicMaterial({ map: T(tex.fresco), transparent: true, toneMapped: false });
  frescoMat.map.wrapS = frescoMat.map.wrapT = THREE.ClampToEdgeWrapping;
  const fc = athensToWorld(213 + 1702, 20 + 1175);
  const fresco = add(new THREE.PlaneGeometry(fw, fh), frescoMat, fc.x, fc.y, FRESCO.z, false);

  const pw = 3840 * PAINTING.S, ph = 2522 * PAINTING.S;
  const paintMat = new THREE.MeshBasicMaterial({ map: T(tex.socrates), toneMapped: false, transparent: true });
  paintMat.map.wrapS = paintMat.map.wrapT = THREE.ClampToEdgeWrapping;
  const painting = add(new THREE.PlaneGeometry(pw, ph), paintMat, 0, PAINTING.y, PAINTING.z, false);
  const frame = new THREE.Group(); g.add(frame);
  const fb = 0.2, fd = 0.12;
  for (const [w, h, x, y] of [[pw + 2 * fb, fb, 0, ph / 2 + fb / 2], [pw + 2 * fb, fb, 0, -ph / 2 - fb / 2], [fb, ph, pw / 2 + fb / 2, 0], [fb, ph, -pw / 2 - fb / 2, 0]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, fd), gilt); m.position.set(x, PAINTING.y + y, ZEND + fd / 2); m.castShadow = true; frame.add(m);
  }

  // ---- busts ----------------------------------------------------------------------------
  const marbleMat = new THREE.MeshStandardMaterial({ map: T(tex.bust), color: 0xf4efe6, roughness: 0.42 });
  const herm = new THREE.MeshStandardMaterial({ map: clone(tex.dado, 0.3, 0.6), roughness: 0.3 });
  const bust = (x, z, rotY, tilt) => {
    const b = new THREE.Group(); b.position.set(x, 0, z); b.rotation.y = rotY; g.add(b);
    const m = (geo, mat, px, py, pz, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, mat); o.position.set(px, py, pz); o.scale.set(sx, sy, sz); o.castShadow = o.receiveShadow = true; b.add(o); return o; };
    m(new THREE.BoxGeometry(0.46, 1.25, 0.46), herm, 0, 0.625, 0);
    m(new THREE.BoxGeometry(0.56, 0.07, 0.56), stucco, 0, 1.285, 0);
    m(new THREE.CylinderGeometry(0.11, 0.15, 0.12, 24), marbleMat, 0, 1.38, 0);
    const torso = [[0, 0], [0.24, 0], [0.26, 0.06], [0.25, 0.18], [0.2, 0.28], [0.1, 0.33], [0.075, 0.36], [0, 0.36]].map(([a, c]) => new THREE.Vector2(a, c));
    m(new THREE.LatheGeometry(torso, 32), marbleMat, 0, 1.44, 0, 1.25, 1, 0.62);
    const head = m(new THREE.SphereGeometry(0.115, 32, 24), marbleMat, 0, 1.92, 0.01, 0.86, 1.12, 0.98);
    head.rotation.set(tilt, 0, 0);
    m(new THREE.ConeGeometry(0.022, 0.07, 12), marbleMat, 0, 1.91, 0.115).rotation.x = Math.PI / 2;
    m(new THREE.SphereGeometry(0.1, 24, 16), marbleMat, 0, 1.97, -0.01, 0.95, 0.8, 1.0);   // hair mass
    m(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 16), marbleMat, 0, 1.8, 0);
  };
  bust(-R + 0.45, 6.0, Math.PI / 2, 0.05); bust(-R + 0.45, -5.5, Math.PI / 2, -0.05);
  bust(R - 0.45, 2.55, -Math.PI / 2, 0.08); bust(R - 0.45, -1.55, -Math.PI / 2, 0);

  // ---- the rope ---------------------------------------------------------------------------
  const brass = new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 1, roughness: 0.28 });
  const velvet = new THREE.MeshPhysicalMaterial({ color: 0x6e0d16, roughness: 0.85, sheen: 1, sheenColor: new THREE.Color(0xd04050), sheenRoughness: 0.4 });
  const ROPE_Z = -1.8, posts = [-2.6, 0, 2.6], TOP = 0.95;
  for (const x of posts) {
    add(new THREE.CylinderGeometry(0.16, 0.19, 0.04, 32), brass, x, 0.02, ROPE_Z);
    add(new THREE.CylinderGeometry(0.03, 0.035, TOP, 16), brass, x, TOP / 2, ROPE_Z);
    add(new THREE.SphereGeometry(0.055, 20, 14), brass, x, TOP + 0.03, ROPE_Z);
  }
  for (let i = 0; i < posts.length - 1; i++) {
    const a = posts[i], b = posts[i + 1], pts = [];
    for (let k = 0; k <= 24; k++) { const t = k / 24; pts.push(new THREE.Vector3(a + (b - a) * t, TOP - 0.22 * (1 - (2 * t - 1) ** 2), ROPE_Z)); }
    add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.024, 10), velvet, 0, 0, 0);
  }

  // ---- the lamp (night) -------------------------------------------------------------------
  const lamp = new THREE.Group(); lamp.position.set(1.9, 0, -6.55); g.add(lamp);
  const bronze = new THREE.MeshStandardMaterial({ color: 0x6b4a26, metalness: 1, roughness: 0.38 });
  const prof = [[0, 0], [0.2, 0], [0.2, 0.03], [0.07, 0.09], [0.035, 0.16], [0.022, 0.3], [0.02, 1.55], [0.045, 1.6], [0.09, 1.66], [0.1, 1.69], [0.02, 1.7], [0, 1.7]].map(([a, c]) => new THREE.Vector2(a, c));
  const stand = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), bronze); stand.castShadow = true; lamp.add(stand);
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.08, 24, 16), bronze); body.scale.set(1.3, 0.45, 0.85); body.position.y = 1.74; lamp.add(body);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 0.09, 12), bronze); nozzle.rotation.z = Math.PI / 2.4; nozzle.position.set(-0.12, 1.76, 0); lamp.add(nozzle);
  const glowTex = radial();
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  flame.scale.set(0.07, 0.13, 1); flame.position.set(-0.16, 1.84, 0); lamp.add(flame);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff8a30, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35, toneMapped: false }));
  halo.scale.set(0.9, 0.9, 1); halo.position.copy(flame.position); lamp.add(halo);
  const lampLight = new THREE.PointLight(0xff9c4a, 0, 0, 2);
  lampLight.position.set(-0.16, 1.9, 0.05); lamp.add(lampLight);
  if (Q.lampShadow) { lampLight.castShadow = true; lampLight.shadow.mapSize.set(512, 512); lampLight.shadow.bias = -0.004; }

  // ---- light ------------------------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xfff1dc, 0x6a5440, 1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe2b8, 0);
  sun.position.copy(SUN_DIR).multiplyScalar(-14).add(new THREE.Vector3(0, 0, 0.5));
  sun.target.position.set(0, 0, 0.5); scene.add(sun, sun.target);
  if (Q.shadow) {
    sun.castShadow = true; sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    Object.assign(sun.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 34 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
  }
  const fill = new THREE.PointLight(0xffe8cc, 0, 0, 2); fill.position.set(0, 6.5, 2); scene.add(fill);

  // light shafts + dust
  const shafts = [];
  if (Q.shafts) {
    for (const z of WINDOWS) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(WIN.w * 0.95, WIN.y1 - WIN.y0, 9), shaftMaterial());
      const start = new THREE.Vector3(-R, (WIN.y0 + WIN.y1) / 2, z);
      m.position.copy(start).addScaledVector(SUN_DIR, 4.5);
      m.lookAt(m.position.clone().add(SUN_DIR));
      m.renderOrder = 5; g.add(m); shafts.push(m);
    }
  }
  let dust = null;
  if (Q.dust) {
    const n = Q.dust, p = new Float32Array(n * 3), seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const w = WINDOWS[i % 2], t = Math.random() * 7.5;
      const v = new THREE.Vector3(-R, WIN.y0 + Math.random() * (WIN.y1 - WIN.y0), w + (Math.random() - 0.5) * WIN.w).addScaledVector(SUN_DIR, t);
      p.set([v.x, v.y, v.z], i * 3); seed[i] = Math.random() * 100;
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(p, 3));
    dg.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    dust = new THREE.Points(dg, dustMaterial(glowTex)); dust.renderOrder = 6; g.add(dust);
  }

  // ---- environment for the gilding: baked from the room itself ------------------------------
  function bakeEnv() {
    const pm = new THREE.PMREMGenerator(renderer);
    if (mirror) mirror.visible = false;
    const old = scene.environment; scene.environment = null;
    const rt = pm.fromScene(scene, 0.03, 0.1, 40, { size: 128, position: new THREE.Vector3(0, 3.2, 0) });
    if (mirror) mirror.visible = true;
    if (old) old.dispose?.();
    scene.environment = rt.texture; pm.dispose();
  }

  // ---- mood: 0 = day, 1 = night --------------------------------------------------------------
  const C = (a) => new THREE.Color(a);
  const DAY = { hemi: [C(0xffeedd), C(0x5a4232), 0.5], sun: 6.5, fill: 3.5, sky: C(0xfff4e2).multiplyScalar(1.5), env: 0.55, exp: 1.0, fresco: 0.97 };
  const NIGHT = { hemi: [C(0x1c2a44), C(0x0b0806), 0.18], sun: 0.0, fill: 0, sky: C(0x0b1a33), env: 0.12, exp: 1.0, fresco: 0 };
  const moon = new THREE.DirectionalLight(0x7f9ccc, 0); moon.position.copy(sun.position); moon.target = sun.target; scene.add(moon);
  let mood = -1;
  function setMood(m) {
    if (m === mood) return; mood = m;
    hemi.color.lerpColors(DAY.hemi[0], NIGHT.hemi[0], m);
    hemi.groundColor.lerpColors(DAY.hemi[1], NIGHT.hemi[1], m);
    hemi.intensity = THREE.MathUtils.lerp(DAY.hemi[2], NIGHT.hemi[2], m);
    sun.intensity = DAY.sun * (1 - m); moon.intensity = 0.55 * m; fill.intensity = DAY.fill * (1 - m);
    skyMat.color.lerpColors(DAY.sky, NIGHT.sky, m);
    scene.environmentIntensity = THREE.MathUtils.lerp(DAY.env, NIGHT.env, m);
    frescoMat.opacity = 1 - m; fresco.visible = cornice.visible = m < 0.999;
    paintMat.opacity = m; painting.visible = frame.visible = m > 0.001;
    frame.children.forEach((c) => (c.visible = m > 0.5));
    lamp.visible = m > 0.001; lampBase = 22 * m;
    halo.material.opacity = 0.35 * m; flame.material.opacity = m;
    for (const s of shafts) s.material.uniforms.strength.value = 1 - m;
    if (dust) dust.material.uniforms.strength.value = 1 - m;
  }
  let lampBase = 0;
  // fresco/painting brightness: 1 = true colours, used at the film hand-offs
  const lit = { fresco: DAY.fresco, painting: 1 };
  const nightPaint = new THREE.Color(0.62, 0.47, 0.33);

  function update(time, dt) {
    frescoMat.color.setScalar(lit.fresco);
    paintMat.color.setRGB(1, 1, 1).lerp(nightPaint, 1 - lit.painting);
    if (lamp.visible) {
      const f = 1 + 0.06 * Math.sin(time * 11.3) + 0.04 * Math.sin(time * 23.7 + 1) + 0.05 * (Math.random() - 0.5);
      lampLight.intensity = lampBase * f;
      flame.scale.set(0.07 * (0.95 + 0.1 * Math.sin(time * 9)), 0.13 * f, 1);
    }
    for (const s of shafts) s.material.uniforms.time.value = time;
    if (dust) dust.material.uniforms.time.value = time;
  }

  function setQuality(Q2) {
    renderer.shadowMap.enabled = !!Q2.shadow;
    if (Q2.shadow && sun.shadow.mapSize.x !== Q2.shadow) {
      sun.shadow.mapSize.set(Q2.shadow, Q2.shadow); sun.shadow.map?.dispose(); sun.shadow.map = null;
    }
    if (mirror) mirror.visible = !!Q2.reflect;
    if (dust) dust.visible = !!Q2.dust;
    shafts.forEach((s) => (s.visible = !!Q2.shafts));
  }
  function setMirrorSize(w, h, scale) {
    if (!mirror) return;
    mirror.getRenderTarget().setSize(Math.max(64, Math.round(w * scale)), Math.max(64, Math.round(h * scale)));
  }

  function setPaintingTexture(t) {
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
    paintMat.map.dispose(); paintMat.map = t; paintMat.needsUpdate = true;
  }

  return { setPaintingTexture, fresco, painting, lamp, setMood, update, bakeEnv, lit, setQuality, setMirrorSize, mirror };
}

// --- small materials ----------------------------------------------------------------------
function radial() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,240,200,0.6)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function shaftMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, strength: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform float time; uniform float strength; varying vec3 vP;
      void main(){
        vec3 p = vP / vec3(${(WIN.w * 0.95).toFixed(3)}, ${(WIN.y1 - WIN.y0).toFixed(3)}, 9.0);
        float edge = smoothstep(0.5, 0.18, abs(p.x)) * smoothstep(0.5, 0.15, abs(p.y));
        float along = smoothstep(-0.5, -0.42, p.z) * (1.0 - smoothstep(-0.2, 0.5, p.z));
        float flick = 0.85 + 0.15 * sin(time * 0.4 + p.z * 6.0 + p.x * 3.0);
        gl_FragColor = vec4(vec3(1.0, 0.9, 0.72) * 0.05 * edge * along * flick * strength, 1.0);
      }`,
  });
}

function dustMaterial(map) {
  return new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, strength: { value: 1 }, map: { value: map }, scale: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float seed; uniform float time; varying float vA;
      void main(){
        vec3 p = position + vec3(sin(time*0.13+seed)*0.25, sin(time*0.07+seed*1.7)*0.35, cos(time*0.11+seed*0.6)*0.25);
        vec4 mv = modelViewMatrix * vec4(p,1.0);
        gl_PointSize = 26.0 / -mv.z;
        vA = 0.5 + 0.5 * sin(time*0.9 + seed*3.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D map; uniform float strength; varying float vA;
      void main(){ vec4 c = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vec3(1.0,0.93,0.8) * c.a * 0.55 * vA * strength, 1.0); }`,
  });
}

// soft polished-marble mirror: blurred reflection, Fresnel-weighted alpha
const MirrorShader = {
  name: 'MarbleMirror',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, strength: { value: 0.4 } },
  vertexShader: `uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
    #include <common>
    void main(){ vUv = textureMatrix * vec4(position,1.0); vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float strength; varying vec4 vUv; varying vec3 vW;
    void main(){
      vec2 o = vec2(0.006, 0.0) * vUv.w;
      vec3 c = texture2DProj(tDiffuse, vUv).rgb * 0.4;
      c += texture2DProj(tDiffuse, vUv + vec4(o, 0.0, 0.0)).rgb * 0.15;
      c += texture2DProj(tDiffuse, vUv - vec4(o, 0.0, 0.0)).rgb * 0.15;
      c += texture2DProj(tDiffuse, vUv + vec4(o.yx, 0.0, 0.0)).rgb * 0.15;
      c += texture2DProj(tDiffuse, vUv - vec4(o.yx, 0.0, 0.0)).rgb * 0.15;
      vec3 v = normalize(cameraPosition - vW);
      float f = 0.35 + 0.65 * pow(1.0 - abs(v.y), 4.0);
      gl_FragColor = vec4(c, strength * f);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};
