// Liest die wichtigsten EXIF-Angaben (Datum, Kamera, Belichtung, GPS) aus JPEG-Dateien.
(function () {
  'use strict';

  const SIZES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

  function parseTiff(v, t0) {
    const le = v.getUint16(t0) === 0x4949;
    const u16 = o => v.getUint16(o, le);
    const u32 = o => v.getUint32(o, le);

    function value(type, cnt, o) {
      const one = i => {
        switch (type) {
          case 1: case 7: return v.getUint8(o + i);
          case 3: return u16(o + i * 2);
          case 4: return u32(o + i * 4);
          case 9: return v.getInt32(o + i * 4, le);
          case 5: { const d = u32(o + i * 8 + 4); return d ? u32(o + i * 8) / d : 0; }
          case 10: { const d = v.getInt32(o + i * 8 + 4, le); return d ? v.getInt32(o + i * 8, le) / d : 0; }
          default: return null;
        }
      };
      if (type === 2) {
        let s = '';
        for (let i = 0; i < cnt; i++) { const c = v.getUint8(o + i); if (!c) break; s += String.fromCharCode(c); }
        return s.trim();
      }
      if (cnt === 1) return one(0);
      const a = [];
      for (let i = 0; i < Math.min(cnt, 16); i++) a.push(one(i));
      return a;
    }

    function ifd(off) {
      const tags = {};
      if (!off || t0 + off + 2 > v.byteLength) return tags;
      const n = u16(t0 + off);
      for (let i = 0; i < n; i++) {
        const e = t0 + off + 2 + i * 12;
        if (e + 12 > v.byteLength) break;
        const tag = u16(e), type = u16(e + 2), cnt = u32(e + 4);
        const size = (SIZES[type] || 1) * cnt;
        const vo = size > 4 ? t0 + u32(e + 8) : e + 8;
        if (vo + size > v.byteLength) continue;
        try { tags[tag] = value(type, cnt, vo); } catch (err) { /* defekter Eintrag */ }
      }
      return tags;
    }

    const t = ifd(u32(t0 + 4));
    const ex = ifd(t[0x8769]);
    const gps = ifd(t[0x8825]);
    const out = {};

    const make = t[0x010F] || '', model = t[0x0110] || '';
    if (make || model) out.camera = model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]) ? model : (make + ' ' + model).trim();
    if (ex[0xA434]) out.lens = ex[0xA434];
    const dt = ex[0x9003] || ex[0x9004] || t[0x0132];
    if (typeof dt === 'string') {
      const m = dt.match(/^(\d{4}):(\d\d):(\d\d)[ T](\d\d):(\d\d):(\d\d)/);
      if (m && +m[1] > 1900) out.date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    }
    if (ex[0x829A]) out.exposure = ex[0x829A] >= 1 ? ex[0x829A] + ' s' : '1/' + Math.round(1 / ex[0x829A]) + ' s';
    if (ex[0x829D]) out.aperture = 'f/' + (+ex[0x829D].toFixed(1));
    const iso = Array.isArray(ex[0x8827]) ? ex[0x8827][0] : ex[0x8827];
    if (iso) out.iso = iso;
    if (ex[0x920A]) out.focal = (+ex[0x920A].toFixed(1)) + ' mm' + (ex[0xA405] ? ' (' + ex[0xA405] + ' mm KB)' : '');

    const dms = a => Array.isArray(a) && a.length >= 3 ? a[0] + a[1] / 60 + a[2] / 3600 : null;
    const lat = dms(gps[2]), lon = dms(gps[4]);
    if (lat !== null && lon !== null && (lat || lon)) {
      out.lat = gps[1] === 'S' ? -lat : lat;
      out.lon = gps[3] === 'W' ? -lon : lon;
      if (typeof gps[6] === 'number') out.alt = Math.round(gps[5] === 1 ? -gps[6] : gps[6]);
    }
    return out;
  }

  async function readExif(file) {
    try {
      const v = new DataView(await file.slice(0, 512 * 1024).arrayBuffer());
      if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return {};
      let p = 2;
      while (p + 10 < v.byteLength) {
        const marker = v.getUint16(p), len = v.getUint16(p + 2);
        if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA) break;
        if (marker === 0xFFE1 && v.getUint32(p + 4) === 0x45786966) return parseTiff(v, p + 10);
        p += 2 + len;
      }
    } catch (err) { /* keine oder defekte Metadaten */ }
    return {};
  }

  window.readExif = readExif;
})();
