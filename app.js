(function () {
  'use strict';

  // ------------------------------------------------------------------ Grundlagen
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r2 = v => Math.round(v * 100) / 100;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const PAGES = { A4: [210, 297], A3: [297, 420] };
  const FONTS = ['Georgia', 'Segoe UI', 'Palatino Linotype', 'Gabriola', 'Segoe Script', 'Segoe Print', 'Comic Sans MS', 'Courier New', 'Impact', 'Arial'];
  const N = 24;

  const images = new Map();   // id -> { id, file, name, w, h, url (Vorschau), meta }
  let state = defaults();
  let view = 'photos', tool = 'move', sel = null, zoom = 1, scale = 2, showCut = true;
  let uiMode = 'simple';
  try { uiMode = localStorage.getItem('kalender-mode') === 'pro' ? 'pro' : 'simple'; } catch {}
  let history = [], future = [], commitTimer = null;

  const stage = $('#stage'), doorsEl = $('#doors'), wrap = $('#stageWrap'), cutSvg = $('#cutSvg');
  const doorEls = new Map();

  function defaults() {
    return {
      format: 'A3', orient: 'portrait', bg: '#ffffff',
      layout: { mode: 'grid', cols: 'auto', ratio: 'fill', margin: 15, gap: 6, seed: 7, auto: true },
      cut: { hinge: 'left', inset: 1.5, radius: 3, roundHinge: true, frame: true, mirror: false, door: { mode: 'perf', cut: 4, gap: 1 }, fold: { mode: 'perf', cut: 1, gap: 2 } },
      num: { font: 'Georgia', mode: 'rel', size: 30, mm: 14, print: true, sheetW: 200, sheetGap: 4, color: '#ffffff', badge: true, badgeColor: '#b3261e', pos: 'c', onPhotos: false },
      cover: { color: '#1f4d3a', img: null, outlines: true, cx: .5, cy: .5, zoom: 1 },
      back: { font: 'Georgia', size: 14, bold: false, autoFit: true, uniform: true, color: '#222222', align: 'center', pad: 4, mirror: 'h', rotate: true, outlines: false, label: { inset: 2, mode: 'solid', cut: 4, gap: 1 } },
      exp: { dpi: 'max' }, geo: false,
      doors: Array.from({ length: N }, (_, i) => ({ id: 'd' + i, n: i + 1, x: 0, y: 0, w: 50, h: 50, img: null, z: 1, cx: .5, cy: .5, text: '', hinge: '', ns: 1, ts: 1 }))
    };
  }
  function page() { const [a, b] = PAGES[state.format]; return state.orient === 'landscape' ? [b, a] : [a, b]; }
  const getPath = p => p.split('.').reduce((o, k) => o[k], state);
  function setPath(p, v) { const ks = p.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], state)[last] = v; }
  const doorById = id => state.doors.find(d => d.id === id);
  const selDoor = () => sel && doorById(sel);
  const fontCss = f => `"${f}", Georgia, serif`;

  // ------------------------------------------------------------------ Automatische Anordnung
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function autoRects() {
    const [W, H] = page(), L = state.layout, m = L.margin, g = L.gap;
    if (L.mode === 'mosaic') {
      let rnd;
      const split = (r, n) => {
        if (n === 1) return [r];
        const vertical = r.w / r.h > 0.9 + rnd() * 0.25;       // breite Flächen senkrecht teilen
        const n1 = clamp(Math.round(n * (0.4 + rnd() * 0.2)), 1, n - 1);
        const fr = clamp(n1 / n * (0.93 + rnd() * 0.14), 0.2, 0.8);
        if (vertical) {
          const w1 = (r.w - g) * fr;
          return [...split({ x: r.x, y: r.y, w: w1, h: r.h }, n1), ...split({ x: r.x + w1 + g, y: r.y, w: r.w - g - w1, h: r.h }, n - n1)];
        }
        const h1 = (r.h - g) * fr;
        return [...split({ x: r.x, y: r.y, w: r.w, h: h1 }, n1), ...split({ x: r.x, y: r.y + h1 + g, w: r.w, h: r.h - g - h1 }, n - n1)];
      };
      // Mehrere Versuche, die Variante mit den ausgewogensten Proportionen gewinnt
      let best = null, bestAr = Infinity;
      for (let t = 0; t < 40 && bestAr > 2; t++) {
        rnd = rng(L.seed * 7919 + 13 + t * 101);
        const rects = split({ x: m, y: m, w: W - 2 * m, h: H - 2 * m }, N);
        const ar = Math.max(...rects.map(r => Math.max(r.w / r.h, r.h / r.w)));
        if (ar < bestAr) { bestAr = ar; best = rects; }
      }
      return best;
    }
    const cols = L.cols === 'auto' ? (W > H ? 6 : 4) : +L.cols, rows = Math.ceil(N / cols);
    let cw = (W - 2 * m - (cols - 1) * g) / cols, ch = (H - 2 * m - (rows - 1) * g) / rows;
    if (L.ratio !== 'fill') {
      const [a, b] = L.ratio.split(':').map(Number), ra = a / b;
      if (cw / ch > ra) cw = ch * ra; else ch = cw / ra;
    }
    const gx = cols > 1 ? (W - 2 * m - cols * cw) / (cols - 1) : 0, gy = rows > 1 ? (H - 2 * m - rows * ch) / (rows - 1) : 0;
    const out = [];
    for (let i = 0; i < N; i++) out.push({ x: m + (i % cols) * (cw + gx), y: m + Math.floor(i / cols) * (ch + gy), w: cw, h: ch });
    return out;
  }
  function applyAuto() {
    autoRects().forEach((r, i) => { const d = state.doors[i]; d.x = r2(r.x); d.y = r2(r.y); d.w = r2(r.w); d.h = r2(r.h); });
  }

  // ------------------------------------------------------------------ Geometrie
  function mirrorRect(r, m) {
    const [W, H] = page();
    if (m === 'h') return { x: W - r.x - r.w, y: r.y, w: r.w, h: r.h };
    if (m === 'v') return { x: r.x, y: H - r.y - r.h, w: r.w, h: r.h };
    return { x: r.x, y: r.y, w: r.w, h: r.h };
  }
  function mirrorHinge(h, m) {
    if (m === 'h') return { left: 'right', right: 'left' }[h] || h;
    if (m === 'v') return { top: 'bottom', bottom: 'top' }[h] || h;
    return h;
  }
  const hingeOf = d => d.hinge || state.cut.hinge;
  function imgGeom(d, im) {
    const s = Math.max(d.w / im.w, d.h / im.h) * d.z;       // mm je Bildpixel
    const dw = im.w * s, dh = im.h * s;
    return { s, dw, dh, ox: (dw - d.w) * d.cx, oy: (dh - d.h) * d.cy, dpi: 25.4 / s };
  }

  // Ein Wegstück ist eine Strecke oder ein Kreisbogen: { p, q, len, arc?: { c, r, a0, a1 } }.
  const line = (p, q) => ({ p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) });
  function arcPiece(p, q, c, r) {
    const a0 = Math.atan2(p[1] - c[1], p[0] - c[0]);
    let da = Math.atan2(q[1] - c[1], q[0] - c[0]) - a0;
    if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
    return { p, q, len: Math.abs(da) * r, arc: { c, r, a0, a1: a0 + da } };
  }
  function clipPiece(pc, s, e) {
    if (s <= 1e-9 && e >= pc.len - 1e-9) return pc;
    if (!pc.arc) {
      const at = t => [pc.p[0] + (pc.q[0] - pc.p[0]) * t / pc.len, pc.p[1] + (pc.q[1] - pc.p[1]) * t / pc.len];
      return line(at(s), at(e));
    }
    const { c, r, a0, a1 } = pc.arc, ang = t => a0 + (a1 - a0) * t / pc.len, at = a => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
    const b0 = ang(s), b1 = ang(e);
    return { p: at(b0), q: at(b1), len: e - s, arc: { c, r, a0: b0, a1: b1 } };
  }
  // Teilt einen zusammenhängenden Weg in einzelne Schnitte. endsGap: Weg beginnt und endet mit einem Steg.
  function dashRun(run, cfg, endsGap) {
    const L = run.reduce((t, pc) => t + pc.len, 0);
    if (cfg.mode === 'none' || L <= 0) return [];
    if (cfg.mode === 'solid') return run;
    const c = Math.max(0.2, cfg.cut), g = Math.max(0.2, cfg.gap);
    let n, gap, off;
    if (endsGap) { n = Math.max(1, Math.round((L - g) / (c + g))); gap = (L - n * c) / (n + 1); off = gap; }
    else { n = Math.max(2, Math.round((L + g) / (c + g))); gap = (L - n * c) / (n - 1); off = 0; }
    if (gap < 0.05) return run;
    const out = [];
    for (let i = 0; i < n; i++) {
      const s = off + i * (c + gap), e = s + c;
      let pos = 0;
      for (const pc of run) {
        const a = Math.max(s, pos) - pos, b = Math.min(e, pos + pc.len) - pos;
        if (b - a > 1e-6) out.push(clipPiece(pc, a, b));
        pos += pc.len;
      }
    }
    return out;
  }
  // Schnittrechteck: um den Bildüberstand kleiner als das Bild.
  function cutRect(d, mirror) {
    const r = mirrorRect(d, mirror), i = Math.max(0, Math.min(state.cut.inset, r.w / 2 - 3, r.h / 2 - 3));
    return { x: r.x + i, y: r.y + i, w: r.w - 2 * i, h: r.h - 2 * i };
  }
  // Umriss eines Türchens: Wegstücke der drei Türchenkanten (mit runden Ecken) und die Knickkante.
  function outline(d, mirror) {
    const r = cutRect(d, mirror), hinge = mirrorHinge(hingeOf(d), mirror);
    const c = { tl: [r.x, r.y], tr: [r.x + r.w, r.y], br: [r.x + r.w, r.y + r.h], bl: [r.x, r.y + r.h] };
    const o = { left: ['tl', 'tr', 'br', 'bl'], right: ['tr', 'tl', 'bl', 'br'], top: ['tl', 'bl', 'br', 'tr'], bottom: ['bl', 'tl', 'tr', 'br'] }[hinge].map(k => c[k]);
    const rad = Math.max(0, Math.min(state.cut.radius, r.w / 2, r.h / 2)), rh = state.cut.roundHinge ? rad : 0;
    const rr = [rh, rad, rad, rh];
    const dir = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
    const add = (p, v, s) => [p[0] + v[0] * s, p[1] + v[1] * s];
    const pieces = []; let cur, foldStart, foldEnd;
    for (let k = 0; k < 4; k++) {
      const din = dir(o[(k + 3) % 4], o[k]), dout = dir(o[k], o[(k + 1) % 4]);
      const a = add(o[k], din, -rr[k]), b = add(o[k], dout, rr[k]);
      if (k > 0) { const l = line(cur, a); if (l.len > 1e-6) pieces.push(l); }
      if (rr[k] > 0) pieces.push(arcPiece(a, b, add(a, dout, rr[k]), rr[k]));
      cur = b;
      if (k === 0) foldEnd = a;
      if (k === 3) foldStart = b;
    }
    return { pieces, fold: line(foldStart, foldEnd), rounded: rad > 0 };
  }
  // Schnittlinien eines Türchens als Wegstücke in mm: { door: [...], fold: [...] }.
  function cutGeom(d, mirror) {
    const o = outline(d, mirror);
    // Mit runden Ecken läuft die Perforation durchgehend um das Türchen, sonst beginnt und endet jede Seite mit einem Schnitt.
    const runs = o.rounded ? [o.pieces] : o.pieces.map(pc => [pc]);
    return { door: runs.flatMap(run => dashRun(run, state.cut.door, false)), fold: o.fold.len > 1e-6 ? dashRun([o.fold], state.cut.fold, true) : [] };
  }
  // Geschlossener Umriss als Punktfolge (für feine Hilfslinien im Druck).
  function outlinePoints(d, mirror) {
    const o = outline(d, mirror), pts = [];
    for (const pc of [...o.pieces, o.fold]) {
      if (!pc.arc) { pts.push(pc.p, pc.q); continue; }
      const { c, r, a0, a1 } = pc.arc;
      for (let i = 0; i <= 12; i++) { const a = a0 + (a1 - a0) * i / 12; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
    }
    return pts;
  }
  // Textkärtchen: geschlossener Umriss mit vier runden Ecken, um back.label.inset kleiner als die Türchen-Öffnung.
  function labelPieces(d, mirror) {
    const c = cutRect(d, mirror), i = Math.max(0, Math.min(state.back.label.inset, c.w / 2 - 3, c.h / 2 - 3));
    const r = { x: c.x + i, y: c.y + i, w: c.w - 2 * i, h: c.h - 2 * i };
    const rad = Math.max(0, Math.min(state.cut.radius - i, r.w / 2, r.h / 2));
    const o = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]], dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const pieces = []; let cur, first;
    for (let k = 0; k < 4; k++) {
      const din = dirs[(k + 3) % 4], dout = dirs[k];
      const a = [o[k][0] - din[0] * rad, o[k][1] - din[1] * rad], b = [o[k][0] + dout[0] * rad, o[k][1] + dout[1] * rad];
      if (k > 0) pieces.push(line(cur, a)); else first = a;
      if (rad > 0) pieces.push(arcPiece(a, b, [a[0] + dout[0] * rad, a[1] + dout[1] * rad], rad));
      cur = b;
    }
    pieces.push(line(cur, first));
    return dashRun(pieces.filter(pc => pc.len > 1e-6), state.back.label, false);
  }
  // Abstand des Textes vom Türchenrand: Innenabstand ab der Kante des Textkärtchens.
  const textPad = d => Math.min(state.back.pad + state.cut.inset + state.back.label.inset, d.w / 4, d.h / 4);
  function pathData(pieces) {
    const f = v => +v.toFixed(3);
    let d = '', last = null;
    for (const pc of pieces) {
      const { p, q } = pc;
      if (!last || Math.abs(last[0] - p[0]) > 1e-6 || Math.abs(last[1] - p[1]) > 1e-6) d += `M${f(p[0])} ${f(p[1])}`;
      d += pc.arc ? `A${f(pc.arc.r)} ${f(pc.arc.r)} 0 0 ${pc.arc.a1 > pc.arc.a0 ? 1 : 0} ${f(q[0])} ${f(q[1])}` : `L${f(q[0])} ${f(q[1])}`;
      last = q;
    }
    return d;
  }

  // ------------------------------------------------------------------ Zeichnen von Nummern und Texten (Vorschau + Export)
  // ------------------------------------------------------------------ Zahlen als Schnittkonturen
  // Zeichnet den Text groß auf eine Leinwand und zieht die Umrisse als geschlossene Linienzüge nach.
  // So funktioniert jede installierte Schrift, ohne Schriftdateien lesen zu müssen.
  const glyphCache = new Map();
  function glyph(str, font) {
    const key = font + '|' + str;
    if (glyphCache.has(key)) return glyphCache.get(key);
    const E = 480, pad = 24, cv = document.createElement('canvas');
    let ctx = cv.getContext('2d');
    const fnt = `600 ${E}px ${fontCss(font)}`;
    ctx.font = fnt;
    const mt = ctx.measureText(str);
    const L = Math.ceil(mt.actualBoundingBoxLeft) + pad, A = Math.ceil(mt.actualBoundingBoxAscent) + pad;
    cv.width = L + Math.ceil(mt.actualBoundingBoxRight) + pad; cv.height = A + Math.ceil(mt.actualBoundingBoxDescent) + pad;
    ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.font = fnt; ctx.fillStyle = '#000'; ctx.fillText(str, L, A);
    const W = cv.width, H = cv.height, px = ctx.getImageData(0, 0, W, H).data, T = 127.5;
    const v = (x, y) => px[(y * W + x) * 4 + 3];

    // Marching Squares: Schnittpunkte der Kontur mit den Rasterkanten, je Zelle verbunden
    const adj = new Map(), pts = new Map();
    const link = (a, b) => { for (const [m, n] of [[a, b], [b, a]]) { if (!adj.has(m)) adj.set(m, []); adj.get(m).push(n); } };
    const t = (a, b) => (T - a) / (b - a);
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) {
        const a = v(x, y), b = v(x + 1, y), c = v(x + 1, y + 1), d = v(x, y + 1);
        const idx = (a > T ? 1 : 0) | (b > T ? 2 : 0) | (c > T ? 4 : 0) | (d > T ? 8 : 0);
        if (idx === 0 || idx === 15) continue;
        const top = (y * W + x) * 2, left = top + 1, bottom = ((y + 1) * W + x) * 2, right = (y * W + x + 1) * 2 + 1;
        if ((a > T) !== (b > T)) pts.set(top, [x + t(a, b), y]);
        if ((a > T) !== (d > T)) pts.set(left, [x, y + t(a, d)]);
        if ((d > T) !== (c > T)) pts.set(bottom, [x + t(d, c), y + 1]);
        if ((b > T) !== (c > T)) pts.set(right, [x + 1, y + t(b, c)]);
        switch (idx) {
          case 1: case 14: link(left, top); break;
          case 2: case 13: link(top, right); break;
          case 3: case 12: link(left, right); break;
          case 4: case 11: link(right, bottom); break;
          case 6: case 9: link(top, bottom); break;
          case 7: case 8: link(left, bottom); break;
          case 5: link(left, top); link(right, bottom); break;
          case 10: link(top, right); link(left, bottom); break;
        }
      }
    }
    // Kanten zu geschlossenen Schleifen verketten
    const seen = new Set(), loops = [];
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const loop = [];
      for (let cur = start; cur !== undefined; cur = adj.get(cur).find(n => !seen.has(n))) { seen.add(cur); loop.push(pts.get(cur)); }
      if (loop.length >= 8) loops.push(loop);
    }
    // Vereinfachen (Douglas-Peucker), damit der Plotter wenige, saubere Stützpunkte bekommt
    const tol = 0.3;
    const dp = line => {
      const keep = new Uint8Array(line.length); keep[0] = keep[line.length - 1] = 1;
      const stack = [[0, line.length - 1]];
      while (stack.length) {
        const [i, j] = stack.pop(), [ax, ay] = line[i], [bx, by] = line[j], dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
        let far = -1, fd = tol;
        for (let k = i + 1; k < j; k++) { const dd = Math.abs((line[k][0] - ax) * dy - (line[k][1] - ay) * dx) / len; if (dd > fd) { fd = dd; far = k; } }
        if (far > 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
      }
      return line.filter((_, k) => keep[k]);
    };
    const simple = loops.map(loop => {
      let m = 0, md = 0;
      loop.forEach((q, k) => { const dd = Math.hypot(q[0] - loop[0][0], q[1] - loop[0][1]); if (dd > md) { md = dd; m = k; } });
      return [...dp(loop.slice(0, m + 1)), ...dp([...loop.slice(m), loop[0]]).slice(1, -1)].map(q => [(q[0] - L) / E, (q[1] - A) / E]);
    });
    const all = simple.flat(), xs = all.map(q => q[0]), ys = all.map(q => q[1]);
    const g = all.length
      ? { loops: simple, x0: Math.min(...xs), w: Math.max(...xs) - Math.min(...xs), asc: -Math.min(...ys), desc: Math.max(0, Math.max(...ys)) }
      : { loops: [], x0: 0, w: 0.5, asc: 0.7, desc: 0 };
    glyphCache.set(key, g);
    return g;
  }
  // Schriftgröße (Geviert) der Zahl eines Türchens in mm – gilt für Druck und Schnitt gleichermaßen.
  function numEm(d) {
    const Nm = state.num;
    const base = Nm.mode === 'abs' ? Nm.mm / glyph('8', Nm.font).asc : Nm.size / 100 * Math.min(d.w, d.h);
    return base * (d.ns || 1);
  }
  const byPos = (a, b) => Math.abs(a.y - b.y) > Math.min(a.h, b.h) / 2 ? a.y - b.y : a.x - b.x;
  // Zahlenbogen: Zahlen zeilenweise in der Reihenfolge der Türchen auf dem Kalender, auf gemeinsamer Grundlinie.
  function numSheet() {
    const Nm = state.num, W = Nm.sheetW, m = 5, gap = Nm.sheetGap;
    const rows = [[]]; let x = m;
    for (const d of [...state.doors].sort(byPos)) {
      const g = glyph(String(d.n), Nm.font), em = numEm(d), w = g.w * em;
      if (rows[rows.length - 1].length && x + w > W - m) { rows.push([]); x = m; }
      rows[rows.length - 1].push({ d, g, em, x, w });
      x += w + gap;
    }
    let y = m;
    for (const row of rows) {
      const asc = Math.max(...row.map(i => i.g.asc * i.em)), desc = Math.max(...row.map(i => i.g.desc * i.em));
      for (const i of row) i.base = y + asc;
      y += asc + desc + gap;
    }
    return { W, H: y - gap + m, items: rows.flat() };
  }
  function numPaths(sheet) {
    const f = v => +v.toFixed(3);
    return sheet.items.map(i => ({
      n: i.d.n,
      d: i.g.loops.map(loop => 'M' + loop.map(q => `${f(i.x + (q[0] - i.g.x0) * i.em)} ${f(i.base + q[1] * i.em)}`).join('L') + 'Z').join('')
    }));
  }

  function numberPosition(d) {
    const off = numEm(d) * .95;
    const base = { c: [.5, .5], tl: [off / d.w, off / d.h], tr: [1 - off / d.w, off / d.h], bl: [off / d.w, 1 - off / d.h], br: [1 - off / d.w, 1 - off / d.h] }[state.num.pos];
    // Keep the number and badge within its door, including after resizing.
    const mx = Math.min(.5, numEm(d) * .85 / d.w), my = Math.min(.5, numEm(d) * .85 / d.h);
    return [clamp(d.nx ?? base[0], mx, 1 - mx), clamp(d.ny ?? base[1], my, 1 - my)];
  }
  function coverCrop(im) {
    const [W, H] = page(), k = Math.max(W / im.w, H / im.h) * state.cover.zoom;
    const sw = W / k, sh = H / k;
    return { k, sw, sh, sx: (im.w - sw) * state.cover.cx, sy: (im.h - sh) * state.cover.cy };
  }
  function drawNum(ctx, d, w, h) {
    const Nm = state.num, s = numEm(d) * w / d.w;
    const [nx, ny] = numberPosition(d), x = nx * w, y = ny * h;
    ctx.save();
    if (Nm.badge) { ctx.fillStyle = Nm.badgeColor; ctx.beginPath(); ctx.arc(x, y, s * 0.8, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = s * 0.18; }
    ctx.fillStyle = Nm.color; ctx.font = `600 ${s}px ${fontCss(Nm.font)}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d.n, x, y + s * 0.05);
    ctx.restore();
  }
  function wrapLines(ctx, text, maxW) {
    const out = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const t = line ? line + ' ' + word : word;
        if (line && ctx.measureText(t).width > maxW) { out.push(line); line = word; } else line = t;
      }
      out.push(line);
    }
    return out;
  }
  // Schriftgröße (mm) des Rückseitentexts je Türchen. Mit „automatisch verkleinern“ wird verkleinert, bis der Text passt –
  // bei einheitlicher Größe richten sich alle Türchen nach dem engsten, damit das Schriftbild gleichmäßig bleibt.
  let sizeMemo = { key: '', map: null };
  const measCtx = document.createElement('canvas').getContext('2d');
  const textFont = px => `${state.back.bold ? '700 ' : ''}${px}px ${fontCss(state.back.font)}`;
  function textSizes() {
    const B = state.back, key = JSON.stringify([B, state.cut.inset, state.doors.map(d => [d.text, d.w, d.h, d.ts])]);
    if (sizeMemo.key === key) return sizeMemo.map;
    const K = 10, base = B.size * 0.3528, fit = new Map();
    for (const d of state.doors) {
      const txt = d.text.trim();
      if (!txt) continue;
      let mm = base;
      if (B.autoFit) {
        const pad = textPad(d), mw = (d.w - 2 * pad) * K, mh = (d.h - 2 * pad) * K;
        for (; mm > 1.4; mm *= 0.95) {
          measCtx.font = textFont(mm * K);
          const lines = wrapLines(measCtx, txt, mw);
          if (lines.length * mm * K * 1.3 <= mh && lines.every(l => measCtx.measureText(l).width <= mw)) break;
        }
      }
      fit.set(d.id, mm);
    }
    const common = Math.min(base, ...fit.values()), map = new Map();
    for (const d of state.doors) if (fit.has(d.id)) map.set(d.id, (B.autoFit && B.uniform ? common : fit.get(d.id)) * (d.ts || 1));
    sizeMemo = { key, map };
    return map;
  }
  function drawText(ctx, d, w, h, k) {   // k = Pixel je mm
    const B = state.back, txt = (d.text || '').trim();
    if (!txt) return;
    const hg = hingeOf(d), vert = hg === 'top' || hg === 'bottom';
    ctx.save();
    if (B.rotate && ((B.mirror === 'h' && vert) || (B.mirror === 'v' && !vert))) { ctx.translate(w, h); ctx.rotate(Math.PI); }
    const pad = textPad(d) * k, mw = w - 2 * pad;
    const fs = (textSizes().get(d.id) || B.size * 0.3528) * k, lh = fs * 1.3;
    ctx.font = textFont(fs);
    const lines = wrapLines(ctx, txt, mw);
    ctx.fillStyle = B.color; ctx.textBaseline = 'middle'; ctx.textAlign = B.align;
    const x = B.align === 'left' ? pad : B.align === 'right' ? w - pad : w / 2;
    lines.forEach((l, i) => ctx.fillText(l, x, h / 2 + (i - (lines.length - 1) / 2) * lh));
    ctx.restore();
  }

  // ------------------------------------------------------------------ Rendering
  function render() {
    const sheet = view === 'nums' ? numSheet() : null;
    const [W, H] = sheet ? [sheet.W, sheet.H] : page();
    doorsEl.hidden = !!sheet;
    scale = Math.max(0.3, Math.min((wrap.clientWidth - 64) / W, (wrap.clientHeight - 64) / H)) * zoom;
    stage.style.width = W * scale + 'px'; stage.style.height = H * scale + 'px';
    stage.dataset.view = view; stage.dataset.tool = tool;
    stage.classList.toggle('cover-outlines', state.cover.outlines);
    const cov = images.get(state.cover.img);
    stage.style.backgroundColor = view === 'photos' ? state.bg : view === 'cover' ? state.cover.color : '#ffffff';
    stage.style.backgroundImage = view === 'cover' && cov ? `url(${cov.url})` : 'none';

    if (view === 'cover' && cov) {
      const g = coverCrop(cov);
      stage.style.backgroundSize = `${cov.w * g.k * scale}px ${cov.h * g.k * scale}px`;
      stage.style.backgroundPosition = `${-g.sx * g.k * scale}px ${-g.sy * g.k * scale}px`;
    }
    const dpr = window.devicePixelRatio || 1, origin = stage.getBoundingClientRect();
    const live = new Set();
    for (const d of state.doors) {
      live.add(d.id);
      let el = doorEls.get(d.id);
      if (!el) {
        el = document.createElement('div'); el.className = 'door'; el.dataset.id = d.id;
        el.innerHTML = '<div class="clipper"><img alt="" draggable="false"><div class="ph"><b></b><span>Bild ablegen</span></div><canvas></canvas><div class="warn"></div></div>' +
          '<i class="h" data-h="nw"></i><i class="h" data-h="ne"></i><i class="h" data-h="sw"></i><i class="h" data-h="se"></i>';
        doorsEl.appendChild(el); doorEls.set(d.id, el);
      }
      const r = view === 'back' ? mirrorRect(d, state.back.mirror) : d;
      const pw = r.w * scale, ph = r.h * scale;
      Object.assign(el.style, { left: r.x * scale + 'px', top: r.y * scale + 'px', width: pw + 'px', height: ph + 'px' });
      const im = images.get(d.img), img = $('img', el);
      el.classList.toggle('empty', !im); el.classList.toggle('sel', d.id === sel);
      img.hidden = !im;
      let low = false;
      if (im) {
        if (img.dataset.id !== im.id) { img.src = im.url; img.dataset.id = im.id; }
        const g = imgGeom(d, im);
        Object.assign(img.style, { width: g.dw * scale + 'px', height: g.dh * scale + 'px', left: -g.ox * scale + 'px', top: -g.oy * scale + 'px' });
        low = g.dpi < 150;
        if (low) $('.warn', el).textContent = '⚠ ' + Math.round(g.dpi) + ' dpi';
      }
      el.classList.toggle('lowres', low);
      $('.ph b', el).textContent = d.n;

      const cv = $('canvas', el), cw = Math.max(1, Math.round(pw * dpr)), chh = Math.max(1, Math.round(ph * dpr));
      cv.width = cw; cv.height = chh;
      const ax = origin.left + r.x * scale, ay = origin.top + r.y * scale;
      Object.assign(cv.style, { left: Math.round(ax * dpr) / dpr - ax + 'px', top: Math.round(ay * dpr) / dpr - ay + 'px', width: cw / dpr + 'px', height: chh / dpr + 'px' });
      const ctx = cv.getContext('2d');
      if ((view === 'cover' && state.num.print) || (view === 'photos' && state.num.onPhotos && im)) drawNum(ctx, d, cw, chh);
      else if (view === 'cut' || (view === 'back' && !d.text.trim())) {
        ctx.fillStyle = view === 'cut' ? '#8d95a8' : '#d5d9e2'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = `600 ${Math.min(cw, chh) * 0.24}px Georgia, serif`; ctx.fillText(d.n, cw / 2, chh / 2);
      } else if (view === 'back') drawText(ctx, d, cw, chh, scale * dpr);
    }
    for (const [id, el] of doorEls) if (!live.has(id)) { el.remove(); doorEls.delete(id); }

    // Schnittlinien
    cutSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    let svg = '';
    if (sheet) svg = numPaths(sheet).map(q => `<path class="nm" d="${q.d}"/>`).join('');
    else if ((showCut && (view !== 'cover' || state.cover.outlines)) || view === 'cut') {
      const m = view === 'back' ? state.back.mirror : null;
      if (state.cut.frame && view === 'cut') svg += `<path class="fr" d="M0 0H${W}V${H}H0Z"/>`;
      let a = '', b = '';
      for (const d of state.doors) { const g = cutGeom(d, m); a += pathData(g.door); b += pathData(g.fold); }
      svg += `<path class="cd" d="${a}"/><path class="cf" d="${b}"/>`;
      if (view === 'back') svg += `<path class="cl" d="${state.doors.filter(d => d.text.trim()).map(d => pathData(labelPieces(d, m))).join('')}"/>`;
    }
    cutSvg.innerHTML = svg;

    syncUi();
  }

  function syncUi() {
    document.body.dataset.mode = uiMode;
    for (const b of $$('[data-mode-choice]')) {
      const active = b.dataset.modeChoice === uiMode; b.classList.toggle('on', active); b.setAttribute('aria-pressed', active);
    }
    $('[data-tool=number]').hidden = view !== 'cover';
    $('#coverCrop').hidden = !images.has(state.cover.img);
    $('#coverStatus').textContent = images.has(state.cover.img) ? images.get(state.cover.img).name : 'Noch kein Hintergrundbild gewählt.';
    const [W, H] = page(), L = state.layout;
    for (const el of $$('[data-bind]')) {
      const v = getPath(el.dataset.bind);
      if (el.classList.contains('seg')) { for (const b of $$('button', el)) b.classList.toggle('on', b.dataset.v === String(v)); continue; }
      if (el.type === 'checkbox') el.checked = !!v;
      else if (el !== document.activeElement || el.type === 'range') el.value = v;
      const out = el.nextElementSibling;
      if (out && out.tagName === 'OUTPUT') out.textContent = ['cover.cx', 'cover.cy'].includes(el.dataset.bind) ? Math.round(v * 100) + ' %' : String(v).replace('.', ',') + ' ' + (out.dataset.unit || 'mm');
    }
    const flags = { grid: L.mode === 'grid', mosaic: L.mode === 'mosaic', doorperf: state.cut.door.mode === 'perf', foldperf: state.cut.fold.mode === 'perf', numrel: state.num.mode === 'rel', numabs: state.num.mode === 'abs', labelperf: state.back.label.mode === 'perf' };
    for (const el of $$('[data-if]')) el.hidden = !flags[el.dataset.if];
    for (const b of $$('#viewSeg button')) b.classList.toggle('on', b.dataset.view === view);
    for (const b of $$('#toolSeg button')) b.classList.toggle('on', b.dataset.tool === tool);
    $('#zoomLabel').textContent = Math.round(zoom * 100) + ' %';
    $('#pageInfo').textContent = `${state.format} · ${W} × ${H} mm`;
    $('#autoInfo').textContent = L.auto ? 'Automatik aktiv – Rand und Abstand wirken sofort.' : 'Freie Anordnung – „Automatisch anordnen“ richtet neu aus.';
    $('[data-act=undo]').disabled = history.length < 2; $('[data-act=redo]').disabled = !future.length;

    const withImg = state.doors.filter(d => images.get(d.img));
    const low = withImg.filter(d => imgGeom(d, images.get(d.img)).dpi < 150).length;
    const texts = state.doors.filter(d => d.text.trim()).length;
    $('#progBar').style.width = withImg.length / N * 100 + '%';
    $('#stats').innerHTML = `<b>${withImg.length} von ${N}</b> Bildern platziert · ${texts} Texte` + (low ? `<br><span style="color:var(--accent2)">⚠ ${low} Bild${low > 1 ? 'er' : ''} unter 150 dpi – kleiner anordnen oder weniger zoomen</span>` : '');
    $('#dropHint').hidden = withImg.length > 0 || view !== 'photos';
    $('#viewNote').textContent = {
      photos: 'Bilderbogen – liegt hinter dem Deckblatt',
      cover: 'Deckblatt – Vorderseite mit Nummern, wird geschnitten',
      cut: 'Schnittdatei – rot: Türchenkante, blau: Knickkante' + (state.cut.mirror ? ' (Export gespiegelt)' : ''),
      nums: view === 'nums' ? (sh => `Zahlen zum Plotten – ${Math.round(sh.W)} × ${Math.ceil(sh.H)} mm Material, Reihenfolge wie auf dem Kalender (zeilenweise von links oben)`)(numSheet()) : '',
      back: 'Rückseite des Deckblatts' + (state.back.mirror !== 'none' ? ' – gespiegelt dargestellt' : '')
    }[view];
    renderInspector();
  }

  function fmtDate(t) { return new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function metaRows(d, im) {
    const m = im.meta, g = imgGeom(d, im), rows = [];
    rows.push(['Aufnahme', m.date ? fmtDate(m.date) : fmtDate(im.file.lastModified) + ' (Dateidatum)']);
    if (m.lat != null) {
      const co = `${Math.abs(m.lat).toFixed(5)}° ${m.lat >= 0 ? 'N' : 'S'}, ${Math.abs(m.lon).toFixed(5)}° ${m.lon >= 0 ? 'O' : 'W'}`;
      rows.push(['Ort', (m.place ? esc(m.place) + '<br>' : '') + co + (m.alt != null ? ` · ${m.alt} m` : '')]);
    } else rows.push(['Ort', 'keine GPS-Daten']);
    if (m.camera) rows.push(['Kamera', esc(m.camera)]);
    if (m.lens) rows.push(['Objektiv', esc(m.lens)]);
    const expo = [m.exposure, m.aperture, m.iso && 'ISO ' + m.iso, m.focal].filter(Boolean).join(' · ');
    if (expo) rows.push(['Belichtung', esc(expo)]);
    const de = v => v.toFixed(1).replace('.', ',');
    rows.push(['Bildgröße', `${im.w} × ${im.h} px · ${de(im.w * im.h / 1e6)} MP · ${de(im.file.size / 1048576)} MB`]);
    const q = g.dpi >= 300 ? 'good' : g.dpi < 150 ? 'bad' : '';
    rows.push(['Druck', `<span class="${q}">${Math.round(g.dpi)} dpi</span> bei ${d.w.toFixed(0)} × ${d.h.toFixed(0)} mm`]);
    return rows;
  }
  function renderInspector() {
    const d = selDoor();
    $('#insBody').hidden = !d; $('#insEmpty').hidden = !!d;
    $('#insTitle').textContent = d ? 'Türchen ' + d.n : 'Kein Türchen gewählt';
    $('#numberPosition').hidden = !d || view !== 'cover';
    if (!d) return;
    const np = numberPosition(d);
    for (const el of $$('[data-number-axis]')) el.value = Math.round(np[el.dataset.numberAxis === 'nx' ? 0 : 1] * 100);
    for (const el of $$('[data-door]')) {
      const k = el.dataset.door;
      if (el !== document.activeElement || el.type === 'range') el.value = typeof d[k] === 'number' && k !== 'n' ? r2(d[k]) : d[k];
      const out = el.nextElementSibling;
      if (out && out.tagName === 'OUTPUT') out.textContent = d[k].toFixed(2).replace('.', ',') + ' ' + out.dataset.unit;
    }
    const im = images.get(d.img);
    $('[data-door=z]').disabled = !im;
    $('#insMeta').innerHTML = im
      ? `<span>Datei</span><b>${esc(im.name)}</b>` + metaRows(d, im).map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('') +
        (im.meta.lat != null ? `<span></span><b><a target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=${im.meta.lat.toFixed(5)}&mlon=${im.meta.lon.toFixed(5)}#map=14/${im.meta.lat.toFixed(5)}/${im.meta.lon.toFixed(5)}">Auf Karte zeigen</a></b>` : '')
      : '';
  }

  // ------------------------------------------------------------------ Verlauf
  function commit() {
    clearTimeout(commitTimer); commitTimer = null;
    const s = JSON.stringify(state);
    if (s !== history[history.length - 1]) { history.push(s); if (history.length > 120) history.shift(); future = []; }
    syncUi();
  }
  function touch() { render(); clearTimeout(commitTimer); commitTimer = setTimeout(commit, 400); }
  function changed() { render(); commit(); }
  function undo() { if (commitTimer) commit(); if (history.length < 2) return; future.push(history.pop()); state = JSON.parse(history[history.length - 1]); render(); }
  function redo() { if (!future.length) return; const s = future.pop(); history.push(s); state = JSON.parse(s); render(); }

  // ------------------------------------------------------------------ Meldungen
  function toast(msg, kind) {
    const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
    $('#toasts').appendChild(t); setTimeout(() => t.remove(), kind === 'err' ? 7000 : 3500);
  }
  async function busy(text, fn) {
    $('#busyText').textContent = text; $('#busy').hidden = false;
    await sleep(30);
    try { return await fn(t => { $('#busyText').textContent = t; }); }
    catch (e) { console.error(e); toast('Fehler: ' + e.message, 'err'); }
    finally { $('#busy').hidden = true; }
  }

  // ------------------------------------------------------------------ Bilder laden
  async function decode(blob) {
    const url = URL.createObjectURL(blob), img = new Image();
    img.src = url;
    try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); throw new Error('Format wird vom Browser nicht unterstützt'); }
    return { img, release: () => URL.revokeObjectURL(url) };
  }
  const toBlob = (cv, type, q) => new Promise(r => cv.toBlob(r, type, q));
  async function loadImage(file, id) {
    const { img, release } = await decode(file);
    const w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, 1800 / Math.max(w, h));
    const cv = document.createElement('canvas'); cv.width = Math.round(w * s); cv.height = Math.round(h * s);
    const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(img, 0, 0, cv.width, cv.height);
    const url = URL.createObjectURL(await toBlob(cv, 'image/jpeg', 0.88));
    release();
    const im = { id: id || 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), file, name: file.name, w, h, url, meta: await window.readExif(file) };
    images.set(im.id, im);
    geocode(im);
    return im;
  }
  function assign(d, id) { d.img = id; d.z = 1; d.cx = .5; d.cy = .5; }
  async function addFiles(files, targetId) {
    files = [...files].filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
    if (!files.length) return;
    let placed = 0, failed = 0, full = false;
    await busy('Bilder werden geladen …', async say => {
      let target = targetId && doorById(targetId);
      for (let i = 0; i < files.length; i++) {
        const d = target || [...state.doors].sort((a, b) => a.n - b.n).find(x => !images.get(x.img));
        if (!d) { full = true; break; }
        say(`Bild ${i + 1} von ${files.length} wird geladen …`);
        try { assign(d, (await loadImage(files[i])).id); placed++; target = null; render(); }
        catch (e) { failed++; }
      }
    });
    if (placed) toast(`${placed} Bild${placed > 1 ? 'er' : ''} hinzugefügt`, 'ok');
    if (failed) toast(`${failed} Datei${failed > 1 ? 'en' : ''} konnte${failed > 1 ? 'n' : ''} nicht gelesen werden (z. B. HEIC – bitte als JPG exportieren)`, 'err');
    if (full) toast('Alle 24 Türchen sind belegt – weitere Bilder wurden übersprungen.');
    changed();
  }
  function pickFiles(multiple, cb) {
    const inp = $('#fileImages'); inp.multiple = multiple; inp.value = '';
    inp.onchange = () => cb(inp.files); inp.click();
  }

  // Ortsnamen (nur nach ausdrücklicher Aktivierung)
  const geoQueue = []; let geoBusy = false;
  function geocode(im) {
    if (!state.geo || im.meta.lat == null || im.meta.place || im.geoTried) return;
    im.geoTried = true; geoQueue.push(im); pumpGeo();
  }
  async function pumpGeo() {
    if (geoBusy) return; geoBusy = true;
    while (geoQueue.length && state.geo) {
      const im = geoQueue.shift();
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=de&lat=${im.meta.lat.toFixed(5)}&lon=${im.meta.lon.toFixed(5)}`);
        const a = (await r.json()).address || {};
        im.meta.place = [a.village || a.town || a.city || a.municipality || a.suburb || a.county, a.state, a.country].filter(Boolean).join(', ');
        renderInspector();
      } catch (e) { im.geoTried = false; }
      await sleep(1100);
    }
    geoBusy = false;
  }

  // ------------------------------------------------------------------ Export
  function download(blob, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  }
  const fileName = (nr, what, ext) => `adventskalender-${nr}-${what}-${state.format}.${ext}`;
  const jpegBytes = async cv => new Uint8Array(await (await toBlob(cv, 'image/jpeg', 0.95)).arrayBuffer());

  // Schneidet den sichtbaren Ausschnitt (mm-Rechteck w×h, Quelle sx,sy,sw,sh in Pixeln) in Zielauflösung zu.
  async function cropJpeg(im, sx, sy, sw, sh, wmm) {
    const { img, release } = await decode(im.file);
    const dpi = state.exp.dpi === 'max' ? Infinity : +state.exp.dpi;
    let tw = Math.min(sw, wmm / 25.4 * dpi), th = tw * sh / sw;
    const lim = Math.sqrt(80e6 / (tw * th)); if (lim < 1) { tw *= lim; th *= lim; }
    const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(tw)); cv.height = Math.max(1, Math.round(th));
    const ctx = cv.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    release();
    return { bytes: await jpegBytes(cv), pw: cv.width, ph: cv.height };
  }
  function overlayCanvas(d) {
    const k = Math.min(600 / 25.4, 4000 / Math.max(d.w, d.h));
    const cv = document.createElement('canvas'); cv.width = Math.round(d.w * k); cv.height = Math.round(d.h * k);
    return { cv, ctx: cv.getContext('2d'), k };
  }

  async function buildPhotos(say) {
    const [W, H] = page(), pdf = new window.Pdf(W, H);
    if (state.bg.toLowerCase() !== '#ffffff') pdf.fillRect(0, 0, W, H, state.bg);
    const list = state.doors.filter(d => images.get(d.img));
    for (let i = 0; i < list.length; i++) {
      const d = list[i], im = images.get(d.img), g = imgGeom(d, im);
      say(`Bilderbogen: Bild ${i + 1} von ${list.length} …`);
      // Sichtbarer Teil des Bildes im Türchen (bei Zoom unter 100 % füllt das Bild das Türchen nicht aus)
      const vx = Math.max(0, -g.ox), vy = Math.max(0, -g.oy);
      const vw = Math.min(d.w, g.dw - g.ox) - vx, vh = Math.min(d.h, g.dh - g.oy) - vy;
      const j = await cropJpeg(im, (vx + g.ox) / g.s, (vy + g.oy) / g.s, vw / g.s, vh / g.s, vw);
      pdf.jpeg(j.bytes, j.pw, j.ph, d.x + vx, d.y + vy, vw, vh);
      if (state.num.onPhotos) { const o = overlayCanvas(d); drawNum(o.ctx, d, o.cv.width, o.cv.height); await pdf.rgba(o.cv, d.x, d.y, d.w, d.h); }
    }
    return pdf.build();
  }
  async function buildCover(say) {
    const [W, H] = page(), pdf = new window.Pdf(W, H);
    say('Deckblatt wird erstellt …');
    pdf.fillRect(0, 0, W, H, state.cover.color);
    const im = images.get(state.cover.img);
    if (im) {
      const { sx, sy, sw, sh } = coverCrop(im);
      const j = await cropJpeg(im, sx, sy, sw, sh, W);
      pdf.jpeg(j.bytes, j.pw, j.ph, 0, 0, W, H);
    }
    for (const d of state.doors) {
      if (state.cover.outlines) pdf.strokePoly(outlinePoints(d, null), '#ffffff', 0.15);
      if (!state.num.print) continue;
      const o = overlayCanvas(d); drawNum(o.ctx, d, o.cv.width, o.cv.height); await pdf.rgba(o.cv, d.x, d.y, d.w, d.h);
    }
    return pdf.build();
  }
  async function buildBack(say) {
    const [W, H] = page(), pdf = new window.Pdf(W, H);
    say('Rückseite wird erstellt …');
    for (const d of state.doors) {
      const r = mirrorRect(d, state.back.mirror);
      if (state.back.outlines) pdf.strokePoly(outlinePoints(d, state.back.mirror), '#bbbbbb', 0.15);
      if (!d.text.trim()) continue;
      const o = overlayCanvas(d); drawText(o.ctx, d, o.cv.width, o.cv.height, o.k); await pdf.rgba(o.cv, r.x, r.y, r.w, r.h);
    }
    return pdf.build();
  }
  function buildCut() {
    const [W, H] = page(), m = state.cut.mirror ? 'h' : null;
    let s = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n`;
    s += `<title>Adventskalender Schnittdatei ${state.format}</title>\n`;
    if (state.cut.frame) s += `<path id="blattrahmen" fill="none" stroke="#888888" stroke-width="0.1" d="M0 0L${W} 0L${W} ${H}L0 ${H}Z"/>\n`;
    let a = '', b = '';
    for (const d of [...state.doors].sort((p, q) => p.n - q.n)) {
      const g = cutGeom(d, m), id = String(d.n).padStart(2, '0');
      if (g.door.length) a += `<path id="tuer${id}" d="${pathData(g.door)}"/>\n`;
      if (g.fold.length) b += `<path id="knick${id}" d="${pathData(g.fold)}"/>\n`;
    }
    s += `<g id="tuerchenkanten" fill="none" stroke="#ff0000" stroke-width="0.1">\n${a}</g>\n`;
    if (b) s += `<g id="knickkanten" fill="none" stroke="#0000ff" stroke-width="0.1">\n${b}</g>\n`;
    return new Blob([s + '</svg>\n'], { type: 'image/svg+xml' });
  }
  function buildNums() {
    const sh = numSheet(), W = +sh.W.toFixed(2), H = +sh.H.toFixed(2);
    let s = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n`;
    s += `<title>Adventskalender Zahlen</title>\n<g id="zahlen" fill="none" stroke="#000000" stroke-width="0.1">\n`;
    numPaths(sh).forEach((q, i) => { s += `<path id="pos${String(i + 1).padStart(2, '0')}-zahl${q.n}" d="${q.d}"/>\n`; });
    return new Blob([s + '</g>\n</svg>\n'], { type: 'image/svg+xml' });
  }
  function buildLabels() {
    const [W, H] = page(), m = state.back.mirror === 'none' ? null : state.back.mirror;
    let s = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">\n`;
    s += `<title>Adventskalender Textkärtchen ${state.format}</title>\n`;
    if (state.cut.frame) s += `<path id="blattrahmen" fill="none" stroke="#888888" stroke-width="0.1" d="M0 0L${W} 0L${W} ${H}L0 ${H}Z"/>\n`;
    s += `<g id="textkaertchen" fill="none" stroke="#00aa00" stroke-width="0.1">\n`;
    for (const d of [...state.doors].sort((a, b) => a.n - b.n)) if (d.text.trim()) s += `<path id="text${String(d.n).padStart(2, '0')}" d="${pathData(labelPieces(d, m))}"/>\n`;
    return new Blob([s + '</g>\n</svg>\n'], { type: 'image/svg+xml' });
  }
  const exporters = {
    expPhotos: async say => {
      if (!state.doors.some(d => images.get(d.img))) return toast('Noch keine Bilder platziert.', 'err');
      download(await buildPhotos(say), fileName(1, 'bilderbogen', 'pdf'));
    },
    expCut: async () => download(buildCut(), fileName(2, 'schnittdatei', 'svg')),
    expBack: async say => download(await buildBack(say), fileName(3, 'rueckseite', 'pdf')),
    expCover: async say => download(await buildCover(say), fileName(4, 'deckblatt', 'pdf')),
    expNums: async () => download(buildNums(), fileName(5, 'zahlen', 'svg')),
    expLabels: async () => {
      if (!state.doors.some(d => d.text.trim())) return toast('Noch kein Rückseitentext eingegeben.', 'err');
      download(buildLabels(), fileName(6, 'textkaertchen', 'svg'));
    }
  };

  // ------------------------------------------------------------------ Projektdatei
  const dataUrl = blob => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
  async function saveProject() {
    await busy('Projekt wird gespeichert …', async () => {
      const used = new Set([...state.doors.map(d => d.img), state.cover.img].filter(id => images.get(id)));
      const parts = ['{"app":"adventskalender-studio","version":1,"state":', JSON.stringify(state), ',"images":['];
      let first = true;
      for (const id of used) {
        const im = images.get(id);
        parts.push((first ? '' : ',') + JSON.stringify({ id, name: im.name, type: im.file.type, lastModified: im.file.lastModified, place: im.meta.place || '', data: await dataUrl(im.file) }));
        first = false;
      }
      parts.push(']}');
      download(new Blob(parts, { type: 'application/json' }), 'adventskalender-projekt.json');
    });
  }
  function merge(base, over) {
    for (const k of Object.keys(over || {})) {
      if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && over[k] && typeof over[k] === 'object') merge(base[k], over[k]);
      else base[k] = over[k];
    }
    return base;
  }
  async function openProject(file) {
    await busy('Projekt wird geladen …', async say => {
      const p = JSON.parse(await file.text());
      if (p.app !== 'adventskalender-studio' || !p.state || !Array.isArray(p.state.doors)) throw new Error('Keine gültige Projektdatei');
      for (let i = 0; i < p.images.length; i++) {
        const r = p.images[i];
        say(`Bild ${i + 1} von ${p.images.length} wird geladen …`);
        const blob = await (await fetch(r.data)).blob();
        const im = await loadImage(new File([blob], r.name, { type: r.type, lastModified: r.lastModified }), r.id);
        if (r.place) im.meta.place = r.place;
      }
      state = merge(defaults(), p.state);
      for (const d of state.doors) { if (!d.ns) d.ns = 1; if (!d.ts) d.ts = 1; }
      sel = null; history = []; future = [];
      changed();
      toast('Projekt geladen', 'ok');
    });
  }

  // ------------------------------------------------------------------ Aktionen
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  function redistribute(order) {
    const list = state.doors.filter(d => images.get(d.img)).map(d => d.img);
    order(list);
    [...state.doors].sort((a, b) => a.n - b.n).forEach((d, i) => assign(d, list[i] || null));
  }
  const actions = {
    addImages: () => pickFiles(true, f => addFiles(f)),
    undo, redo,
    zoomIn: () => { zoom = clamp(zoom * 1.2, 0.4, 6); render(); },
    zoomOut: () => { zoom = clamp(zoom / 1.2, 0.4, 6); render(); },
    zoomFit: () => { zoom = 1; render(); },
    help: () => $('#helpDlg').showModal(),
    saveProject,
    openProject: () => { const i = $('#fileProject'); i.value = ''; i.onchange = () => i.files[0] && openProject(i.files[0]); i.click(); },
    autoLayout: () => { state.layout.auto = true; applyAuto(); changed(); },
    reroll: () => { state.layout.seed++; state.layout.auto = true; applyAuto(); changed(); },
    shuffleNums: () => { const n = shuffle(state.doors.map(d => d.n)); state.doors.forEach((d, i) => d.n = n[i]); changed(); },
    orderNums: () => {
      [...state.doors].sort(byPos).forEach((d, i) => d.n = i + 1);
      changed();
    },
    sortByDate: () => { redistribute(l => l.sort((a, b) => { const x = images.get(a), y = images.get(b); return (x.meta.date || x.file.lastModified) - (y.meta.date || y.file.lastModified); })); changed(); toast('Bilder chronologisch auf Türchen 1–24 verteilt', 'ok'); },
    shuffleImgs: () => { redistribute(shuffle); changed(); },
    coverImage: () => pickFiles(false, f => f[0] && busy('Bild wird geladen …', async () => { state.cover.img = (await loadImage(f[0])).id; view = 'cover'; changed(); })),
    numberReset: () => { const d = selDoor(); if (d) { delete d.nx; delete d.ny; changed(); } },
    coverCenter: () => { Object.assign(state.cover, { cx: .5, cy: .5, zoom: 1 }); changed(); },
    coverClear: () => { state.cover.img = null; changed(); },
    doorReplace: () => { const d = selDoor(); if (d) pickFiles(false, f => addFiles(f, d.id)); },
    doorCenter: () => { const d = selDoor(); if (d) { d.z = 1; d.cx = d.cy = .5; changed(); } },
    doorRemove: () => { const d = selDoor(); if (d) { d.img = null; changed(); } },
    expAll: () => busy('Export …', async say => {
      for (const k of ['expPhotos', 'expCut', 'expBack', 'expCover', 'expNums', 'expLabels']) { await exporters[k](say); await sleep(400); }
      toast('Export abgeschlossen', 'ok');
    })
  };
  for (const k of Object.keys(exporters)) actions[k] = () => busy('Export …', exporters[k]);

  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.modeChoice) {
      uiMode = b.dataset.modeChoice;
      try { localStorage.setItem('kalender-mode', uiMode); } catch {}
      return render();
    }
    if (b.dataset.act) return actions[b.dataset.act]();
    if (b.dataset.view) { view = b.dataset.view; if (tool === 'number' && view !== 'cover') tool = 'move'; return render(); }
    if (b.dataset.tool) { tool = b.dataset.tool; return render(); }
    const seg = b.closest('.seg[data-bind]');
    if (seg) { applyBind(seg.dataset.bind, b.dataset.v); changed(); }
  });

  function applyBind(path, v) {
    const [pw, ph] = page();
    setPath(path, v);
    if (path.startsWith('cover.')) view = 'cover';
    if (path === 'format' || path === 'orient') {
      if (state.layout.auto) applyAuto();
      else { const [W, H] = page(); for (const d of state.doors) { d.x = r2(d.x * W / pw); d.w = r2(d.w * W / pw); d.y = r2(d.y * H / ph); d.h = r2(d.h * H / ph); } }
    } else if (['layout.mode', 'layout.cols', 'layout.ratio'].includes(path)) { state.layout.auto = true; applyAuto(); }
    else if (path.startsWith('layout.')) { if (state.layout.auto) applyAuto(); }
    else if (path === 'geo' && v) for (const im of images.values()) geocode(im);
  }
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.numberAxis) {
      const d = selDoor(); if (d) { d[el.dataset.numberAxis] = +el.value / 100; touch(); } return;
    }
    if (el.id === 'showCut') { showCut = el.checked; return render(); }
    if (el.dataset.bind) {
      applyBind(el.dataset.bind, el.type === 'checkbox' ? el.checked : (el.type === 'range' || el.type === 'number') ? +el.value : el.value);
      return touch();
    }
    const d = selDoor();
    if (el.dataset.door && d) {
      const k = el.dataset.door, [W, H] = page();
      if (k === 'text' || k === 'hinge') d[k] = el.value;
      else if (k === 'n') {
        const v = clamp(Math.round(+el.value) || d.n, 1, N), other = state.doors.find(o => o.n === v);
        if (other && other !== d) other.n = d.n;
        d.n = v;
      } else if (k === 'z' || k === 'ns' || k === 'ts') d[k] = +el.value;
      else if (el.value !== '' && isFinite(+el.value)) {
        d[k] = +el.value; state.layout.auto = false;
        d.w = clamp(d.w, 10, W); d.h = clamp(d.h, 10, H); d.x = clamp(d.x, 0, W - d.w); d.y = clamp(d.y, 0, H - d.h);
      }
      touch();
    }
  });
  document.addEventListener('change', e => { if (e.target.dataset.bind || e.target.dataset.door || e.target.dataset.numberAxis) commit(); });

  // ------------------------------------------------------------------ Maus-Interaktion auf der Seite
  let drag = null;
  const gxEl = $('#gx'), gyEl = $('#gy');
  function snapLines(id) {
    const [W, H] = page(), m = state.layout.margin, g = state.layout.gap;
    const xs = [m, W - m, W / 2], ys = [m, H - m, H / 2];
    for (const o of state.doors) if (o.id !== id) { xs.push(o.x, o.x + o.w, o.x + o.w + g, o.x - g); ys.push(o.y, o.y + o.h, o.y + o.h + g, o.y - g); }
    return { xs, ys };
  }
  function nearest(v, cands, tol) { let best = null, bd = tol; for (const c of cands) { const dd = Math.abs(c - v); if (dd < bd) { bd = dd; best = c; } } return best; }
  function showGuides(x, y) {
    gxEl.style.display = x == null ? 'none' : 'block'; if (x != null) gxEl.style.left = x * scale + 'px';
    gyEl.style.display = y == null ? 'none' : 'block'; if (y != null) gyEl.style.top = y * scale + 'px';
  }

  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    hideTip();
    const el = e.target.closest('.door');
    if (!el) { sel = null; return render(); }
    const d = doorById(el.dataset.id);
    sel = d.id;
    let mode = view === 'back' ? null : e.target.dataset.h ? 'resize' : (e.shiftKey && tool === 'move') ? 'crop' : tool;
    if (tool === 'number') mode = view === 'cover' && state.num.print ? 'number' : null;
    if (mode === 'crop' && !images.get(d.img)) mode = null;
    if (mode === 'swap' && !images.get(d.img)) mode = null;
    if (mode) { drag = { mode, d, handle: e.target.dataset.h, sx: e.clientX, sy: e.clientY, o: { ...d }, moved: false, lines: snapLines(d.id) }; stage.setPointerCapture(e.pointerId); }
    render();
  });
  stage.addEventListener('pointermove', e => {
    if (!drag) return hover(e);
    const dx = (e.clientX - drag.sx) / scale, dy = (e.clientY - drag.sy) / scale, d = drag.d, o = drag.o;
    if (!drag.moved && Math.hypot(dx, dy) * scale < 3) return;
    drag.moved = true;
    const [W, H] = page(), tol = e.altKey ? 0 : 6 / scale, { xs, ys } = drag.lines;
    let gx = null, gy = null;
    if (drag.mode === 'number') {
      const [nx, ny] = numberPosition(o);
      d.nx = nx + dx / d.w; d.ny = ny + dy / d.h;
      [d.nx, d.ny] = numberPosition(d);
    } else if (drag.mode === 'move') {
      let nx = o.x + dx, ny = o.y + dy;
      const a = nearest(nx, xs, tol), b = nearest(nx + d.w, xs, tol);
      if (a != null && (b == null || Math.abs(a - nx) <= Math.abs(b - nx - d.w))) { nx = a; gx = a; } else if (b != null) { nx = b - d.w; gx = b; }
      const c = nearest(ny, ys, tol), f = nearest(ny + d.h, ys, tol);
      if (c != null && (f == null || Math.abs(c - ny) <= Math.abs(f - ny - d.h))) { ny = c; gy = c; } else if (f != null) { ny = f - d.h; gy = f; }
      d.x = r2(clamp(nx, 0, W - d.w)); d.y = r2(clamp(ny, 0, H - d.h)); state.layout.auto = false;
    } else if (drag.mode === 'resize') {
      let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h; const hd = drag.handle, MIN = 12;
      if (hd.includes('w')) { x1 = clamp(x1 + dx, 0, x2 - MIN); const s = nearest(x1, xs, tol); if (s != null && s <= x2 - MIN) { x1 = s; gx = s; } }
      else { x2 = clamp(x2 + dx, x1 + MIN, W); const s = nearest(x2, xs, tol); if (s != null && s >= x1 + MIN) { x2 = s; gx = s; } }
      if (hd.includes('n')) { y1 = clamp(y1 + dy, 0, y2 - MIN); const s = nearest(y1, ys, tol); if (s != null && s <= y2 - MIN) { y1 = s; gy = s; } }
      else { y2 = clamp(y2 + dy, y1 + MIN, H); const s = nearest(y2, ys, tol); if (s != null && s >= y1 + MIN) { y2 = s; gy = s; } }
      Object.assign(d, { x: r2(x1), y: r2(y1), w: r2(x2 - x1), h: r2(y2 - y1) }); state.layout.auto = false;
    } else if (drag.mode === 'crop') {
      const g = imgGeom(o, images.get(d.img));
      if (Math.abs(g.dw - d.w) > 0.01) d.cx = clamp(o.cx - dx / (g.dw - d.w), 0, 1);
      if (Math.abs(g.dh - d.h) > 0.01) d.cy = clamp(o.cy - dy / (g.dh - d.h), 0, 1);
    } else if (drag.mode === 'swap') {
      const t = document.elementsFromPoint(e.clientX, e.clientY).map(x => x.closest && x.closest('.door')).find(x => x && x.dataset.id !== d.id);
      for (const x of doorEls.values()) x.classList.toggle('target', x === t);
      drag.target = t ? t.dataset.id : null;
      return;
    }
    showGuides(gx, gy);
    render();
  });
  function endDrag() {
    if (!drag) return;
    if (drag.mode === 'swap' && drag.target) {
      const a = drag.d, b = doorById(drag.target);
      for (const k of ['img', 'z', 'cx', 'cy']) [a[k], b[k]] = [b[k], a[k]];
      a.z = b.z = 1; a.cx = a.cy = b.cx = b.cy = .5;
      sel = b.id;
    }
    for (const x of doorEls.values()) x.classList.remove('target');
    const moved = drag.moved; drag = null; showGuides(null, null);
    if (moved) changed(); else render();
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', e => {
    const el = e.target.closest('.door'); if (!el || view === 'back') return;
    if (!images.get(doorById(el.dataset.id).img)) return pickFiles(false, f => addFiles(f, el.dataset.id));
    if (tool !== 'crop') { tool = 'crop'; render(); toast('Ausschnitt-Modus: Bild ziehen zum Verschieben, Mausrad zoomt. Taste V wechselt zurück.'); }
  });
  wrap.addEventListener('wheel', e => {
    const el = e.target.closest && e.target.closest('.door');
    if (e.ctrlKey) { e.preventDefault(); zoom = clamp(zoom * Math.exp(-e.deltaY * 0.0015), 0.4, 6); return render(); }
    if (el && view !== 'back' && (tool === 'crop' || el.dataset.id === sel)) {
      const d = doorById(el.dataset.id);
      if (!images.get(d.img)) return;
      e.preventDefault(); sel = d.id; d.z = clamp(d.z * Math.exp(-e.deltaY * 0.0012), 0.3, 4); touch();
    }
  }, { passive: false });

  // Metadaten beim Überfahren
  const tip = $('#tooltip'); let tipId = null;
  function hideTip() { tip.hidden = true; tipId = null; }
  function hover(e) {
    const el = e.target.closest('.door'), d = el && doorById(el.dataset.id), im = d && images.get(d.img);
    if (!im || view === 'back' || view === 'cover') return hideTip();
    if (tipId !== d.id + im.id + (im.meta.place || '')) {
      tipId = d.id + im.id + (im.meta.place || '');
      tip.innerHTML = `<h5>Türchen ${d.n} · ${esc(im.name)}</h5><dl>` + metaRows(d, im).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + '</dl>';
    }
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.min(e.clientX + 16, innerWidth - tw - 8) + 'px';
    tip.style.top = (e.clientY + 18 + th > innerHeight ? e.clientY - th - 12 : e.clientY + 18) + 'px';
  }
  stage.addEventListener('pointerleave', hideTip);

  // Dateien per Drag & Drop
  wrap.addEventListener('dragover', e => { e.preventDefault(); wrap.classList.add('dragover'); });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('dragover'));
  wrap.addEventListener('drop', e => {
    e.preventDefault(); wrap.classList.remove('dragover');
    const el = e.target.closest && e.target.closest('.door');
    addFiles(e.dataTransfer.files, el && view !== 'back' ? el.dataset.id : null);
  });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  // Tastatur
  document.addEventListener('keydown', e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range' && e.target.type !== 'checkbox') return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (e.ctrlKey && k === 'y') { e.preventDefault(); return redo(); }
    if (e.ctrlKey || e.metaKey) return;
    if (k === 'v') { tool = 'move'; return render(); }
    if (k === 'c') { tool = 'crop'; return render(); }
    if (k === 't') { tool = 'swap'; return render(); }
    if (k === 'escape') { sel = null; return render(); }
    const d = selDoor(); if (!d) return;
    if (k === 'delete' || k === 'backspace') { d.img = null; return changed(); }
    const mv = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] }[k];
    if (mv && view !== 'back') {
      e.preventDefault();
      const [W, H] = page(), st = e.shiftKey ? 0.1 : 1;
      d.x = r2(clamp(d.x + mv[0] * st, 0, W - d.w)); d.y = r2(clamp(d.y + mv[1] * st, 0, H - d.h)); state.layout.auto = false; touch();
    }
  });

  window.addEventListener('beforeunload', e => { if (state.doors.some(d => d.img)) { e.preventDefault(); e.returnValue = ''; } });
  new ResizeObserver(() => render()).observe(wrap);

  // ------------------------------------------------------------------ Start
  for (const s of $$('.fontsel')) s.innerHTML = FONTS.map(f => `<option style="font-family:'${f}'">${f}</option>`).join('');
  applyAuto();
  changed();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
  window.kalender = { addFiles, build: { photos: buildPhotos, cover: buildCover, back: buildBack, cut: buildCut, nums: buildNums, labels: buildLabels }, get state() { return state; } };
})();
