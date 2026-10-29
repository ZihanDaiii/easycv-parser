// SPDX-License-Identifier: AGPL-3.0-only
import * as pdfjs from 'pdfjs-dist';
import type { VRule, Extracted, Fill, ImgBox, Marker, Rule, Run } from './types';
import { dist, type RGB } from './color';
import { normText } from './text';

/** pdf.js 的资源位置：worker 脚本、CJK 字符映射表、标准字体。由调用方按自己的打包方式设置（见 configurePdfjs） */
export const pdfAssets = { cMapUrl: '/pdfjs/cmaps/', standardFontDataUrl: '/pdfjs/standard_fonts/' };
export function configurePdfjs(o: { workerSrc?: string; cMapUrl?: string; standardFontDataUrl?: string }) {
  if (o.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = o.workerSrc;
  if (o.cMapUrl) pdfAssets.cMapUrl = o.cMapUrl;
  if (o.standardFontDataUrl) pdfAssets.standardFontDataUrl = o.standardFontDataUrl;
}

const MAX_PAGES = 10;
const BOLD_RE = /bold|black|heavy|semibold|demibold|demi\b|W[6-9]\b|-B$|,B\b|Medium$/i;
const ITALIC_RE = /italic|oblique|-It$|-I$/i;
const MONO_RE = /courier|mono|consol|menlo|code|inconsolata/i;

/** 字体名清理：去掉子集前缀“ABCDEF+”和字重后缀，得到字体族名 */
export function familyOf(name: string) {
  return name.replace(/^[A-Z]{6}\+/, '').replace(/[-,](Regular|Bold|BoldMT|Semibold|SemiBold|Medium|Light|Black|Heavy|Italic|BoldItalic|Oblique|PSMT|MT|Roman|Book|Thin|ExtraBold|ExtraLight|Demi|DemiBold|Ultra|W\d)+$/i, '')
    .replace(/(PSMT|MT|PS)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
}

interface Glyph { str: string; x: number; xEnd: number; base: number; size: number; font: string; bold: boolean; italic: boolean; mono: boolean }

/** 读取 PDF：文字片段（含字体、字号、粗斜体），并渲染每一页，从像素里还原颜色、色块、横线、图形符号和图片 */
export async function extractPdf(data: ArrayBuffer): Promise<Extracted> {
  const doc = await pdfjs.getDocument({
    data, cMapUrl: pdfAssets.cMapUrl, cMapPacked: true, standardFontDataUrl: pdfAssets.standardFontDataUrl, fontExtraProperties: true,
  }).promise;
  const meta = await doc.getMetadata().catch(() => null);
  const keywords = String((meta?.info as Record<string, unknown> | undefined)?.Keywords ?? '').trim();

  const out: Extracted = { kind: 'pdf', pages: [], runs: [], images: [], fills: [], rules: [], markers: [] };
  const n = Math.min(doc.numPages, MAX_PAGES);
  for (let p = 0; p < n; p++) {
    const page = await doc.getPage(p + 1);
    const vp = page.getViewport({ scale: 1 });
    out.pages.push({ w: vp.width, h: vp.height });
    const ops = await page.getOperatorList();
    const tc = await page.getTextContent();
    const annots = await page.getAnnotations().catch(() => []) as { subtype?: string; url?: string; rect?: number[] }[];

    // ---------- 文字 ----------
    const glyphs: Glyph[] = [];
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const t = pdfjs.Util.transform(vp.transform, it.transform);
      const size = Math.hypot(t[2], t[3]);
      if (!size || Math.abs(t[1]) > size * 0.05) continue; // 旋转的文字（水印、竖排）不参与
      if (keywords.length >= 8 && it.str.trim().length >= 6 && keywords.includes(it.str.trim())) continue; // 平台水印：与元数据关键词一致的文字
      let name = '';
      let fb = false, fi = false;
      try { const f = page.commonObjs.get(it.fontName) as { name?: string; bold?: boolean; italic?: boolean; black?: boolean }; name = f?.name ?? ''; fb = !!(f?.bold || f?.black); fi = !!f?.italic; } catch { /* 字体还没加载 */ }
      if (!name) name = tc.styles[it.fontName]?.fontFamily ?? '';
      const w = it.width * (vp.width / page.view[2] || 1);
      glyphs.push({
        str: normText(it.str), x: t[4], xEnd: t[4] + w, base: t[5], size,
        font: familyOf(name), bold: fb || BOLD_RE.test(name), italic: fi || ITALIC_RE.test(name), mono: MONO_RE.test(name),
      });
    }
    const runs = mergeGlyphs(glyphs, p);

    // 链接
    for (const a of annots) {
      if (a.subtype !== 'Link' || !a.url || !a.rect) continue;
      const [x1, y1, x2, y2] = a.rect;
      const top = vp.height - y2, bottom = vp.height - y1;
      for (const r of runs) if (r.x >= x1 - 2 && r.xEnd <= x2 + 2 && (r.top + r.bottom) / 2 >= top - 1 && (r.top + r.bottom) / 2 <= bottom + 1) r.href = a.url;
    }

    // ---------- 图片位置：沿操作符序列跟踪变换矩阵 ----------
    const OPS = pdfjs.OPS;
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    const imgRects: { x: number; top: number; w: number; h: number }[] = [];
    ops.fnArray.forEach((fn, i) => {
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = pdfjs.Util.transform(ctm, ops.argsArray[i] as number[]);
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat || fn === OPS.paintImageMaskXObject) {
        const m = pdfjs.Util.transform(vp.transform, ctm);
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => [m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]]);
        const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
        const r = { x: Math.min(...xs), top: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
        if (r.w > 2 && r.h > 2 && r.w * r.h < vp.width * vp.height * 0.6) imgRects.push(r);
      }
    });

    // ---------- 渲染并分析像素 ----------
    const S = Math.max(2, Math.min(3.4, 2000 / vp.width));
    const canvas = document.createElement('canvas');
    const rv = page.getViewport({ scale: S });
    canvas.width = Math.ceil(rv.width); canvas.height = Math.ceil(rv.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: rv }).promise;
    const a = analyze(canvas, S, p, vp.width, vp.height, runs, imgRects);
    out.runs.push(...runs);
    out.images.push(...a.images);
    out.fills.push(...a.fills);
    out.rules.push(...a.rules);
    (out.vrules ??= []).push(...a.vrules);
    out.markers.push(...a.markers);
    page.cleanup();
  }
  return out;
}

/** 同一行、同字体、紧挨着的字形合并成一段文字 */
function mergeGlyphs(gs: Glyph[], page: number): Run[] {
  const runs: Run[] = [];
  let cur: (Run & { base: number }) | null = null;
  const latinEnd = (s: string) => /[A-Za-z0-9.,;:)\]%+'"’”]$/.test(s);
  const latinStart = (s: string) => /^[A-Za-z0-9(\[@#'"‘“]/.test(s);
  for (const g of gs) {
    const blank = !g.str.trim();
    if (cur) {
      const sameLine = Math.abs(g.base - cur.base) < cur.size * 0.18 && Math.abs(g.size - cur.size) < 0.06;
      const gap = g.x - cur.xEnd;
      // 等宽字体（代码）的空格宽 0.6em，词间距比正文大
      const same = sameLine && g.font === cur.font && g.bold === cur.bold && g.italic === cur.italic && gap > -cur.size * 0.3 && gap < cur.size * (g.mono && cur.mono ? 0.75 : 0.42);
      if (same) {
        // 空格不延长文字的右端（否则后面的大间距、右对齐的时间会被吞掉）；很宽的空白（对齐用）直接断开
        if (blank) { if (g.xEnd - g.x > cur.size * 0.9) { cur = null; continue; } if (!cur.text.endsWith(' ')) cur.text += ' '; continue; }
        if (gap > cur.size * 0.2 && !cur.text.endsWith(' ') && latinEnd(cur.text) && latinStart(g.str)) cur.text += ' ';
        cur.text += g.str; cur.xEnd = g.xEnd;
        continue;
      }
      if (blank && sameLine) { if (!cur.text.endsWith(' ')) cur.text += ' '; continue; }
    }
    if (blank) continue;
    cur = { text: g.str, page, x: g.x, xEnd: g.xEnd, top: g.base - g.size * 0.88, bottom: g.base + g.size * 0.14, size: g.size, bold: g.bold, italic: g.italic, mono: g.mono, font: g.font, color: [0, 0, 0], base: g.base };
    runs.push(cur);
  }
  for (const r of runs) { r.text = r.text.replace(/\s+$/, ''); delete (r as { base?: number }).base; }
  return runs.filter(r => r.text);
}

/**
 * 像素分析（1pt 一格）：
 * - 每段文字：取字形像素的颜色作为文字颜色，取框内主色作为底色
 * - 色块：颜色一致的非白色连通区域（文字所在格子不打断区域）
 * - 其余不属于文字和图片的笔画：横线 → 下划线/分隔线；行首的小圆点 → 列表符号；其他 → 矢量图标，裁成图片
 */
function analyze(canvas: HTMLCanvasElement, S: number, page: number, W: number, H: number, runs: Run[], imgRects: { x: number; top: number; w: number; h: number }[]) {
  const ctx = canvas.getContext('2d')!;
  const CW = canvas.width, CH = canvas.height;
  const px = ctx.getImageData(0, 0, CW, CH).data;
  const at = (x: number, y: number): RGB => { const i = (Math.min(CH - 1, Math.max(0, y)) * CW + Math.min(CW - 1, Math.max(0, x))) * 4; return [px[i], px[i + 1], px[i + 2]]; };

  // 文字颜色与底色：底色取字框上下边缘外侧的像素，文字色取离底色最远的那批像素
  for (const r of runs) {
    const x0 = Math.floor(r.x * S), x1 = Math.ceil(r.xEnd * S);
    const y0 = Math.floor((r.top + r.size * 0.05) * S), y1 = Math.ceil((r.bottom - r.size * 0.05) * S);
    const edge: RGB[] = [];
    const stepX = Math.max(1, Math.floor((x1 - x0) / 60));
    for (let x = x0; x < x1; x += stepX) { edge.push(at(x, Math.floor((r.top - r.size * 0.02) * S))); edge.push(at(x, Math.ceil((r.bottom + r.size * 0.04) * S))); }
    const counts = new Map<number, { n: number; c: RGB }>();
    for (const c of edge) { const k = ((c[0] >> 4) << 8) | ((c[1] >> 4) << 4) | (c[2] >> 4); const e = counts.get(k); if (e) e.n++; else counts.set(k, { n: 1, c }); }
    const bg = [...counts.values()].sort((a, b) => b.n - a.n)[0]?.c ?? [255, 255, 255];
    const step = Math.max(1, Math.floor((x1 - x0) * (y1 - y0) / 6000));
    const far: { c: RGB; d: number }[] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x += step) { const c = at(x, y); const d = dist(c, bg); if (d > 60) far.push({ c, d }); }
    far.sort((a, b) => b.d - a.d);
    const top = far.slice(0, Math.max(1, Math.floor(far.length * 0.35)));
    r.color = top.length ? [0, 1, 2].map(i => Math.round(top.reduce((s, o) => s + o.c[i], 0) / top.length)) as RGB : [20, 20, 20];
    if (bg[0] < 246 || bg[1] < 246 || bg[2] < 246) r.bg = bg.map(Math.round) as RGB;
    // 下划线：基线下方有一整行几乎连续的笔画（紧贴文字，落在文字框里，不会被当成横线）
    if (x1 - x0 > Math.max(6, r.size * 1.2) * S) {
      const base = r.bottom - r.size * 0.14;
      // 和这段文字连在一起的同一行文字（不含另一栏里恰好同高的文字）
      const line = runs.filter(q => q.page === r.page && Math.abs(q.bottom - r.bottom) < r.size * 0.3).sort((a, z) => a.x - z.x);
      let L0 = r.x, R0 = r.xEnd;
      for (const q of line) if (q.x >= R0 - 1 && q.x - R0 < r.size * 2) R0 = Math.max(R0, q.xEnd);
      for (const q of [...line].reverse()) if (q.xEnd <= L0 + 1 && L0 - q.xEnd < r.size * 2) L0 = Math.min(L0, q.x);
      const ink = (x: number, y: number) => dist(at(x, y), bg) > 80;
      for (let y = Math.floor((base + r.size * 0.02) * S); y <= Math.ceil((r.bottom + r.size * 0.16) * S); y++) {
        let hit = 0, n = 0;
        for (let x = x0 + 1; x < x1 - 1; x += Math.max(1, Math.floor((x1 - x0) / 120))) { n++; if (ink(x, y)) hit++; }
        if (!n || hit / n <= 0.93) continue;
        // 线的两端不能超出这一行文字（标题下面通栏的分隔线不是下划线）
        let L = x0, R = x1;
        while (L > 0 && (ink(L - 1, y) || ink(L - 2, y))) L--;
        while (R < CW - 1 && (ink(R + 1, y) || ink(R + 2, y))) R++;
        if (L / S >= L0 - 3 && R / S <= R0 + 3) r.underline = true;
        break;
      }
    }
  }

  // 夹在两段下划线文字中间的短符号（→、图标字）：下划线是连续的一条
  for (const r of runs) if (!r.underline) {
    const near = (q: Run) => q.underline && q.page === r.page && Math.abs(q.bottom - r.bottom) < r.size * 0.3;
    if (runs.some(q => near(q) && q.xEnd <= r.x + 1 && r.x - q.xEnd < r.size) && runs.some(q => near(q) && q.x >= r.xEnd - 1 && q.x - r.xEnd < r.size)) r.underline = true;
  }

  // ---------- 格子 ----------
  const GW = Math.ceil(W), GH = Math.ceil(H);
  const uni = new Uint8Array(GW * GH);      // 1 = 颜色均匀
  const col = new Float32Array(GW * GH * 3); // 均值颜色
  const dark = new Float32Array(GW * GH * 3); // 格子里最深的像素
  const light = new Float32Array(GW * GH * 3); // 格子里最浅的像素
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const x0 = Math.floor(gx * S), x1 = Math.max(x0 + 1, Math.floor((gx + 1) * S)), y0 = Math.floor(gy * S), y1 = Math.max(y0 + 1, Math.floor((gy + 1) * S));
    let r = 0, g = 0, b = 0, n = 0, lmin = 999, lmax = -1;
    let dr = 255, dg = 255, db = 255, wr = 0, wg = 0, wb = 0;
    for (let y = y0; y < y1 && y < CH; y++) for (let x = x0; x < x1 && x < CW; x++) {
      const i = (y * CW + x) * 4;
      const l = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
      r += px[i]; g += px[i + 1]; b += px[i + 2]; n++;
      if (l < lmin) { lmin = l; dr = px[i]; dg = px[i + 1]; db = px[i + 2]; }
      if (l > lmax) { lmax = l; wr = px[i]; wg = px[i + 1]; wb = px[i + 2]; }
    }
    const k = gy * GW + gx;
    col[k * 3] = r / n; col[k * 3 + 1] = g / n; col[k * 3 + 2] = b / n;
    dark[k * 3] = dr; dark[k * 3 + 1] = dg; dark[k * 3 + 2] = db;
    light[k * 3] = wr; light[k * 3 + 1] = wg; light[k * 3 + 2] = wb;
    uni[k] = lmax - lmin < 16 ? 1 : 0;
  }
  const cell = (k: number): RGB => [col[k * 3], col[k * 3 + 1], col[k * 3 + 2]];
  const white = (k: number) => col[k * 3] > 250 && col[k * 3 + 1] > 250 && col[k * 3 + 2] > 250;

  // 文字、图片占用的格子
  const textCell = new Uint8Array(GW * GH);
  const mark = (arr: Uint8Array, x0: number, y0: number, x1: number, y1: number, v = 1) => {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(GH, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(GW, Math.ceil(x1)); x++) arr[y * GW + x] = v;
  };
  for (const r of runs) mark(textCell, r.x - r.size * 0.08, r.top - r.size * 0.12, r.xEnd + r.size * 0.08, r.bottom + r.size * 0.1);
  const imgCell = new Uint8Array(GW * GH);
  for (const r of imgRects) mark(imgCell, r.x, r.top, r.x + r.w, r.top + r.h);

  // ---------- 色块 ----------
  const fills: Fill[] = [];
  const rules: Rule[] = [];
  const markers: Marker[] = [];
  const seen = new Uint8Array(GW * GH);
  const fillCell = new Uint8Array(GW * GH);
  const vecShapes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let k0 = 0; k0 < GW * GH; k0++) {
    if (seen[k0] || !uni[k0] || white(k0) || imgCell[k0] || textCell[k0]) continue;
    const seed = cell(k0);
    const tol = Math.max(4, Math.min(22, dist(seed, [255, 255, 255]) * 0.45));
    const q = [k0]; seen[k0] = 1;
    let x0 = GW, y0 = GH, x1 = 0, y1 = 0, n = 0, wild = 0;
    const members: number[] = [];
    while (q.length) {
      const k = q.pop()!;
      const x = k % GW, y = (k - x) / GW;
      const match = uni[k] && !white(k) && dist(cell(k), seed) < tol;
      if (match) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } else wild++;
      members.push(k);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const nk = ny * GW + nx;
        if (seen[nk] || imgCell[nk]) continue;
        const ok = (uni[nk] && !white(nk) && dist(cell(nk), seed) < tol) || (textCell[nk] && !(uni[nk] && white(nk)) && match);
        if (ok) { seen[nk] = 1; q.push(nk); }
      }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (bw <= 9 && bh <= 9 && n >= 1) {
      const cy = y0 + bh / 2;
      const next = runs.find(r => r.x >= x1 + 0.5 && r.x - x1 < r.size * 2.2 && cy >= r.top && cy <= r.bottom && bw <= r.size * 0.55);
      const shape = next && (markerShape(at, S, { x0, y0, x1: x1 + 1, y1: y1 + 1 }) ?? (Math.max(bw, bh) <= next.size * 0.4 ? 'disc' : null));
      if (shape) { markers.push({ page, x: x0, top: y0, size: Math.max(bw, bh), shape, color: seed.map(Math.round) as RGB }); continue; }
      vecShapes.push({ x0, y0, x1: x1 + 1, y1: y1 + 1 }); continue;
    }
    if (n < 6) continue;
    const ratio = (n + wild) / (bw * bh);
    members.forEach(k => { fillCell[k] = 1; });
    // 横向细长：按像素量出真实粗细，3pt 以内是线（下划线、分隔线），更粗的是色条（技能条等）
    const thick = bh <= 4 && bw >= 10 ? (() => { const x = Math.round(((x0 + x1 + 1) / 2) * S); let n = 0; for (let y = Math.floor((y0 - 1.5) * S); y < Math.ceil((y1 + 2.5) * S); y++) if (dist(at(x, y), seed) < Math.max(18, tol * 1.5)) n++; return n / S; })() : 99;
    if (thick <= 3.2 && bw / bh > 6) { rules.push({ page, x: x0, xEnd: x1 + 1, y: y0 + bh / 2, t: Math.max(0.5, +thick.toFixed(2)), color: seed.map(Math.round) as RGB }); continue; }
    if (ratio < 0.72) { if (bw < 120 && bh < 120) vecShapes.push({ x0, y0, x1: x1 + 1, y1: y1 + 1 }); continue; }
    fills.push({ page, x: x0, top: y0, w: bw, h: bh, color: seed.map(Math.round) as RGB });
  }
  // 色块边缘的格子不算笔画
  // （只排除最深的像素就是色块本身颜色的格子；色块旁边另一种颜色的竖条、图标照常识别）
  const nearFill = new Uint8Array(GW * GH);
  const darkC = (k: number): RGB => [dark[k * 3], dark[k * 3 + 1], dark[k * 3 + 2]];
  for (let k = 0; k < GW * GH; k++) if (fillCell[k]) {
    const x = k % GW, y = (k - x) / GW;
    const fc = cell(k);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const nk = ny * GW + nx;
      if (nearFill[nk] || dist(darkC(nk), fc) >= 45) continue;
      // 最浅的像素也要能在旁边找到出处（色块本身或旁边的另一块纯色，如白纸）：深色底上的浅色细线不算色块边缘
      const L: RGB = [light[nk * 3], light[nk * 3 + 1], light[nk * 3 + 2]];
      let ok = dist(L, fc) < 45;
      for (let ey = -1; ey <= 1 && !ok; ey++) for (let ex = -1; ex <= 1 && !ok; ex++) {
        const mx = nx + ex, my = ny + ey;
        if (mx < 0 || my < 0 || mx >= GW || my >= GH) continue;
        const m = my * GW + mx;
        if (uni[m] && dist(cell(m), L) < 30) ok = true;
      }
      if (ok) nearFill[nk] = 1;
    }
  }

  // ---------- 笔画：线、符号、矢量图标 ----------
  const lineCell = new Uint8Array(GW * GH);
  const ink = (k: number) => !uni[k] && !textCell[k] && !imgCell[k] && !nearFill[k] && !lineCell[k];

  // 长直线（表格边框、分隔线）：先单独找出来，否则整张表格会连成一个大图形被丢掉
  type Seg = { a: number; b: number; p0: number; p1: number }; // a..b 为线所在的行（列）范围，p0..p1 为长度方向
  const scan = (horiz: boolean, minLen: number) => {
    const N = horiz ? GH : GW, M = horiz ? GW : GH;
    const segs: Seg[] = [];
    for (let i = 0; i < N; i++) {
      let j = 0;
      while (j < M) {
        const k = horiz ? i * GW + j : j * GW + i;
        if (!ink(k)) { j++; continue; }
        const s0 = j;
        while (j < M && ink(horiz ? i * GW + j : j * GW + i)) j++;
        if (j - s0 >= minLen) segs.push({ a: i, b: i, p0: s0, p1: j });
      }
    }
    // 相邻行里重叠的线段合并成一条（粗线、或刚好跨在格子边界上的细线）
    const out: Seg[] = [];
    for (const g of segs) {
      const m = out.find(o => g.a - o.b === 1 && Math.min(o.p1, g.p1) - Math.max(o.p0, g.p0) > Math.min(o.p1 - o.p0, g.p1 - g.p0) * 0.8);
      if (m) { m.b = g.a; m.p0 = Math.min(m.p0, g.p0); m.p1 = Math.max(m.p1, g.p1); } else out.push({ ...g });
    }
    return out.filter(o => o.b - o.a + 1 <= 3);
  };
  const hSegs = scan(true, 40), vSegs = scan(false, 12);
  // 和横线相交的竖线、和竖线相交的横线：表格边框
  const meets = (h: Seg, v: Seg) => v.a >= h.p0 - 2 && v.a <= h.p1 + 2 && h.a >= v.p0 - 2 && h.a <= v.p1 + 2;
  const vrules: VRule[] = [];
  // 线的颜色：线上离周围底色最远的像素（深色底上的线可能比底色更浅）
  const lineColor = (cells: number[], horiz: boolean) => {
    const c: RGB = [0, 0, 0]; let n = 0;
    for (let i = 0; i < cells.length; i += Math.max(1, Math.floor(cells.length / 40))) {
      const k = cells[i], gx = k % GW, gy = (k - gx) / GW;
      const bg = horiz ? at(Math.floor((gx + 0.5) * S), Math.floor((gy - 1.5) * S)) : at(Math.floor((gx - 1.5) * S), Math.floor((gy + 0.5) * S));
      let best: RGB | null = null, bd = -1;
      for (let d = 0; d < Math.ceil(S); d++) { const p = horiz ? at(Math.floor((gx + 0.5) * S), Math.floor(gy * S) + d) : at(Math.floor(gx * S) + d, Math.floor((gy + 0.5) * S)); const dd = dist(p, bg); if (dd > bd) { bd = dd; best = p; } }
      if (best) { c[0] += best[0]; c[1] += best[1]; c[2] += best[2]; n++; }
    }
    return c.map(v => Math.round(v / Math.max(1, n))) as RGB;
  };
  const cellsOf = (o: Seg, horiz: boolean) => { const ks: number[] = []; for (let i = o.a; i <= o.b; i++) for (let j = o.p0; j < o.p1; j++) ks.push(horiz ? i * GW + j : j * GW + i); return ks; };
  for (const h of hSegs) {
    const grid = vSegs.filter(v => meets(h, v)).length >= 2;
    const ks = cellsOf(h, true);
    ks.forEach(k => { lineCell[k] = 1; });
    const c = { x0: h.p0, y0: h.a, x1: h.p1, y1: h.b + 1 };
    rules.push({ page, x: h.p0, xEnd: h.p1, y: (h.a + h.b + 1) / 2, t: lineThickness(at, S, c), color: lineColor(ks, true), ...(grid ? { grid: true } : {}) });
  }
  for (const v of vSegs) {
    if (hSegs.filter(h => meets(h, v)).length < 2) continue; // 不是表格的竖线照旧当竖条（标题左侧竖条、时间轴）
    const ks = cellsOf(v, false);
    ks.forEach(k => { lineCell[k] = 1; });
    vrules.push({ page, x: (v.a + v.b + 1) / 2, y0: v.p0, y1: v.p1, t: Math.max(0.5, Math.min(2, (v.b - v.a + 1) * 0.6)), color: lineColor(ks, false) });
  }
  const comps: { x0: number; y0: number; x1: number; y1: number; n: number; c: RGB }[] = [];
  const seen2 = new Uint8Array(GW * GH);
  for (let k0 = 0; k0 < GW * GH; k0++) {
    if (seen2[k0] || !ink(k0)) continue;
    const q = [k0]; seen2[k0] = 1;
    let x0 = GW, y0 = GH, x1 = 0, y1 = 0, n = 0;
    const cs: RGB = [0, 0, 0];
    while (q.length) {
      const k = q.pop()!;
      const x = k % GW, y = (k - x) / GW;
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      cs[0] += dark[k * 3]; cs[1] += dark[k * 3 + 1]; cs[2] += dark[k * 3 + 2];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        const nk = ny * GW + nx;
        if (!seen2[nk] && ink(nk)) { seen2[nk] = 1; q.push(nk); }
      }
    }
    comps.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, n, c: [cs[0] / n, cs[1] / n, cs[2] / n] });
  }

  const rest: typeof comps = [];
  for (const c of comps) {
    const w = c.x1 - c.x0, h = c.y1 - c.y0;
    if (h <= 2.5 && w >= 10 && w / h > 6) {
      rules.push({ page, x: c.x0, xEnd: c.x1, y: (c.y0 + c.y1) / 2, t: lineThickness(at, S, c), color: c.c.map(Math.round) as RGB });
      continue;
    }
    if (w <= 3.5 && h >= 6) { fills.push({ page, x: c.x0, top: c.y0, w: Math.max(0.8, w - 1), h, color: c.c.map(Math.round) as RGB }); continue; } // 竖线：标题左侧竖条、时间轴
    if (w <= 9 && h <= 9 && w / h > 0.55 && w / h < 1.8) {
      const cy = (c.y0 + c.y1) / 2;
      const next = runs.find(r => r.x >= c.x1 - 0.5 && r.x - c.x1 < r.size * 2.2 && cy >= r.top && cy <= r.bottom && w <= r.size * 0.7);
      const shape = next && markerShape(at, S, c);
      if (shape) { markers.push({ page, x: c.x0, top: c.y0, size: Math.max(w, h), shape, color: c.c.map(Math.round) as RGB }); continue; }
    }
    if (c.n < 3 || (w < 2 && h < 2)) continue;
    rest.push(c);
  }
  // 相邻的笔画合并成一个图标（一个 logo 往往由多个部分组成）
  // 实心深色小方块、里面还有别的图形（深色底的 logo）：是图标，不是底色块；里面的小圆点也不是列表符号
  const logoFills: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let i = fills.length - 1; i >= 0; i--) {
    const f = fills[i];
    if (f.w < 8 || f.h < 8 || f.w > 40 || f.h > 40 || f.w / f.h < 0.6 || f.w / f.h > 1.6) continue;
    if (runs.some(r => r.page === page && (r.x + r.xEnd) / 2 > f.x && (r.x + r.xEnd) / 2 < f.x + f.w && (r.top + r.bottom) / 2 > f.top && (r.top + r.bottom) / 2 < f.top + f.h)) continue;
    const inside = (x: number, y: number) => x >= f.x - 1 && x <= f.x + f.w + 1 && y >= f.top - 1 && y <= f.top + f.h + 1;
    const dots = markers.filter(m => inside(m.x, m.top) && inside(m.x + m.size, m.top + m.size));
    if (!dots.length && !rest.some(c => inside(c.x0, c.y0) && inside(c.x1, c.y1))) continue;
    for (const m of dots) markers.splice(markers.indexOf(m), 1);
    fills.splice(i, 1);
    logoFills.push({ x0: f.x, y0: f.top, x1: f.x + f.w, y1: f.top + f.h });
  }
  const boxes = [...rest.map(c => ({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 })), ...vecShapes, ...logoFills];
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x0 - 1.5 <= b.x1 && b.x0 - 1.5 <= a.x1 && a.y0 - 1.5 <= b.y1 && b.y0 - 1.5 <= a.y1) {
        boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
        boxes.splice(j, 1); merged = true; break;
      }
    }
  }
  const images: ImgBox[] = [];
  const crop = (x: number, y: number, w: number, h: number, type = 'image/png') => {
    const c2 = document.createElement('canvas');
    c2.width = Math.max(1, Math.round(w * S)); c2.height = Math.max(1, Math.round(h * S));
    c2.getContext('2d')!.drawImage(canvas, x * S, y * S, w * S, h * S, 0, 0, c2.width, c2.height);
    return c2.toDataURL(type, 0.92);
  };
  for (const b of boxes) {
    const w = b.x1 - b.x0, h = b.y1 - b.y0;
    if (w < 3 || h < 3 || w > W * 0.8) continue;
    // 包着文字的圆角底色（行内代码、标签）：是文字的底色，不是图标。裁成图片会把文字画两遍
    const inside = runs.filter(r => (r.x + r.xEnd) / 2 > b.x0 && (r.x + r.xEnd) / 2 < b.x1 && (r.top + r.bottom) / 2 > b.y0 && (r.top + r.bottom) / 2 < b.y1);
    if (inside.length && h <= Math.max(...inside.map(r => r.size)) * 2.2 && inside.reduce((a, r) => a + (r.xEnd - r.x), 0) > w * 0.5) {
      const tally = new Map<string, { n: number; c: RGB }>();
      for (let y = Math.floor(b.y0); y < Math.ceil(b.y1); y++) for (let x = Math.floor(b.x0); x < Math.ceil(b.x1); x++) {
        const k = y * GW + x; if (k < 0 || k >= GW * GH) continue;
        const c: RGB = [light[k * 3], light[k * 3 + 1], light[k * 3 + 2]];
        if (c[0] > 250 && c[1] > 250 && c[2] > 250) continue;
        const key = c.map(v => v >> 3).join(); const e = tally.get(key); if (e) e.n++; else tally.set(key, { n: 1, c });
      }
      const bg = [...tally.values()].sort((a, z) => z.n - a.n)[0]?.c;
      if (bg) for (const r of inside) r.bg = bg.map(Math.round) as RGB;
      continue;
    }
    images.push({ page, x: b.x0 - 1, top: b.y0 - 1, w: w + 2, h: h + 2, src: crop(b.x0 - 1, b.y0 - 1, w + 2, h + 2), raster: false });
  }
  // 不在文字上的小色块（技能条、进度条、装饰短条）：裁成图片放进文字流，可以替换、缩放、删除
  // 高度不到 2pt 的浅色细条是色块边缘的阴影 / 描边，不是内容
  const bars = fills.filter(f => f.h <= 8 && !(f.h < 2 && f.color[0] + f.color[1] + f.color[2] > 600) && f.w >= 10 && f.w <= W * 0.45 && !runs.some(r => r.x < f.x + f.w + 1 && r.xEnd > f.x - 1 && r.top < f.top + f.h + 1 && r.bottom > f.top - 1));
  const groupsB: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const f of bars) {
    const g = groupsB.find(b => f.x <= b.x1 + 1.5 && f.x + f.w >= b.x0 - 1.5 && f.top <= b.y1 + 1 && f.top + f.h >= b.y0 - 1);
    if (g) { g.x0 = Math.min(g.x0, f.x); g.y0 = Math.min(g.y0, f.top); g.x1 = Math.max(g.x1, f.x + f.w); g.y1 = Math.max(g.y1, f.top + f.h); }
    else groupsB.push({ x0: f.x, y0: f.top, x1: f.x + f.w, y1: f.top + f.h });
  }
  // 色条末端很短的一截（进度条的灰色底槽）会被当成小图形：并回色条
  for (const b of groupsB) for (let i = images.length - 1; i >= 0; i--) {
    const im = images[i];
    if (im.raster || im.h > 8 || im.x > b.x1 + 1.5 || im.x + im.w < b.x0 - 1.5 || im.top > b.y1 + 1.5 || im.top + im.h < b.y0 - 1.5) continue;
    b.x0 = Math.min(b.x0, im.x + 1); b.x1 = Math.max(b.x1, im.x + im.w - 1); images.splice(i, 1);
  }
  // 贴着小图标的短色块是图标自己的一部分（如名片图标的底座）：并进图标，合起来仍是图标大小
  for (let gi = groupsB.length - 1; gi >= 0; gi--) {
    const b = groupsB[gi];
    const im = images.find(im => !im.raster && !im.flow && im.x <= b.x1 + 1.5 && im.x + im.w >= b.x0 - 1.5 && im.top <= b.y1 + 1.5 && im.top + im.h >= b.y0 - 1.5
      && Math.max(im.x + im.w, b.x1 + 1) - Math.min(im.x, b.x0 - 1) <= 24 && Math.max(im.top + im.h, b.y1 + 1) - Math.min(im.top, b.y0 - 1) <= 24);
    if (!im) continue;
    const x0 = Math.min(im.x, b.x0 - 1), y0 = Math.min(im.top, b.y0 - 1), x1 = Math.max(im.x + im.w, b.x1 + 1), y1 = Math.max(im.top + im.h, b.y1 + 1);
    Object.assign(im, { x: x0, top: y0, w: x1 - x0, h: y1 - y0, src: crop(x0, y0, x1 - x0, y1 - y0) });
    groupsB.splice(gi, 1);
  }
  for (const b of groupsB) images.push({ page, x: b.x0, top: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0, src: crop(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0), raster: false, flow: true });
  for (const r of imgRects) {
    const big = r.w * r.h > 1600;
    images.push({ page, ...r, src: crop(r.x, r.top, r.w, r.h, big ? 'image/jpeg' : 'image/png'), raster: true });
  }
  // 同一条线被拆成上下相邻的两条（粗线跨过格子边界）：合并，颜色取更醒目的那条
  rules.sort((a, b) => a.y - b.y);
  const ruleOut: Rule[] = [];
  for (const r of rules) {
    const m = ruleOut.find(o => Math.abs(o.y - r.y) <= 2 && Math.min(o.xEnd, r.xEnd) - Math.max(o.x, r.x) > Math.min(o.xEnd - o.x, r.xEnd - r.x) * 0.8);
    if (!m) { ruleOut.push({ ...r }); continue; }
    const top = Math.min(m.y - m.t / 2, r.y - r.t / 2), bot = Math.max(m.y + m.t / 2, r.y + r.t / 2);
    if (dist(r.color, [255, 255, 255]) > dist(m.color, [255, 255, 255])) m.color = r.color;
    m.x = Math.min(m.x, r.x); m.xEnd = Math.max(m.xEnd, r.xEnd); m.y = (top + bot) / 2; m.t = +Math.min(bot - top, Math.max(m.t, r.t)).toFixed(2);
    if (r.grid) m.grid = true;
  }
  return { fills: fills.filter(f => f.w >= 3 && f.h >= 3), rules: ruleOut.filter(r => !(r.color[0] > 248 && r.color[1] > 248 && r.color[2] > 248)), markers, images, vrules };
}

function lineThickness(at: (x: number, y: number) => RGB, S: number, c: { x0: number; y0: number; x1: number; y1: number }) {
  // 和线上方的底色比：深色底上的浅色线也能量准
  const ns: number[] = [];
  for (const f of [0.3, 0.5, 0.7]) {
    const x = Math.round((c.x0 + (c.x1 - c.x0) * f) * S);
    const bg = at(x, Math.floor((c.y0 - 1.5) * S));
    let n = 0;
    for (let y = Math.floor((c.y0 - 0.5) * S); y < Math.ceil((c.y1 + 0.5) * S); y++) if (dist(at(x, y), bg) > 40) n++;
    ns.push(n);
  }
  ns.sort((a, b) => a - b);
  return Math.max(0.4, +(ns[1] / S).toFixed(2));
}

/** 圆点 / 空心圆 / 方块；形状不规则的（小图标）返回 null */
function markerShape(at: (x: number, y: number) => RGB, S: number, c: { x0: number; y0: number; x1: number; y1: number }): Marker['shape'] | null {
  const X0 = Math.floor((c.x0 - 0.6) * S), Y0 = Math.floor((c.y0 - 0.6) * S), X1 = Math.ceil((c.x1 + 0.6) * S), Y1 = Math.ceil((c.y1 + 0.6) * S);
  const bg = at(X0, Y0);
  const dk = (x: number, y: number) => { const p = at(x, y); return Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]); };
  let mx = 0;
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) mx = Math.max(mx, dk(x, y));
  if (mx < 60) return null;
  const th = mx * 0.4;
  let tx0 = 1e9, ty0 = 1e9, tx1 = -1, ty1 = -1;
  for (let y = Y0; y < Y1; y++) for (let x = X0; x < X1; x++) if (dk(x, y) > th) { tx0 = Math.min(tx0, x); ty0 = Math.min(ty0, y); tx1 = Math.max(tx1, x); ty1 = Math.max(ty1, y); }
  const w = tx1 - tx0 + 1, h = ty1 - ty0 + 1;
  if (w / h < 0.7 || w / h > 1.45) return null;
  let mass = 0, all = 0;
  for (let y = ty0; y <= ty1; y++) for (let x = tx0; x <= tx1; x++) { all++; mass += Math.min(1, dk(x, y) / mx); }
  const fill = mass / all;
  const center = dk(Math.round((tx0 + tx1) / 2), Math.round((ty0 + ty1) / 2)) / mx;
  const corner = (dk(tx0, ty0) + dk(tx1, ty0) + dk(tx0, ty1) + dk(tx1, ty1)) / 4 / mx;
  if (center < 0.45 && w > 3) return 'circle';
  if (corner > 0.7 && fill > 0.8) return 'square';
  if (fill > 0.45 && corner < 0.7) return 'disc';
  return fill > 0.8 ? 'square' : null;
}
