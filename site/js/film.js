// Packed WebP frame sequence: fetch packs in priority order, keep the compressed
// bytes, decode a small window of frames just ahead of the scroll direction.
export class Film {
  constructor(base, tier, man) {
    Object.assign(this, { base, tier, ...man });
    this.data = new Array(this.packs.length).fill(null);   // Uint8Array per pack
    this.inflight = new Map();                             // pack -> promise
    this.bitmaps = new Map();                              // frame -> ImageBitmap
    this.decoding = new Set();
    this.loadedBytes = 0;
    this.totalBytes = this.packs.reduce((s, p) => s + p.bytes, 0);
    this.center = 0; this.dir = 1;
    this.onbytes = null;
  }

  packOf(f) { return Math.min(this.packs.length - 1, Math.floor(f / this.packs[0].frames.length)); }

  fetchPack(k) {
    if (this.data[k]) return Promise.resolve();
    if (!this.inflight.has(k)) this.inflight.set(k, this._fetch(k));
    return this.inflight.get(k);
  }

  async _fetch(k) {
    try {
      const res = await fetch(this.base + this.packs[k].url);
      if (!res.ok) throw new Error(res.status);
      const reader = res.body.getReader(), parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length; this.loadedBytes += value.length;
        this.onbytes?.();
      }
      const buf = new Uint8Array(got);
      let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
      this.data[k] = buf;
    } catch (e) {
      console.warn('film pack failed', k, e);
      setTimeout(() => this.inflight.delete(k), 1500);   // retry later
      return;
    }
    this.inflight.delete(k);
    this.pump();
  }

  // packs needed by the window first, then everything else in story order
  pump() {
    if (this.inflight.size >= 2) return;
    const want = [this.packOf(this.center), this.packOf(this.center + this.dir * 24), this.packOf(Math.max(0, this.center - 8))];
    for (let k = 0; k < this.packs.length; k++) want.push(k);
    for (const k of want) {
      if (!this.data[k] && !this.inflight.has(k)) { this.fetchPack(k); if (this.inflight.size >= 2) return; }
    }
  }

  frameBlob(f) {
    const k = this.packOf(f), d = this.data[k];
    if (!d) return null;
    const [off, len] = this.packs[k].frames[f - this.packs[k].first];
    return new Blob([d.subarray(off, off + len)], { type: 'image/webp' });
  }

  decode(f) {
    if (f < 0 || f >= this.count || this.bitmaps.has(f) || this.decoding.has(f)) return;
    const b = this.frameBlob(f);
    if (!b) return;
    this.decoding.add(f);
    createImageBitmap(b).then((bm) => {
      this.decoding.delete(f);
      if (Math.abs(f - this.center) > 40) { bm.close?.(); return; }
      this.bitmaps.set(f, bm); this.dirty = true;
    }, () => this.decoding.delete(f));
  }

  // keep [center-back, center+ahead] decoded; release the rest
  update(frame, ahead = 12, back = 4) {
    const c = Math.round(frame);
    if (c !== this.center) this.dir = c > this.center ? 1 : -1;
    this.center = c;
    this.pump();
    const lo = this.dir > 0 ? c - back : c - ahead, hi = this.dir > 0 ? c + ahead : c + back;
    for (const [f, bm] of this.bitmaps) if (f < lo - 4 || f > hi + 4) { bm.close?.(); this.bitmaps.delete(f); }
    // nearest first, at most 3 decodes at once
    for (let d = 0; d <= Math.max(ahead, back) && this.decoding.size < 3; d++) {
      for (const f of [c + this.dir * d, c - this.dir * d]) if (f >= lo && f <= hi) this.decode(f);
    }
  }

  nearest(f) {
    if (this.bitmaps.has(f)) return f;
    for (let d = 1; d < 40; d++) {
      if (this.bitmaps.has(f - d)) return f - d;
      if (this.bitmaps.has(f + d)) return f + d;
    }
    return -1;
  }

  ready(f) { return this.bitmaps.has(Math.round(f)); }

  // draw with cover fit; blend to the next frame for smooth scrubbing
  draw(ctx, frame, cw, ch) {
    const i = Math.floor(frame), fr = frame - i;
    const a = this.nearest(i);
    if (a < 0) return false;
    const fw = this.w, fh = this.h, ca = cw / ch, fa = fw / fh;
    let sw = fw, sh = fh;
    if (ca > fa) sh = fw / ca; else sw = fh * ca;
    const sx = (fw - sw) / 2, sy = (fh - sh) / 2;
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bitmaps.get(a), sx, sy, sw, sh, 0, 0, cw, ch);
    if (a === i && fr > 0.02 && this.bitmaps.has(i + 1)) {
      ctx.globalAlpha = fr;
      ctx.drawImage(this.bitmaps.get(i + 1), sx, sy, sw, sh, 0, 0, cw, ch);
      ctx.globalAlpha = 1;
    }
    return true;
  }

  // wait until the first frames are decoded (preloader)
  async prime(frames) {
    await Promise.all([...new Set(frames.map((f) => this.packOf(f)))].map((k) => this.fetchPack(k)));
    await Promise.all(frames.map(async (f) => {
      const b = this.frameBlob(f); if (!b) return;
      this.bitmaps.set(f, await createImageBitmap(b));
    }));
  }
}
