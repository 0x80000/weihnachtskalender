// Run against a local HTTP server: node tests/perforation.cjs [URL]
// Prüft die Perforation: feste Steglänge, gleich lange Schnitte, jede Türchenkante mit Steg, keine Stege in Ecken.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.argv[2] || 'http://127.0.0.1:8010');
    await page.locator('[data-mode-choice="pro"]').click();
    await page.locator('[data-bind="layout.mode"] [data-v="mosaic"]').click();
    const configs = [];
    for (const radius of [0, 3, 8]) for (const roundHinge of [true, false]) for (const [cut, gap] of [[13, 1], [4, 1], [20, 0.3], [0.5, 5], [8, 2]]) configs.push({ radius, roundHinge, cut, gap });
    let checked = 0;
    for (let roll = 0; roll < 4; roll++) {
      await page.locator('[data-act="reroll"]').click();
      const res = await page.evaluate(configs => {
        const k = window.kalender, s = k.state, out = [];
        // Verbundene Schnitte (aufeinanderfolgende Wegstücke ohne Lücke) zusammenfassen
        const chains = pcs => { const ch = []; let last = null; for (const pc of pcs) { const join = last && Math.hypot(last[0] - pc.p[0], last[1] - pc.p[1]) < 1e-6; if (join) ch[ch.length - 1].push(pc); else ch.push([pc]); last = pc.q; } return ch; };
        for (const c of configs) {
          Object.assign(s.cut, { radius: c.radius, roundHinge: c.roundHinge }); Object.assign(s.cut.door, { mode: 'perf', cut: c.cut, gap: c.gap }); Object.assign(s.cut.fold, { mode: 'perf', cut: c.cut, gap: c.gap });
          for (const d of s.doors) {
            const g = k.geom.cutGeom(d, false), ch = chains(g.door);
            // Stege zwischen den Schnitten
            const gaps = [], lens = ch.map(x => x.reduce((t, pc) => t + pc.len, 0));
            for (let i = 1; i < ch.length; i++) { const a = ch[i - 1].at(-1).q, b = ch[i][0].p; gaps.push({ len: Math.hypot(a[0] - b[0], a[1] - b[1]), a, b, arcNear: ch[i - 1].at(-1).arc || ch[i][0].arc }); }
            // Ecken: Stege dürfen nicht auf einem Bogen liegen
            // Kante eines geraden Stücks: achsenparallel → gemeinsame x- oder y-Koordinate
            const edgeKey = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 ? 'x' + a[0].toFixed(3) : Math.abs(a[1] - b[1]) < 1e-6 ? 'y' + a[1].toFixed(3) : null;
            const gapEdges = new Set(gaps.map(x => edgeKey(x.a, x.b)));
            const inner = {}; for (const x of ch) if (x.length === 1 && !x[0].arc) { const e = edgeKey(x[0].p, x[0].q); (inner[e] = inner[e] || []).push(x[0].len); }
            const innerSpread = Math.max(0, ...Object.values(inner).map(v => v.length > 2 ? Math.max(...v.slice(1, -1)) - Math.min(...v.slice(1, -1)) : 0));
            out.push({ c, w: d.w, h: d.h, gaps: gaps.map(x => x.len), lens, edgesWithGap: gapEdges.size, innerSpread, sides: g.door.filter(pc => !pc.arc).length,
              diagGap: gaps.some(x => Math.abs(x.a[0] - x.b[0]) > 1e-6 && Math.abs(x.a[1] - x.b[1]) > 1e-6),
              fold: (() => { const f = g.fold; const L = []; for (let i = 1; i < f.length; i++) L.push(Math.hypot(f[i - 1].q[0] - f[i].p[0], f[i - 1].q[1] - f[i].p[1])); return { n: f.length, gaps: L, lens: f.map(p => p.len) }; })() });
          }
        }
        return out;
      }, configs);
      for (const r of res) {
        const ctx = JSON.stringify({ c: r.c, w: r.w, h: r.h });
        // Jede der drei Türchenkanten hat mindestens einen Steg → mindestens 3 Stege, also ≥ 4 Schnitte
        assert(r.gaps.length >= 3 && r.edgesWithGap === 3, 'nicht jede Kante hat einen Steg ' + ctx);
        assert(r.innerSpread < 1e-3, 'Schnitte einer Kante ungleich lang ' + ctx);
        for (const g of r.gaps) assert(Math.abs(g - r.c.gap) < 1e-3, `Steglänge ${g} statt ${r.c.gap} ` + ctx);
        // Kein Steg schräg über eine Ecke (Steg liegt auf einer geraden Kante)
        assert(!r.diagGap, 'Steg in einer Ecke ' + ctx);
        for (const g of r.fold.gaps) assert(Math.abs(g - r.c.gap) < 1e-3, 'Knick-Steg ' + ctx);
        const fl = r.fold.lens; if (fl.length) assert(Math.max(...fl) - Math.min(...fl) < 1e-3, 'Knick-Schnitte ungleich ' + ctx);
        checked++;
      }
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: Perforation in ${checked} Türchen-Konfigurationen: Steglänge fest, jede Kante mit Steg, keine Stege in Ecken.`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
