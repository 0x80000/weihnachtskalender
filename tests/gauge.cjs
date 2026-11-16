// Run against a local HTTP server: node tests/gauge.cjs [URL]
// Prüft Maßhaltigkeit: PrintScaling/None in allen PDFs, Seitengrößen 1:1, Kontrollmaßstrecke
// (100 mm, verdeckter Bereich, gleiche Stelle in PDF und SVG, gespiegelt, Option, Hinweis ohne Platz).
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const near = (a, b, t = 1e-3) => Math.abs(a - b) <= t;
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(process.argv[2] || 'http://127.0.0.1:8010');
    // Ein Bild über die Oberfläche laden und allen Türchen zuweisen
    const png = await page.screenshot();
    const fc = page.waitForEvent('filechooser'); await page.locator('[data-act="addImages"]').first().click();
    await (await fc).setFiles({ name: 'foto.png', mimeType: 'image/png', buffer: png });
    await page.waitForFunction(() => window.kalender.state.doors.some(d => d.img));
    await page.evaluate(() => { const s = window.kalender.state, id = s.doors.find(d => d.img).img; s.doors.forEach(d => d.img = id); });

    // Hilfsfunktionen im Browser: PDF erzeugen und Linienaufrufe mitschneiden
    const info = () => page.evaluate(async () => {
      const k = window.kalender, P = window.Pdf.prototype, orig = P.strokeLine, lines = [];
      P.strokeLine = function (pts, ...r) { lines.push(pts); return orig.call(this, pts, ...r); };
      try {
        const pdfs = {};
        for (const n of ['photos', 'cover', 'back']) pdfs[n] = await (await k.build[n](() => {})).text();
        return { pdfs, lines, svg: await k.build.cut().text(), place: k.geom.gaugePlace(), doors: k.state.doors.map(d => ({ x: d.x, y: d.y, w: d.w, h: d.h })), fmt: k.state.format, orient: k.state.orient };
      } finally { P.strokeLine = orig; }
    });
    const svgGauge = svg => { const m = svg.match(/<path id="kontrollmass"[^>]*d="([^"]+)"/); return m ? m[1].split('M').filter(Boolean).map(seg => seg.split('L').map(p => p.trim().split(/\s+/).map(Number))) : null; };
    const PAGES = { A4: [210, 297], A3: [297, 420] };

    let r = await info();
    // (a) Alle PDFs: PrintScaling/None und MediaBox exakt in mm
    for (const [n, t] of Object.entries(r.pdfs)) {
      assert.match(t, /\/ViewerPreferences<<\/PrintScaling\/None>>/, n);
      assert.match(t, /\/MediaBox\[0 0 841\.89 1190\.551\]/, n);
    }
    assert.match(r.svg, /width="297mm" height="420mm" viewBox="0 0 297 420"/);

    // (b) Strecke: 12 Linienzüge, Grundlinie genau 100 mm, im verdeckten Bereich
    const check = (r, label) => {
      const [a, b] = PAGES[r.fmt], [W, H] = r.orient === 'landscape' ? [b, a] : [a, b];
      const g = r.place; assert(g, 'kein Platz: ' + label);
      assert(g.x >= 5 - 1e-6 && g.y >= 5 - 1e-6 && g.x + g.w <= W - 5 + 1e-6 && g.y + g.h <= H - 5 + 1e-6, 'Randabstand ' + label);
      for (const d of r.doors) assert(g.x + g.w <= d.x - 3 + 1e-6 || g.x >= d.x + d.w + 3 - 1e-6 || g.y + g.h <= d.y - 3 + 1e-6 || g.y >= d.y + d.h + 3 - 1e-6, 'überlappt Türchen ' + label);
      assert.equal(r.lines.length, 12, label);
      const [p, q] = r.lines[0]; assert(near(Math.hypot(q[0] - p[0], q[1] - p[1]), 100), 'Länge ' + label);
      const sv = svgGauge(r.svg); assert(sv, 'SVG ohne Strecke ' + label);
      assert.equal(sv.length, 12);
      sv.forEach((l, i) => l.forEach((pt, j) => assert(near(pt[0], r.lines[i][j][0]) && near(pt[1], r.lines[i][j][1]), 'PDF/SVG-Lage ' + label)));
      return W;
    };
    check(r, 'A3 hoch Raster');
    const doorsOn = r.svg.replace(/<path id="kontrollmass".*\n/, '');

    // Alle Formate, Ausrichtungen und Mosaik
    await page.locator('[data-mode-choice="pro"]').click();
    for (const fmt of ['A4', 'A3']) for (const orient of ['portrait', 'landscape']) for (const mode of ['grid', 'mosaic']) {
      await page.evaluate(([fmt, orient]) => { const s = window.kalender.state; s.format = fmt; s.orient = orient; }, [fmt, orient]);
      await page.locator(`[data-bind="layout.mode"] [data-v="${mode}"]`).click();
      check(await info(), `${fmt} ${orient} ${mode}`);
    }
    await page.locator('[data-bind="layout.mode"] [data-v="grid"]').click();
    await page.evaluate(() => { const s = window.kalender.state; s.format = 'A3'; s.orient = 'portrait'; });
    await page.locator('[data-bind="layout.mode"] [data-v="grid"]').click();

    // Vorschau zeigt die Strecke im Bilderbogen und in der Schnittansicht
    assert.equal(await page.locator('#cutSvg path.gauge').count(), 1);
    assert.match(await page.locator('#gaugeInfo').textContent(), /verdeckten Rand/);

    // Gespiegelte Schnittdatei: Strecke wird mitgespiegelt, PDF bleibt ungespiegelt
    await page.locator('[data-bind="cut.mirror"]').check();
    r = await info();
    const sv = svgGauge(r.svg);
    sv.forEach((l, i) => l.forEach((pt, j) => assert(near(pt[0], 297 - r.lines[i][j][0]) && near(pt[1], r.lines[i][j][1]), 'Spiegelung')));
    await page.locator('[data-bind="cut.mirror"]').uncheck();

    // Option aus: keine Strecke, Türchen-/Knickgeometrie unverändert
    const box = page.locator('[data-bind="cut.gauge"]');
    assert.equal(await box.isVisible(), true); assert.equal(await box.isChecked(), true);
    await box.uncheck();
    r = await info();
    assert.equal(r.lines.length, 0); assert.equal(svgGauge(r.svg), null); assert.equal(r.svg, doorsOn);
    assert.equal(await page.locator('#cutSvg path.gauge').count(), 0);
    // Option wird im Projekt gespeichert
    const dl = page.waitForEvent('download'); await page.locator('[data-act="saveProject"]').click();
    const saved = JSON.parse(require('fs').readFileSync(await (await dl).path(), 'utf8'));
    assert.equal(saved.state.cut.gauge, false);
    // Ältere Projekte ohne Option: Standard an
    delete saved.state.cut.gauge;
    const op = page.waitForEvent('filechooser'); await page.locator('[data-act="openProject"]').click();
    await (await op).setFiles({ name: 'alt.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
    await page.waitForFunction(() => window.kalender.state.cut.gauge === true);

    // Kein freier Platz: Hinweis statt Strecke über einem Türchen
    await page.locator('[data-bind="layout.margin"]').fill('5');
    await page.locator('[data-bind="layout.gap"]').fill('2');
    r = await info();
    assert.equal(r.place, null); assert.equal(r.lines.length, 0); assert.equal(svgGauge(r.svg), null);
    assert.match(await page.locator('#gaugeInfo').textContent(), /Kein freier Platz/);
    await page.locator('[data-act="expCut"]').click();
    await page.locator('.toast.err', { hasText: 'Kontrollmaßstrecke' }).waitFor();

    // Druckhinweis im Exportbereich (auch im Simple Mode)
    await page.locator('[data-mode-choice="simple"]').click();
    assert.equal(await page.locator('#printHint').isVisible(), true);
    assert.match(await page.locator('#printHint').textContent(), /Tatsächliche Größe/);
    assert.equal(await box.isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('PASS: PrintScaling/None, Seitengrößen, Kontrollmaßstrecke (Lage, Länge, PDF=SVG, Spiegelung, alle Formate), Option + Projekt, kein Platz → Hinweis, Druckhinweis.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
