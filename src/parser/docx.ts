// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Word（.docx）→ 带完整排版的 HTML：纸张与页边距、字体字号颜色、对齐、缩进、段前段后、行距、
 * 段落边框与底纹、项目符号与编号、右对齐制表位（右侧的时间）、表格（合并单元格、边框、底纹）、图片、链接。
 * 之后交给 HTML 解析器，和 PDF / HTML 走同一套版面分析与结构识别。
 */

// ---------- 读 zip ----------
async function unzip(buf: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const u = new Uint8Array(buf), v = new DataView(buf);
  let eocd = -1;
  for (let i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('不是有效的 Word 文件');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const out = new Map<string, Uint8Array>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(u.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extra + comment;
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = u.subarray(start, start + size);
    if (method === 0) out.set(name, data);
    else if (method === 8) {
      const s = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out.set(name, new Uint8Array(await new Response(s).arrayBuffer()));
    }
  }
  return out;
}

// ---------- XML 小工具 ----------
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const kids = (el: Element | null | undefined, name: string) => (el ? [...el.children].filter(c => c.localName === name) : []);
const kid = (el: Element | null | undefined, name: string) => kids(el, name)[0] ?? null;
const attr = (el: Element | null | undefined, name: string) => el?.getAttributeNS(W, name) ?? el?.getAttribute('w:' + name) ?? null;
const on = (el: Element | null) => !!el && !['0', 'false', 'off', 'none'].includes(attr(el, 'val') ?? '');
const num = (v: string | null, d = 0) => (v === null || v === '' || isNaN(+v) ? d : +v);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SYMBOL_BULLETS: Record<string, string> = { '': '•', '': '▪', '': '➢', '': '❖', '': '✓', '': '■', '': '◦', o: '◦', '': '●' };

interface RPr { b?: boolean; i?: boolean; u?: boolean; strike?: boolean; sz?: number; color?: string; latin?: string; ea?: string; caps?: boolean; smallCaps?: boolean; bg?: string; va?: string }
interface PPr { jc?: string; before?: number; after?: number; line?: number; lineRule?: string; left?: number; right?: number; first?: number; hanging?: number; numId?: string; ilvl?: number; bdrB?: string; bdrT?: string; shd?: string; tabsRight?: boolean; style?: string; keepNext?: boolean }

export async function docxToHtml(buf: ArrayBuffer): Promise<string> {
  const files = await unzip(buf);
  const text = (n: string) => { const f = files.get(n); return f ? new TextDecoder().decode(f) : ''; };
  const parse = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
  const doc = parse(text('word/document.xml'));
  const styles = parse(text('word/styles.xml') || '<w:styles xmlns:w="' + W + '"/>');
  const numbering = parse(text('word/numbering.xml') || '<w:numbering xmlns:w="' + W + '"/>');
  const theme = parse(text('word/theme/theme1.xml') || '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>');
  const rels = new Map<string, string>();
  for (const r of parse(text('word/_rels/document.xml.rels') || '<Relationships/>').getElementsByTagName('Relationship')) rels.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '');

  // 主题字体
  const tf = (major: boolean, kind: 'latin' | 'ea') => {
    const f = theme.getElementsByTagName(major ? 'a:majorFont' : 'a:minorFont')[0];
    if (!f) return '';
    if (kind === 'latin') return f.getElementsByTagName('a:latin')[0]?.getAttribute('typeface') ?? '';
    const ea = f.getElementsByTagName('a:ea')[0]?.getAttribute('typeface');
    if (ea) return ea;
    return [...f.getElementsByTagName('a:font')].find(x => x.getAttribute('script') === 'Hans')?.getAttribute('typeface') ?? '';
  };

  const readR = (rPr: Element | null): RPr => {
    const o: RPr = {};
    if (!rPr) return o;
    const b = kid(rPr, 'b'); if (b) o.b = on(b);
    const i = kid(rPr, 'i'); if (i) o.i = on(i);
    const u = kid(rPr, 'u'); if (u) o.u = attr(u, 'val') !== 'none';
    const st = kid(rPr, 'strike'); if (st) o.strike = on(st);
    const sz = kid(rPr, 'sz'); if (sz) o.sz = num(attr(sz, 'val')) / 2;
    const c = kid(rPr, 'color'); if (c && attr(c, 'val') && attr(c, 'val') !== 'auto') o.color = '#' + attr(c, 'val');
    const f = kid(rPr, 'rFonts');
    if (f) {
      const lat = attr(f, 'ascii') ?? attr(f, 'hAnsi') ?? (attr(f, 'asciiTheme') ? tf(/major/.test(attr(f, 'asciiTheme')!), 'latin') : null);
      const ea = attr(f, 'eastAsia') ?? (attr(f, 'eastAsiaTheme') ? tf(/major/.test(attr(f, 'eastAsiaTheme')!), 'ea') : null);
      if (lat) o.latin = lat; if (ea) o.ea = ea;
    }
    const caps = kid(rPr, 'caps'); if (caps) o.caps = on(caps);
    const sc = kid(rPr, 'smallCaps'); if (sc) o.smallCaps = on(sc);
    const hl = kid(rPr, 'highlight'); if (hl && attr(hl, 'val') !== 'none') o.bg = attr(hl, 'val')!;
    const shd = kid(rPr, 'shd'); if (shd && attr(shd, 'fill') && !/auto|FFFFFF/i.test(attr(shd, 'fill')!)) o.bg = '#' + attr(shd, 'fill');
    const va = kid(rPr, 'vertAlign'); if (va) o.va = attr(va, 'val') ?? undefined;
    return o;
  };
  const border = (b: Element | null) => {
    if (!b || /nil|none/.test(attr(b, 'val') ?? '')) return undefined;
    const c = attr(b, 'color');
    return `${Math.max(0.5, num(attr(b, 'sz'), 4) / 8)}pt solid ${c && c !== 'auto' ? '#' + c : '#000'}`;
  };
  const readP = (pPr: Element | null): PPr => {
    const o: PPr = {};
    if (!pPr) return o;
    const ps = kid(pPr, 'pStyle'); if (ps) o.style = attr(ps, 'val') ?? undefined;
    const jc = kid(pPr, 'jc'); if (jc) o.jc = attr(jc, 'val') ?? undefined;
    const sp = kid(pPr, 'spacing');
    if (sp) {
      if (attr(sp, 'before') !== null) o.before = num(attr(sp, 'before')) / 20;
      if (attr(sp, 'after') !== null) o.after = num(attr(sp, 'after')) / 20;
      if (attr(sp, 'line') !== null) { o.line = num(attr(sp, 'line')); o.lineRule = attr(sp, 'lineRule') ?? 'auto'; }
    }
    const ind = kid(pPr, 'ind');
    if (ind) {
      const l = attr(ind, 'left') ?? attr(ind, 'start'); if (l !== null) o.left = num(l) / 20;
      const r = attr(ind, 'right') ?? attr(ind, 'end'); if (r !== null) o.right = num(r) / 20;
      if (attr(ind, 'firstLine') !== null) o.first = num(attr(ind, 'firstLine')) / 20;
      if (attr(ind, 'hanging') !== null) o.hanging = num(attr(ind, 'hanging')) / 20;
    }
    const np = kid(pPr, 'numPr');
    if (np) { o.numId = attr(kid(np, 'numId'), 'val') ?? undefined; o.ilvl = num(attr(kid(np, 'ilvl'), 'val')); }
    const bd = kid(pPr, 'pBdr'); if (bd) { o.bdrB = border(kid(bd, 'bottom')); o.bdrT = border(kid(bd, 'top')); }
    const shd = kid(pPr, 'shd'); if (shd && attr(shd, 'fill') && !/auto|FFFFFF/i.test(attr(shd, 'fill')!)) o.shd = '#' + attr(shd, 'fill');
    const tabs = kid(pPr, 'tabs'); if (tabs) o.tabsRight = kids(tabs, 'tab').some(t => attr(t, 'val') === 'right' || attr(t, 'val') === 'end');
    if (kid(pPr, 'keepNext')) o.keepNext = true;
    return o;
  };

  // 样式（含 basedOn 继承）
  const styleEls = new Map<string, Element>();
  let defPara = '';
  for (const s of styles.getElementsByTagNameNS(W, 'style')) {
    const id = attr(s, 'styleId') ?? '';
    styleEls.set(id, s);
    if (attr(s, 'type') === 'paragraph' && attr(s, 'default') === '1') defPara = id;
  }
  const dd = styles.getElementsByTagNameNS(W, 'docDefaults')[0];
  const baseR: RPr = { sz: 10, ...readR(kid(kid(dd, 'rPrDefault'), 'rPr')) }; // Word 未指定字号时默认 10pt
  const baseP: PPr = readP(kid(kid(dd, 'pPrDefault'), 'pPr'));
  const styleCache = new Map<string, { r: RPr; p: PPr }>();
  const styleOf = (id: string | undefined, depth = 0): { r: RPr; p: PPr } => {
    if (!id || depth > 10) return { r: {}, p: {} };
    const c = styleCache.get(id); if (c) return c;
    const el = styleEls.get(id);
    if (!el) return { r: {}, p: {} };
    const parent = styleOf(attr(kid(el, 'basedOn'), 'val') ?? undefined, depth + 1);
    const res = { r: { ...parent.r, ...readR(kid(el, 'rPr')) }, p: { ...parent.p, ...readP(kid(el, 'pPr')) } };
    styleCache.set(id, res);
    return res;
  };

  // 编号
  const absOf = new Map<string, string>();
  for (const n of numbering.getElementsByTagNameNS(W, 'num')) absOf.set(attr(n, 'numId') ?? '', attr(kid(n, 'abstractNumId'), 'val') ?? '');
  const lvlOf = (numId: string, ilvl: number) => {
    const abs = [...numbering.getElementsByTagNameNS(W, 'abstractNum')].find(a => attr(a, 'abstractNumId') === absOf.get(numId));
    const lvl = kids(abs, 'lvl').find(l => num(attr(l, 'ilvl')) === ilvl);
    if (!lvl) return null;
    return { fmt: attr(kid(lvl, 'numFmt'), 'val') ?? 'bullet', text: attr(kid(lvl, 'lvlText'), 'val') ?? '', start: num(attr(kid(lvl, 'start'), 'val'), 1), p: readP(kid(lvl, 'pPr')), r: readR(kid(lvl, 'rPr')) };
  };
  const counters = new Map<string, number[]>();

  const fontCss = (r: RPr) => {
    const fam = [r.latin, r.ea].filter(Boolean).map(f => `"${f}"`).join(',');
    return fam ? `font-family:${fam},sans-serif` : '';
  };
  const runCss = (r: RPr, base: RPr) => {
    const c: string[] = [];
    if (r.sz && r.sz !== base.sz) c.push(`font-size:${r.sz}pt`);
    if (r.b !== base.b) c.push(`font-weight:${r.b ? 700 : 400}`);
    if (r.i) c.push('font-style:italic');
    if (r.color && r.color !== base.color) c.push(`color:${r.color}`);
    if ((r.latin !== base.latin || r.ea !== base.ea) && (r.latin || r.ea)) c.push(fontCss(r));
    if (r.u || r.strike) c.push(`text-decoration:${[r.u ? 'underline' : '', r.strike ? 'line-through' : ''].join(' ').trim()}`);
    if (r.caps) c.push('text-transform:uppercase');
    if (r.smallCaps) c.push('font-variant:small-caps');
    if (r.bg) c.push(`background:${r.bg}`);
    if (r.va === 'superscript') c.push('vertical-align:super;font-size:.7em');
    if (r.va === 'subscript') c.push('vertical-align:sub;font-size:.7em');
    return c.join(';');
  };

  const imgOf = (d: Element) => {
    const blip = d.getElementsByTagName('a:blip')[0];
    const rid = blip?.getAttributeNS(R, 'embed') ?? blip?.getAttribute('r:embed');
    const target = rid ? rels.get(rid) : null;
    const data = target ? files.get('word/' + target.replace(/^\.?\//, '').replace(/^word\//, '')) : null;
    if (!data) return '';
    const ext = (target!.split('.').pop() ?? 'png').toLowerCase();
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/png';
    if (!/png|jpe?g|gif|svg/.test(ext)) return '';
    let s = ''; for (let i = 0; i < data.length; i += 0x8000) s += String.fromCharCode(...data.subarray(i, i + 0x8000));
    const ext2 = d.getElementsByTagName('wp:extent')[0];
    const w = num(ext2?.getAttribute('cx') ?? null) / 12700, h = num(ext2?.getAttribute('cy') ?? null) / 12700;
    const src = `data:${mime};base64,${btoa(s)}`;
    const anchor = d.getElementsByTagName('wp:anchor')[0];
    if (anchor) {
      // 浮动图片（常见于右上角的照片）：按相对页边距 / 页面的位置绝对定位
      const pos = (tag: string) => { const p = anchor.getElementsByTagName(tag)[0]; return { rel: p?.getAttribute('relativeFrom') ?? '', off: num(p?.getElementsByTagName('wp:posOffset')[0]?.textContent ?? null) / 12700, align: p?.getElementsByTagName('wp:align')[0]?.textContent ?? '' }; };
      const H = pos('wp:positionH'), V = pos('wp:positionV');
      const left = H.align === 'right' ? `right:${H.rel === 'page' ? 0 : marginR}pt` : `left:${(H.rel === 'page' ? 0 : marginL) + H.off}pt`;
      const top = V.rel === 'page' ? `top:${V.off}pt` : V.rel === 'margin' ? `top:${marginT + V.off}pt` : `top:calc(var(--pt, 0pt) + ${V.off}pt)`;
      return `<img src="${src}" style="position:absolute;${left};${V.rel === 'paragraph' || V.rel === 'line' ? `margin-top:${V.off}pt` : top};width:${w}pt;height:${h}pt" alt="">`;
    }
    return `<img src="${src}" style="width:${w}pt;height:${h}pt;vertical-align:middle" alt="">`;
  };

  const runsHtml = (p: Element, base: RPr, pr: RPr, tabsRight: boolean) => {
    let left = '', right = '', afterTab = false;
    const emit = (h: string) => { if (afterTab && tabsRight) right += h; else left += h; };
    const walk = (el: Element, link?: string) => {
      for (const c of el.children) {
        if (c.localName === 'r') {
          const r: RPr = { ...pr, ...styleOf(attr(kid(kid(c, 'rPr'), 'rStyle'), 'val') ?? undefined).r, ...readR(kid(c, 'rPr')) };
          const css = runCss(r, base);
          for (const t of c.children) {
            if (t.localName === 't') { const s = esc(t.textContent ?? ''); emit(css || link ? `<${link ? `a href="${esc(link)}"` : 'span'}${css ? ` style="${css}"` : ''}>${s}</${link ? 'a' : 'span'}>` : s); }
            else if (t.localName === 'tab') { if (tabsRight) { afterTab = true; right = ''; } else emit('&emsp;'); }
            else if (t.localName === 'br') emit('<br>');
            else if (t.localName === 'drawing') emit(imgOf(t));
            else if (t.localName === 'sym') emit(SYMBOL_BULLETS[String.fromCharCode(parseInt(attr(t, 'char') ?? '0', 16))] ?? '');
          }
        } else if (c.localName === 'hyperlink') {
          const rid = c.getAttributeNS(R, 'id') ?? c.getAttribute('r:id');
          walk(c, rid ? rels.get(rid) : undefined);
        } else if (['smartTag', 'ins', 'customXml', 'sdt', 'sdtContent', 'fldSimple'].includes(c.localName)) walk(c, link);
      }
    };
    walk(p);
    return { left, right: afterTab ? right : '' };
  };

  // 页面
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  const sect = kid(body, 'sectPr') ?? body?.getElementsByTagNameNS(W, 'sectPr')[0] ?? null;
  const pg = kid(sect, 'pgSz'), mar = kid(sect, 'pgMar');
  const pageW = num(attr(pg, 'w'), 11906) / 20, pageH = num(attr(pg, 'h'), 16838) / 20;
  const marginT = num(attr(mar, 'top'), 1440) / 20, marginB = num(attr(mar, 'bottom'), 1440) / 20;
  const marginL = num(attr(mar, 'left'), 1800) / 20, marginR = num(attr(mar, 'right'), 1800) / 20;

  const normal = { r: { ...baseR, ...styleOf(defPara).r }, p: { ...baseP, ...styleOf(defPara).p } };
  // Word 的“单倍行距”约为字号的 1.17 倍
  const lineCss = (p: PPr) => {
    if (p.line === undefined) return 'line-height:1.17';
    if (p.lineRule === 'exact') return `line-height:${p.line / 20}pt`;
    if (p.lineRule === 'atLeast') return `line-height:max(1.17em, ${p.line / 20}pt)`;
    return `line-height:${+(p.line / 240 * 1.17).toFixed(3)}`;
  };

  const paraHtml = (p: Element): string => {
    const own = readP(kid(p, 'pPr'));
    const st = styleOf(own.style ?? defPara);
    let pp: PPr = { ...baseP, ...st.p, ...own };
    const pr: RPr = { ...baseR, ...st.r, ...readR(kid(kid(p, 'pPr'), 'rPr')) };
    // 编号
    let marker = '';
    const numId = pp.numId;
    if (numId && numId !== '0') {
      const lv = lvlOf(numId, pp.ilvl ?? 0);
      if (lv) {
        pp = { ...pp, ...lv.p, ...own };
        if (lv.fmt === 'bullet') marker = SYMBOL_BULLETS[lv.text] ?? (lv.text.trim() ? lv.text : '•');
        else if (lv.fmt !== 'none') {
          const cs = counters.get(numId) ?? [];
          const lvl = pp.ilvl ?? 0;
          cs[lvl] = (cs[lvl] ?? lv.start - 1) + 1; cs.length = lvl + 1;
          counters.set(numId, cs);
          const n = cs[lvl];
          const fmt = lv.fmt === 'lowerLetter' ? String.fromCharCode(96 + n) : lv.fmt === 'upperLetter' ? String.fromCharCode(64 + n) : lv.fmt === 'chineseCounting' || lv.fmt === 'ideographTraditional' ? '一二三四五六七八九十'[n - 1] ?? String(n) : String(n);
          marker = lv.text.replace(/%\d/, fmt);
        }
      }
    }
    const { left, right } = runsHtml(p, normal.r, pr, !!pp.tabsRight);
    const has = left.replace(/<[^>]+>/g, '').trim() || /<img/.test(left);
    const css: string[] = [];
    if (pr.sz && pr.sz !== normal.r.sz) css.push(`font-size:${pr.sz}pt`);
    if (pr.b !== normal.r.b) css.push(`font-weight:${pr.b ? 700 : 400}`);
    if (pr.color && pr.color !== normal.r.color) css.push(`color:${pr.color}`);
    if ((pr.latin !== normal.r.latin || pr.ea !== normal.r.ea) && (pr.latin || pr.ea)) css.push(fontCss(pr));
    if (pp.jc === 'center') css.push('text-align:center'); else if (pp.jc === 'right' || pp.jc === 'end') css.push('text-align:right'); else if (pp.jc === 'both') css.push('text-align:justify');
    css.push(`padding-top:${pp.before ?? 0}pt`, `padding-bottom:${pp.after ?? 0}pt`, lineCss(pp));
    const indL = (pp.left ?? 0), hang = pp.hanging ?? 0, first = pp.first ?? 0;
    if (indL || pp.right) css.push(`padding-left:${indL}pt`, `padding-right:${pp.right ?? 0}pt`);
    if (hang) css.push(`text-indent:-${hang}pt`); else if (first) css.push(`text-indent:${first}pt`);
    if (pp.bdrB) css.push(`border-bottom:${pp.bdrB}`);
    if (pp.bdrT) css.push(`border-top:${pp.bdrT}`);
    if (pp.shd) css.push(`background:${pp.shd}`);
    css.push('margin:0', 'position:relative');
    const mk = marker ? `<span style="display:inline-block;min-width:${Math.max(hang, 10)}pt;text-indent:0">${esc(marker)}</span>` : '';
    const rt = right ? `<span style="float:right;text-indent:0">${right}</span>` : '';
    if (!has && !right && !mk) return `<p style="${css.join(';')};min-height:1em">&nbsp;</p>`;
    return `<p style="${css.join(';')}">${rt}${mk}${left}</p>`;
  };

  const tableHtml = (t: Element): string => {
    const tblPr = kid(t, 'tblPr');
    const tb = kid(tblPr, 'tblBorders');
    const bd = (n: string) => border(kid(tb, n));
    const cols = kids(kid(t, 'tblGrid'), 'gridCol').map(g => num(attr(g, 'w')) / 20);
    const rows = kids(t, 'tr');
    // 纵向合并：restart 的格子往下数 continue 的行数
    const grid = rows.map(tr => { let c = 0; return kids(tr, 'tc').map(tc => { const pr = kid(tc, 'tcPr'); const span = num(attr(kid(pr, 'gridSpan'), 'val'), 1); const vm = kid(pr, 'vMerge'); const o = { tc, c, span, vm: vm ? (attr(vm, 'val') ?? 'continue') : '' }; c += span; return o; }); });
    const out: string[] = [`<table style="border-collapse:collapse;table-layout:fixed;width:${cols.reduce((a, b) => a + b, 0)}pt;margin:0">`, '<colgroup>', ...cols.map(w => `<col style="width:${w}pt">`), '</colgroup>'];
    grid.forEach((row, ri) => {
      const trPr = kid(rows[ri], 'trPr');
      const h = kid(trPr, 'trHeight');
      out.push(`<tr${h ? ` style="height:${num(attr(h, 'val')) / 20}pt"` : ''}>`);
      for (const cell of row) {
        if (cell.vm === 'continue') continue;
        let rs = 1;
        if (cell.vm === 'restart') for (let k = ri + 1; k < grid.length; k++) { const below = grid[k].find(x => x.c === cell.c); if (below?.vm === 'continue') rs++; else break; }
        const pr = kid(cell.tc, 'tcPr');
        const cb = kid(pr, 'tcBorders');
        const side = (n: string, outer: string, inner: string, edge: boolean) => border(kid(cb, n)) ?? (edge ? bd(outer) : bd(inner));
        const last = cell.c + cell.span >= cols.length, lastRow = ri + rs >= grid.length;
        const css = [
          `border-top:${side('top', 'top', 'insideH', ri === 0) ?? 'none'}`, `border-bottom:${side('bottom', 'bottom', 'insideH', lastRow) ?? 'none'}`,
          `border-left:${side('left', 'left', 'insideV', cell.c === 0) ?? side('start', 'start', 'insideV', cell.c === 0) ?? 'none'}`,
          `border-right:${side('right', 'right', 'insideV', last) ?? side('end', 'end', 'insideV', last) ?? 'none'}`,
          'padding:1pt 5.4pt', 'vertical-align:' + ({ center: 'middle', bottom: 'bottom' }[attr(kid(pr, 'vAlign'), 'val') ?? ''] ?? 'top'),
        ];
        const shd = kid(pr, 'shd'); if (shd && attr(shd, 'fill') && !/auto|FFFFFF/i.test(attr(shd, 'fill')!)) css.push(`background:#${attr(shd, 'fill')}`);
        out.push(`<td${cell.span > 1 ? ` colspan="${cell.span}"` : ''}${rs > 1 ? ` rowspan="${rs}"` : ''} style="${css.join(';')}">${blocks(cell.tc)}</td>`);
      }
      out.push('</tr>');
    });
    out.push('</table>');
    return out.join('');
  };

  const blocks = (el: Element): string =>
    [...el.children].map(c => (c.localName === 'p' ? paraHtml(c) : c.localName === 'tbl' ? tableHtml(c) : c.localName === 'sdt' ? blocks(kid(c, 'sdtContent')!) : '')).join('');

  const html = blocks(body);
  const n = normal.r;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0}
main{position:relative;box-sizing:border-box;width:${pageW}pt;min-height:${pageH}pt;padding:${marginT}pt ${marginR}pt ${marginB}pt ${marginL}pt;
font-size:${n.sz ?? 10}pt;${fontCss(n) || 'font-family:"Times New Roman","SimSun",serif'};color:${n.color ?? '#000'};font-weight:${n.b ? 700 : 400}}
p{margin:0}td p{margin:0}
</style></head><body><main data-pgw="${pageW}" data-pgh="${pageH}">${html}</main></body></html>`;
}
