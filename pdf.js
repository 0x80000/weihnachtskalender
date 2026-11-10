// Minimaler PDF-Schreiber: eine Seite in mm, JPEG-Bilder (unverändert eingebettet),
// verlustfreie RGBA-Bilder (Flate + Transparenzmaske) und einfache Vektorflächen/-linien.
(function () {
  'use strict';

  const K = 72 / 25.4;
  const f = v => String(+(+v).toFixed(3));
  const rgb = hex => [1, 3, 5].map(i => f(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');

  async function deflate(u8) {
    const cs = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(cs).arrayBuffer());
  }

  class Pdf {
    constructor(wmm, hmm, title) {
      this.W = wmm; this.H = hmm; this.title = title || '';
      this.ops = []; this.imgs = [];
    }
    fillRect(x, y, w, h, hex) {
      this.ops.push(`${rgb(hex)} rg ${f(x * K)} ${f((this.H - y - h) * K)} ${f(w * K)} ${f(h * K)} re f`);
    }
    strokePoly(pts, hex, lw) {
      const H = this.H;
      this.ops.push(`${rgb(hex)} RG ${f(lw * K)} w ` + pts.map((p, i) => `${f(p[0] * K)} ${f((H - p[1]) * K)} ${i ? 'l' : 'm'}`).join(' ') + ' h S');
    }
    strokeRect(x, y, w, h, hex, lw) {
      this.ops.push(`${rgb(hex)} RG ${f(lw * K)} w ${f(x * K)} ${f((this.H - y - h) * K)} ${f(w * K)} ${f(h * K)} re S`);
    }
    _place(name, x, y, w, h, rot180) {
      const X = x * K, Y = (this.H - y - h) * K, Wp = w * K, Hp = h * K;
      this.ops.push(rot180
        ? `q ${f(-Wp)} 0 0 ${f(-Hp)} ${f(X + Wp)} ${f(Y + Hp)} cm /${name} Do Q`
        : `q ${f(Wp)} 0 0 ${f(Hp)} ${f(X)} ${f(Y)} cm /${name} Do Q`);
    }
    jpeg(bytes, pw, ph, x, y, w, h) {
      const name = 'Im' + (this.imgs.length + 1);
      this.imgs.push({ name, kind: 'jpeg', data: bytes, pw, ph });
      this._place(name, x, y, w, h);
    }
    // Zeichnet den Inhalt eines Canvas (mit Transparenz) in das Rechteck x,y,w,h (mm).
    async rgba(canvas, x, y, w, h) {
      const cw = canvas.width, ch = canvas.height;
      const px = canvas.getContext('2d').getImageData(0, 0, cw, ch).data;
      let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
      for (let j = 0; j < ch; j++) {
        const row = j * cw * 4;
        for (let i = 0; i < cw; i++) {
          if (px[row + i * 4 + 3]) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
        }
      }
      if (x1 < 0) return;
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      const col = new Uint8Array(bw * bh * 3), al = new Uint8Array(bw * bh);
      for (let j = 0; j < bh; j++) {
        for (let i = 0; i < bw; i++) {
          const s = ((j + y0) * cw + i + x0) * 4, d = j * bw + i;
          col[d * 3] = px[s]; col[d * 3 + 1] = px[s + 1]; col[d * 3 + 2] = px[s + 2]; al[d] = px[s + 3];
        }
      }
      const name = 'Im' + (this.imgs.length + 1);
      this.imgs.push({ name, kind: 'rgba', data: await deflate(col), mask: await deflate(al), pw: bw, ph: bh });
      this._place(name, x + x0 / cw * w, y + y0 / ch * h, bw / cw * w, bh / ch * h);
    }
    build() {
      const enc = new TextEncoder();
      const parts = []; const offs = []; let off = 0;
      const push = s => { const u = typeof s === 'string' ? enc.encode(s) : s; parts.push(u); off += u.length; };
      const obj = (n, dict, stream) => {
        offs[n] = off;
        push(`${n} 0 obj\n`);
        if (stream) { push(`<<${dict}/Length ${stream.length}>>\nstream\n`); push(stream); push('\nendstream\nendobj\n'); }
        else push(`<<${dict}>>\nendobj\n`);
      };
      push('%PDF-1.4\n'); push(new Uint8Array([37, 0xE2, 0xE3, 0xCF, 0xD3, 10]));

      let next = 5; const res = [];
      for (const im of this.imgs) {
        im.num = next++;
        if (im.kind === 'rgba') im.maskNum = next++;
        res.push(`/${im.name} ${im.num} 0 R`);
      }
      obj(1, '/Type/Catalog/Pages 2 0 R');
      obj(2, '/Type/Pages/Kids[3 0 R]/Count 1');
      obj(3, `/Type/Page/Parent 2 0 R/MediaBox[0 0 ${f(this.W * K)} ${f(this.H * K)}]/Contents 4 0 R/Resources<</XObject<<${res.join(' ')}>>>>`);
      obj(4, '', enc.encode(this.ops.join('\n')));
      for (const im of this.imgs) {
        const base = `/Type/XObject/Subtype/Image/Width ${im.pw}/Height ${im.ph}/BitsPerComponent 8`;
        if (im.kind === 'jpeg') obj(im.num, base + '/ColorSpace/DeviceRGB/Filter/DCTDecode', im.data);
        else {
          obj(im.num, base + `/ColorSpace/DeviceRGB/Filter/FlateDecode/SMask ${im.maskNum} 0 R`, im.data);
          obj(im.maskNum, base + '/ColorSpace/DeviceGray/Filter/FlateDecode', im.mask);
        }
      }
      const xref = off, count = next;
      let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
      for (let i = 1; i < count; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
      push(x + `trailer\n<</Size ${count}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`);
      return new Blob(parts, { type: 'application/pdf' });
    }
  }

  window.Pdf = Pdf;
})();
