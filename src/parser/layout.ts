// SPDX-License-Identifier: AGPL-3.0-only
import type { ListKind } from '../model/types';
import type { Extracted, Fill, ImgBox, Run } from './types';
import { dist, type RGB } from './color';
import { isCjk } from './text';

/** 版面分析：分栏 → 行 → 段落。输出每个段落的几何信息、行内元素和装饰（底色、下划线、列表符号）。 */

export interface Region { page: number; col: number; x0: number; x1: number; y0: number; y1: number; bg?: RGB | null; cell?: boolean }

/** 表格：xs / ys 为边框位置；full[r] = 第 r 行只有一个通栏格子（这种行按普通正文排，只加外框） */
export interface TCell { r: number; c: number; rs: number; cs: number; x0: number; x1: number; y0: number; y1: number; col: number }
export interface TableBox { page: number; x0: number; x1: number; y0: number; y1: number; xs: number[]; ys: number[]; cells: TCell[]; full: boolean[]; color: RGB; t: number }

export type Inline = { t: 'run'; r: Run } | { t: 'img'; i: ImgBox };

export interface VLine {
  page: number; col: number;
  x: number; xEnd: number; top: number; bottom: number;
  size: number;
  items: Inline[];
  right: Inline[];        // 右对齐部分
  marker?: { list: ListKind; num?: string; color?: RGB; x: number };
}

export interface VPara {
  page: number; col: number;
  lines: VLine[];
  x: number; xEnd: number; top: number; bottom: number;
  size: number;            // 主字号
  list?: ListKind; num?: string; mkColor?: RGB; markerX?: number;
  bg?: { color: RGB; x: number; xEnd: number; bleed: boolean } | null;
  bar?: RGB | null;
  rule?: { color: RGB; t: number } | null;
  align?: 'center' | 'right';
  firstIndent?: number;    // 首行比后续行多出来的缩进 pt
}

export interface Layout {
  regions: Region[];
  tables: TableBox[];
  paras: VPara[];          // 按阅读顺序：每页先通栏区域，再左栏、右栏
  floats: ImgBox[];        // 不在文字行里的图片
  cols: { side: 'left' | 'right'; sideCol: number; w: number; gap: number; bg: RGB | null; edge: number; sideLeft: number; mainLeft: number } | null;
}

const BULLET_CHARS: [RegExp, ListKind][] = [
  [/^[•●⚫∙·]/, 'disc'], [/^[◦○⚪]/, 'circle'], [/^[▪■◼□◆◇♦]/, 'square'], [/^[-–—]/, 'dash'],
  [/^[►▶▸➢➤]/, 'arrow'], [/^[✓✔√]/, 'check'], [/^[★☆✦]/, 'star'],
];
const NUM_RE = /^\s*((?:\d{1,2}[.、)）](?!\d))|(?:\[\d{1,3}\])|(?:[（(]\d{1,2}[)）])|[①②③④⑤⑥⑦⑧⑨⑩])\s*/;

/** 一段文字里前 n 个字占的宽度比例：中文按 1 个字宽，西文、数字、空格约半个字宽 */
const charW = (c: string) => (isCjk(c) || /[\u3000-\u303f\uff00-\uffef]/.test(c) ? 1 : c === ' ' ? 0.3 : /[A-Z]/.test(c) ? 0.68 : 0.52);
const share = (t: string, n: number) => { const a = [...t]; const tot = a.reduce((s, c) => s + charW(c), 0) || 1; return a.slice(0, n).reduce((s, c) => s + charW(c), 0) / tot; };

const ink = (it: Inline) => it.t === 'run' ? it.r : it.i;
const xOf = (it: Inline) => ink(it).x;
const xEndOf = (it: Inline) => it.t === 'run' ? it.r.xEnd : it.i.x + it.i.w;
const topOf = (it: Inline) => ink(it).top;
const botOf = (it: Inline) => it.t === 'run' ? it.r.bottom : it.i.top + it.i.h;
const pct = (a: number[], q: number) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * q)))]; };

/** 分栏：找一条从某个高度往下一直空着的竖向缝隙，两侧都有不少文字 */
function findColumns(ex: Extracted, page: number): Region[] {
  const { w, h } = ex.pages[page];
  const runs = ex.runs.filter(r => r.page === page);
  const all: Region = { page, col: 0, x0: 0, x1: w, y0: 0, y1: h };
  if (runs.length < 12) return [all];
  // 侧栏底色：一块高度过半、宽度 20%–45% 的色块贴着页边
  const side = ex.fills.find(f => f.page === page && f.h > h * 0.45 && f.w > w * 0.18 && f.w < w * 0.48 && (f.x < w * 0.04 || f.x + f.w > w * 0.96));
  const tops = [...new Set(runs.map(r => Math.round(r.top)))].sort((a, b) => a - b);
  const chars = (rs: Run[]) => rs.reduce((s, r) => s + r.text.length, 0);
  for (const y0 of tops.slice(0, Math.ceil(tops.length * 0.6))) {
    const below = runs.filter(r => r.top >= y0 - 0.5);
    if (below.length < runs.length * 0.45) break;
    const cov = new Uint16Array(Math.ceil(w) + 1);
    for (const r of below) for (let x = Math.max(0, Math.floor(r.x)); x <= Math.min(w, Math.ceil(r.xEnd)); x++) cov[x]++;
    for (const im of ex.images) if (im.page === page && im.top >= y0 && im.w < w * 0.3) for (let x = Math.max(0, Math.floor(im.x)); x <= Math.min(w, Math.ceil(im.x + im.w)); x++) cov[x]++;
    // 最宽的空白缝隙（只看页面中间 15%–85%）
    let best: [number, number] | null = null;
    let s = -1;
    for (let x = Math.floor(w * 0.15); x <= Math.ceil(w * 0.85); x++) {
      if (cov[x] === 0) { if (s < 0) s = x; }
      else if (s >= 0) { if (!best || x - s > best[1] - best[0]) best = [s, x]; s = -1; }
    }
    if (side) { const edge = side.x < w * 0.04 ? side.x + side.w : side.x; if (!best || Math.abs((best[0] + best[1]) / 2 - edge) > 30) { const okSide = below.every(r => r.xEnd <= edge + 1 || r.x >= edge - 1); if (okSide) best = [edge - 1, edge + 1]; } }
    if (!best || best[1] - best[0] < 7) continue;
    const mid = (best[0] + best[1]) / 2;
    const L = below.filter(r => r.xEnd <= mid), R = below.filter(r => r.x >= mid);
    const cl = chars(L), cr = chars(R), ct = cl + cr;
    if (ct < 80 || cl < ct * 0.12 || cr < ct * 0.12) continue;
    // 右边若大多和左边同一行（如右对齐的时间），这是表格式的一行，不是分栏
    const sameRow = (a: Run, rs: Run[]) => rs.some(b => Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < Math.min(a.size, b.size) * 0.35);
    const small = L.length < R.length ? L : R, big = small === L ? R : L;
    // 有侧栏底色时一定是分栏，不做这个判断
    if (!side && small.filter(r => sameRow(r, big)).length > small.length * 0.5) continue;
    const ys = below.map(r => r.top);
    if (Math.max(...ys) - Math.min(...ys) < h * 0.35) continue;
    const regions: Region[] = [];
    if (y0 > Math.min(...runs.map(r => r.top)) + 1) regions.push({ page, col: 0, x0: 0, x1: w, y0: 0, y1: y0 - 0.5 });
    const bgL = side && side.x < w * 0.04 ? side.color : null, bgR = side && side.x >= w * 0.04 ? side.color : null;
    regions.push({ page, col: 1, x0: 0, x1: best[0], y0: y0 - 0.5, y1: h, bg: bgL });
    regions.push({ page, col: 2, x0: best[1], x1: w, y0: y0 - 0.5, y1: h, bg: bgR });
    return regions;
  }
  return [all];
}

/** 表格：由相交的横竖边框围成的格子；没有竖线隔开的相邻格子合并（跨列），没有横线隔开的合并（跨行） */
function findTables(ex: Extracted, page: number): TableBox[] {
  const H = ex.rules.filter(r => r.page === page && r.grid);
  const V = (ex.vrules ?? []).filter(v => v.page === page);
  if (H.length < 2 || V.length < 2) return [];
  const T = 2.5;
  const meets = (h: typeof H[0], v: typeof V[0]) => v.x >= h.x - T && v.x <= h.xEnd + T && h.y >= v.y0 - T && h.y <= v.y1 + T;
  // 连通的线组成一张表
  const groups: { H: typeof H; V: typeof V }[] = [];
  const seenH = new Set<number>(), seenV = new Set<number>();
  H.forEach((_h, i0) => {
    if (seenH.has(i0)) return;
    const g = { H: [] as typeof H, V: [] as typeof V };
    const qh = [i0], qv: number[] = []; seenH.add(i0);
    while (qh.length || qv.length) {
      if (qh.length) { const i = qh.pop()!; g.H.push(H[i]); V.forEach((v, j) => { if (!seenV.has(j) && meets(H[i], v)) { seenV.add(j); qv.push(j); } }); }
      else { const j = qv.pop()!; g.V.push(V[j]); H.forEach((h, i) => { if (!seenH.has(i) && meets(h, V[j])) { seenH.add(i); qh.push(i); } }); }
    }
    if (g.H.length >= 2 && g.V.length >= 2) groups.push(g);
  });
  const uniq = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const o: number[][] = []; for (const v of s) { const l = o[o.length - 1]; if (l && v - l[l.length - 1] < T) l.push(v); else o.push([v]); } return o.map(l => l.reduce((x, y) => x + y, 0) / l.length); };
  const out: TableBox[] = [];
  for (const g of groups) {
    const xs = uniq(g.V.map(v => v.x)), ys = uniq(g.H.map(h => h.y));
    const nc = xs.length - 1, nr = ys.length - 1;
    if (nc < 1 || nr < 1) continue;
    const vAt = (x: number, ya: number, yb: number) => g.V.some(v => Math.abs(v.x - x) < T && v.y0 <= ya + T && v.y1 >= yb - T);
    const hAt = (y: number, xa: number, xb: number) => g.H.some(h => Math.abs(h.y - y) < T && h.x <= xa + T && h.xEnd >= xb - T);
    const occ = Array.from({ length: nr }, () => new Array(nc).fill(false));
    const cells: TCell[] = [];
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
      if (occ[r][c]) continue;
      let cs = 1; while (c + cs < nc && !vAt(xs[c + cs], ys[r], ys[r + 1])) cs++;
      let rs = 1; while (r + rs < nr && !hAt(ys[r + rs], xs[c], xs[c + cs])) rs++;
      for (let i = r; i < r + rs; i++) for (let j = c; j < c + cs; j++) occ[i][j] = true;
      cells.push({ r, c, rs, cs, x0: xs[c], x1: xs[c + cs], y0: ys[r], y1: ys[r + rs], col: -1 });
    }
    const full = ys.slice(0, -1).map((_y, r) => { const cov = cells.filter(c => c.r <= r && c.r + c.rs > r); return cov.length === 1 && cov[0].cs === nc && cov[0].rs === 1; });
    const lines = [...g.H.map(h => ({ c: h.color, t: h.t })), ...g.V.map(v => ({ c: v.color, t: v.t }))];
    const color = lines.reduce((m, l) => (l.c[0] + l.c[1] + l.c[2] < m[0] + m[1] + m[2] ? l.c : m), lines[0].c);
    const t = Math.max(0.4, Math.min(2, Math.min(...lines.map(l => l.t))));
    out.push({ page, x0: xs[0], x1: xs[nc], y0: ys[0], y1: ys[nr], xs, ys, cells, full, color, t });
  }
  return out;
}

const inRegion = (rg: Region, x: number, xEnd: number, top: number) => top >= rg.y0 && top < rg.y1 && x >= rg.x0 - 1 && xEnd <= rg.x1 + 1;

export function analyzeLayout(ex: Extracted, opts: { photo?: ImgBox | null } = {}): Layout {
  const regions: Region[] = [];
  const tables: TableBox[] = [];
  ex.pages.forEach((_p, i) => tables.push(...findTables(ex, i)));
  // 表格里不是通栏的格子各自是一个区域：同一行的几个格子不会被拼成一行
  let cid = 10;
  for (const t of tables) for (const c of t.cells) if (!t.full[c.r] || c.rs > 1) { c.col = cid; regions.push({ page: t.page, col: cid++, x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, cell: true }); }
  ex.pages.forEach((_p, i) => regions.push(...findColumns(ex, i)));
  const lines: VLine[] = [];
  const used = new Set<ImgBox>();
  const taken = new Set<Run>();
  const floats: ImgBox[] = [];

  for (const rg of regions) {
    const runs = ex.runs.filter(r => r.page === rg.page && !taken.has(r) && inRegion(rg, r.x, r.xEnd, r.top)).sort((a, b) => (a.top + a.bottom) / 2 - (b.top + b.bottom) / 2 || a.x - b.x);
    runs.forEach(r => taken.add(r));
    const rows: { top: number; bottom: number; items: Inline[]; size: number }[] = [];
    for (const r of runs) {
      const c = (r.top + r.bottom) / 2;
      const row = rows.slice(-4).find(w => c > w.top + Math.min(w.size, r.size) * 0.15 && c < w.bottom - Math.min(w.size, r.size) * 0.15);
      if (row) { row.items.push({ t: 'run', r }); row.top = Math.min(row.top, r.top); row.bottom = Math.max(row.bottom, r.bottom); row.size = Math.max(row.size, r.size); }
      else rows.push({ top: r.top, bottom: r.bottom, items: [{ t: 'run', r }], size: r.size });
    }
    // 行内图片：图标、logo、徽章（高度不超过一行文字的 3 倍，并且挨着这一行的文字）
    for (const im of ex.images) {
      if (im.page !== rg.page || used.has(im) || im === opts.photo || !inRegion(rg, im.x, im.x + im.w, im.top)) continue;
      const cy = im.top + im.h / 2;
      const row = rows.find(w => cy >= w.top - w.size * 0.2 && cy <= w.bottom + w.size * 0.2 && im.h <= w.size * 3.2 &&
        (w.items.some(it => im.x + im.w >= xOf(it) - w.size * 3 && im.x <= xEndOf(it) + w.size * 3) ||
          // 行尾右侧单独的徽章、图标：和这一行同高，右边没有别的文字，放进这一行的右侧（不会压到下面的文字）
          (w.items.length > 0 && im.x >= Math.max(...w.items.map(xEndOf)) && im.x + im.w <= rg.x1 + w.size * 2)));
      if (row) { row.items.push({ t: 'img', i: im }); used.add(im); }
    }
    // 文字之间单独的小图形（技能条）：自己成一行
    for (const im of ex.images) {
      if (!im.flow || im.page !== rg.page || used.has(im) || !inRegion(rg, im.x, im.x + im.w, im.top)) continue;
      const size = rows.length ? rows.reduce((m, w) => m + w.size, 0) / rows.length : 10;
      rows.push({ top: im.top, bottom: im.top + im.h, items: [{ t: 'img', i: im }], size });
      used.add(im);
    }
    rows.sort((a, b) => a.top - b.top);
    for (const row of rows) {
      row.items.sort((a, b) => xOf(a) - xOf(b));
      lines.push(splitRight(row.items, rg, row.size));
    }
  }
  for (const im of ex.images) if (!used.has(im) && im !== opts.photo) floats.push(im);

  // 列表符号
  for (const l of lines) detectMarker(l, ex);

  // 每栏的右边界：长行的右端
  const colRight = new Map<string, number>();
  const colLeft = new Map<string, number>();
  for (const rg of regions) {
    const ls = lines.filter(l => l.page === rg.page && l.col === rg.col);
    const key = rg.page + ':' + rg.col;
    colRight.set(key, pct(ls.map(l => Math.max(l.xEnd, ...l.right.map(xEndOf))), 0.9) || rg.x1);
    // 表格格子：右边界就是格子右框减去和左边一样的内边距
    if (rg.cell && ls.length) colRight.set(key, rg.x1 - (Math.min(...ls.map(l => l.marker ? l.marker.x : l.x)) - rg.x0));
    colLeft.set(key, Math.min(...ls.map(l => l.marker ? l.marker.x : l.x)) || rg.x0);
  }

  // ---------- 段落 ----------
  const order = (l: VLine) => l.page * 1000 + l.col;
  lines.sort((a, b) => order(a) - order(b) || a.top - b.top);
  // 段内换行的行距（相对字号）：用“明显写满的一行 + 下一行”的行对估计，用来区分折行和另起一段
  const wrapK: number[] = [];
  const wrapByCol = new Map<number, number[]>();
  for (let i = 1; i < lines.length; i++) {
    const a = lines[i - 1], b = lines[i];
    if (a.page !== b.page || a.col !== b.col || b.marker || a.right.length || b.top <= a.top || Math.abs(b.size - a.size) > a.size * 0.12) continue;
    if (a.xEnd >= colRight.get(a.page + ':' + a.col)! - a.size * 1.2) { const k = (b.top - a.top) / a.size; wrapK.push(k); wrapByCol.set(a.col, [...(wrapByCol.get(a.col) ?? []), k]); }
  }
  const wrapAll = wrapK.length >= 3 ? pct(wrapK, 0.5) : NaN;
  const wrapOf = (col: number) => { const a = wrapByCol.get(col); return a && a.length >= 3 ? pct(a, 0.5) : wrapAll; };
  const paras: VPara[] = [];
  let cur: VPara | null = null;
  const textEnd = (l: VLine) => { const it = [...l.items].reverse().find(i => i.t === 'run'); return it?.t === 'run' ? it.r.text : ''; };
  const keyStart = (l: VLine) => { const f = l.items[0]; return f?.t === 'run' && f.r.bold && /^[^：:]{1,24}[：:]\s*$/.test(f.r.text) && l.items.length > 1; };
  const fillAt = (l: VLine) => ex.fills.find(f => f.page === l.page && f.top <= l.top + 1 && f.top + f.h >= l.bottom - 1 && f.x <= l.x + 1 && f.x + f.w >= l.xEnd - 1 && f.w < ex.pages[l.page].w * 0.98 && !(f.h > ex.pages[l.page].h * 0.4)) ?? null;

  for (const l of lines) {
    const key = l.page + ':' + l.col;
    const right = colRight.get(key)!;
    const prev = cur?.lines[cur.lines.length - 1];
    let join = false;
    const imgOnly = (x: VLine) => x.items.every(i => i.t === 'img');
    if (cur && prev && cur.col === l.col && !l.marker && !l.right.length && !prev.right.length && !keyStart(l) && !imgOnly(l) && !imgOnly(prev)) {
      const samePage = prev.page === l.page;
      const pitch = samePage ? l.top - prev.top : Infinity;
      const colW = right - (colLeft.get(key) ?? 0);
      const tol = Math.min(colW * 0.16, /[A-Za-z0-9,.;:)\]”’"'-]$/.test(textEnd(prev)) ? Math.max(4 * prev.size, 16) : Math.max(2.6 * prev.size, 10));
      const wrapRatio = wrapOf(l.col);
      const pitchWrap = isNaN(wrapRatio) || !samePage || (l.top - prev.top) <= wrapRatio * prev.size * 1.12;
      // 换行判断：上一行几乎写满，或者下一行的第一个词放不进上一行的剩余空间
      const f0 = l.items[0];
      const w0 = f0?.t === 'run' ? (() => { const m = f0.r.text.match(/^\S+/); return m && /^[\x21-\x7e\u00a0-\u024f“”‘’]+$/.test(m[0]) ? (f0.r.xEnd - f0.r.x) * m[0].length / Math.max(1, f0.r.text.length) : 0; })() : 0;
      const full = (prev.xEnd >= right - tol || (w0 > 0 && prev.xEnd + w0 + prev.size * 0.3 > right)) && pitchWrap;
      const contX = cur.list ? cur.lines[0].x : cur.lines.length > 1 ? cur.lines[1].x : null;
      const xOk = contX !== null ? Math.abs(l.x - contX) < prev.size * 0.6 : (Math.abs(l.x - cur.lines[0].x) < prev.size * 0.6 || (l.x < cur.lines[0].x && cur.lines[0].x - l.x < prev.size * 2.6));
      const sizeOk = Math.abs(l.size - prev.size) < prev.size * 0.12;
      const pitchOk = samePage ? pitch > 0 && pitch < prev.size * 2.1 : true;
      const fillSame = fillAt(l) === fillAt(prev);
      const crossPage = !samePage && l.page === prev.page + 1 && full;
      join = full && xOk && sizeOk && fillSame && (pitchOk || crossPage) && (samePage || crossPage);
    }
    // HTML / Word：块元素就是段落边界，直接按块合并
    const bl = (x: VLine) => { const r = x.items.find(i => i.t === 'run'); return r?.t === 'run' ? r.r.blk : undefined; };
    if (cur && prev && bl(l) !== undefined && bl(prev) !== undefined) join = bl(l) === bl(prev) && !l.marker && cur.col === l.col;
    if (join && cur) { cur.lines.push(l); continue; }
    cur = { page: l.page, col: l.col, lines: [l], x: l.x, xEnd: l.xEnd, top: l.top, bottom: l.bottom, size: l.size, list: l.marker?.list, num: l.marker?.num, mkColor: l.marker?.color, markerX: l.marker?.x };
    paras.push(cur);
  }

  // 段落几何与装饰
  for (const p of paras) {
    const ls = p.lines.filter(l => l.page === p.page);
    p.x = Math.min(...ls.map(l => l.x)); p.xEnd = Math.max(...ls.map(l => Math.max(l.xEnd, ...l.right.map(xEndOf))));
    p.top = Math.min(...ls.map(l => l.top)); p.bottom = Math.max(...ls.map(l => l.bottom));
    p.size = dominantSize(p.lines);
    if (p.lines.length > 1 && p.lines[0].x - p.lines[1].x > p.size * 0.5) p.firstIndent = p.lines[0].x - p.lines[1].x;
    const key = p.page + ':' + p.col;
    const L = colLeft.get(key)!, R = colRight.get(key)!;
    const W = ex.pages[p.page].w;
    // 底色：盖住整段文字的色块
    const runX = Math.min(...ls.map(l => { const r = l.items.find(i => i.t === 'run'); return r ? xOf(r) : l.x; }));
    const runTop = Math.min(...ls.flatMap(l => l.items.filter(i => i.t === 'run').map(topOf)));
    const runBot = Math.max(...ls.flatMap(l => l.items.filter(i => i.t === 'run').map(botOf)));
    const f = ex.fills.find(fl => fl.page === p.page && fl.top <= runTop + 1.5 && fl.top + fl.h >= runBot - 1.5 && fl.x <= runX + 1 && fl.x + fl.w >= p.xEnd - 1 && fl.h < p.bottom - p.top + p.size * 2.5 && fl.w >= (R - L) * 0.45);
    if (f) p.bg = { color: f.color, x: f.x, xEnd: f.x + f.w, bleed: f.w > W * 0.92 };
    // 左侧竖条
    const bar = ex.fills.find(fl => fl.page === p.page && fl.w <= 4 && fl.h >= (p.bottom - p.top) * 0.6 && fl.h < (p.bottom - p.top) + p.size * 2 && fl.x + fl.w <= p.x + 0.5 && p.x - fl.x < p.size * 2.5 && fl.top <= p.bottom && fl.top + fl.h >= p.top);
    if (bar) p.bar = bar.color;
    // 段落下方的横线（标题下划线）
    const rule = ex.rules.find(r => r.page === p.page && !r.grid && r.y >= p.bottom - p.size * 0.15 && r.y <= p.bottom + p.size * 0.9 && r.xEnd - r.x >= (R - L) * 0.45 && r.x <= p.x + p.size && !(r as { used?: boolean }).used);
    if (rule) { p.rule = { color: rule.color, t: rule.t }; (rule as { used?: boolean }).used = true; }
    // 对齐
    if (p.lines.length <= 3 && !p.list) {
      const Rmax = Math.max(R, ...lines.filter(l => l.page === p.page && l.col === p.col).map(l => Math.max(l.xEnd, ...l.right.map(xEndOf))));
      const mid = (p.x + p.xEnd) / 2, cmid = (L + Rmax) / 2;
      if (Math.abs(mid - cmid) < Math.max(4, p.size * 0.6) && p.x > L + p.size * 2.5) p.align = 'center';
      else if (Math.abs(p.xEnd - R) < p.size * 0.6 && p.x > L + (R - L) * 0.45) p.align = 'right';
    }
  }

  // 文字下方的短横线 → 下划线
  for (const r of ex.rules) {
    if ((r as { used?: boolean }).used || r.grid) continue;
    const under = (run: Run) => run.page === r.page && Math.abs(r.y - (run.bottom - run.size * 0.08)) < run.size * 0.25;
    for (const run of ex.runs) if (under(run) && r.x >= run.x - 2 && r.xEnd <= run.xEnd + 2 && r.xEnd - r.x > (run.xEnd - run.x) * 0.5) run.underline = true;
    // 一条线下面跨了好几段文字（链接里夹着图标、换了颜色）：线的两端正好是文字的两端
    const span = ex.runs.filter(run => under(run) && run.x >= r.x - 2 && run.xEnd <= r.xEnd + 2);
    if (span.length > 1 && Math.abs(Math.min(...span.map(x => x.x)) - r.x) < 3 && Math.abs(Math.max(...span.map(x => x.xEnd)) - r.xEnd) < 3) span.forEach(x => { x.underline = true; });
  }

  // 侧栏信息
  let cols: Layout['cols'] = null;
  const r1 = regions.filter(r => r.page === 0 && r.col > 0 && !r.cell);
  if (r1.length === 2) {
    const [a, b] = r1;
    const wa = (colRight.get('0:1') ?? a.x1) - (colLeft.get('0:1') ?? a.x0), wb = (colRight.get('0:2') ?? b.x1) - (colLeft.get('0:2') ?? b.x0);
    const sideLeft = a.bg ? true : b.bg ? false : wa <= wb;
    const gap = (colLeft.get('0:2') ?? b.x0) - (colRight.get('0:1') ?? a.x1);
    // 底色边界：有侧栏色块时以色块边缘为准，否则取栏间空白
    const W0 = ex.pages[0].w;
    const sf = ex.fills.find(f => f.page === 0 && f.h > ex.pages[0].h * 0.45 && f.w > W0 * 0.18 && f.w < W0 * 0.48 && (sideLeft ? f.x < W0 * 0.04 : f.x + f.w > W0 * 0.96));
    const edge = sf ? (sideLeft ? sf.x + sf.w : sf.x) : sideLeft ? a.x1 : b.x0;
    cols = { side: sideLeft ? 'left' : 'right', sideCol: sideLeft ? 1 : 2, w: sideLeft ? wa : wb, gap: Math.max(4, gap), bg: (sideLeft ? a.bg : b.bg) ?? null,
      edge, sideLeft: colLeft.get(sideLeft ? '0:1' : '0:2') ?? 0, mainLeft: colLeft.get(sideLeft ? '0:2' : '0:1') ?? 0 };
  }
  return { regions, tables, paras, floats, cols };
}

/** 一行里离得很远、贴着右边界的最后一段（通常是时间、地点）单独作为右对齐部分 */
function splitRight(items: Inline[], rg: Region, size: number): VLine {
  const page = rg.page, col = rg.col;
  let cut = -1;
  for (let i = items.length - 1; i > 0; i--) {
    const gap = xOf(items[i]) - xEndOf(items[i - 1]);
    if (gap > Math.max(size * 2.2, 12)) { cut = i; break; }
  }
  let left = items, right: Inline[] = [];
  if (cut > 0) {
    const tail = items.slice(cut);
    const tailW = xEndOf(tail[tail.length - 1]) - xOf(tail[0]);
    const nearEdge = rg.x1 - xEndOf(tail[tail.length - 1]) < (rg.x1 - rg.x0) * 0.2;
    if (tailW < (rg.x1 - rg.x0) * 0.42 && nearEdge && (tail.every(i => i.t === 'run') || tail.every(i => i.t === 'img'))) { left = items.slice(0, cut); right = tail; }
  }
  const all = [...left, ...right];
  return {
    page, col, items: left, right,
    x: xOf(left[0]), xEnd: xEndOf(left[left.length - 1]),
    top: Math.min(...all.map(topOf)), bottom: Math.max(...all.map(botOf)),
    size: dominantSize([{ items: all } as VLine]) || size,
  };
}

function detectMarker(l: VLine, ex: Extracted) {
  const f = l.items[0];
  if (f?.t === 'run') {
    const t = f.r.text;
    for (const [re, kind] of BULLET_CHARS) {
      const m = t.match(re);
      if (!m) continue;
      // “-”只有后面跟空格才算列表符号；“—”开头的破折号句子不算
      if (kind === 'dash' && !/^[-–—]\s/.test(t) && t.length > 1) continue;
      const rest = t.slice(m[0].length).replace(/^\s+/, '');
      l.marker = { list: kind, x: f.r.x, color: f.r.color };
      if (rest) { const w = (f.r.xEnd - f.r.x) * share(t, [...t].length - [...rest].length); f.r.text = rest; f.r.x += w; }
      else l.items.shift();
      if (!l.items.length) return;
      l.x = xOf(l.items[0]);
      return;
    }
    const nm = t.match(NUM_RE);
    if (nm && (t.length > nm[0].length || l.items.length > 1)) {
      l.marker = { list: 'num', num: nm[1], x: f.r.x, color: f.r.color };
      if (t.length > nm[0].length) {
        const w = (f.r.xEnd - f.r.x) * share(t, [...nm[0]].length);
        f.r.text = t.slice(nm[0].length); f.r.x += w;
      } else l.items.shift(); // 编号是单独的一段文字（<ol> 的编号、右对齐的 10. 11.）
      l.x = xOf(l.items[0]);
      return;
    }
  }
  // 图形圆点：在行首左侧
  const mk = ex.markers.find(m => m.page === l.page && m.x + m.size <= l.x + 1 && l.x - m.x < l.size * 2.4 && m.top + m.size / 2 >= l.top && m.top + m.size / 2 <= l.bottom);
  if (mk) l.marker = { list: mk.shape === 'circle' ? 'circle' : mk.shape === 'square' ? 'square' : 'disc', x: mk.x, color: mk.color };
}

export function dominantSize(lines: VLine[]) {
  const m = new Map<number, number>();
  for (const l of lines) for (const it of [...l.items, ...(l.right ?? [])]) if (it.t === 'run') { const k = Math.round(it.r.size * 4) / 4; m.set(k, (m.get(k) ?? 0) + it.r.text.length); }
  return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

// ---------- 段落 → 富文本 ----------
export interface Base { size: number; bold: boolean; italic: boolean; color: RGB; mono: boolean }

/** 段落里出现最多的字号、粗细、颜色（按字数） */
export function baseOf(lines: VLine[]): Base {
  const w = new Map<string, number>();
  let bold = 0, mono = 0, n = 0;
  const colors: { c: RGB; n: number }[] = [];
  for (const l of lines) for (const it of [...l.items, ...l.right]) {
    if (it.t !== 'run') continue;
    const k = it.r.text.replace(/\s/g, '').length;
    n += k; if (it.r.bold) bold += k; if (it.r.mono) mono += k;
    const hit = colors.find(c => dist(c.c, it.r.color) < 30);
    if (hit) hit.n += k; else colors.push({ c: it.r.color, n: k });
    const s = String(Math.round(it.r.size * 4) / 4); w.set(s, (w.get(s) ?? 0) + k);
  }
  colors.sort((a, b) => b.n - a.n);
  return {
    size: +([...w.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10),
    bold: bold > n * 0.6, italic: false, mono: mono > n * 0.6, // 斜体总是写在文字上（段落没有斜体属性）
    color: colors[0]?.c ?? [20, 20, 20],
  };
}

const escH = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hexOf = (c: RGB) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

/** 两段之间的空白：小间距用空格，大间距（原稿里用空格或制表对齐的地方）用全角 / 半角空格还原宽度 */
function spaceFor(gap: number, size: number, a: string, b: string, edge = false) {
  if (gap < size * 0.18) return '';
  // 中文之间的小间距通常是字距；但链接等样式边界处的间距是原稿有意留的空格
  if (gap < size * 0.55) return (isCjk(a.slice(-1)) && isCjk(b[0] ?? '') && !edge) ? '' : ' ';
  const em = gap / size;
  const full = Math.floor(em), half = em - full >= 0.4 ? 1 : 0;
  return ' '.repeat(Math.min(full, 12)) + (half ? ' ' : '');
}

export function inlineHtml(items: Inline[], base: Base, fills: Fill[]): string {
  let html = '';
  let prevEnd: number | null = null, prevText = '', lastHref: string | undefined;
  for (const it of items) {
    const x = xOf(it);
    const href = it.t === 'run' ? it.r.href : undefined;
    if (prevEnd !== null) html += spaceFor(x - prevEnd, base.size, prevText, it.t === 'run' ? it.r.text : 'x', href !== lastHref);
    lastHref = href;
    if (it.t === 'img') {
      const im = it.i;
      const h = +(im.h / base.size).toFixed(3);
      const w = +(im.w / base.size).toFixed(3); // 写明宽高：图片还没解码时排版也不变
      html += `<img class="ri" src="${im.src}" alt="" style="width:${w}em;height:${h}em;vertical-align:${(-(h - 1) / 2 - 0.12).toFixed(3)}em">`;
      prevEnd = im.x + im.w; prevText = 'x';
      continue;
    }
    const r = it.r;
    let t = escH(r.text);
    const css: string[] = [];
    const k = r.size / base.size;
    if (Math.abs(k - 1) > 0.06) css.push(`font-size:${+k.toFixed(3)}em`);
    if (dist(r.color, base.color) > 38) css.push(`color:${hexOf(r.color)}`);
    // 行内底色（代码、标签、高亮）：只有比所在行窄的色块才算
    const bgFill = fills.find(f => f.page === r.page && f.x <= r.x + 1 && f.x + f.w >= r.xEnd - 1 && f.top <= r.top + r.size * 0.3 && f.top + f.h >= r.bottom - r.size * 0.3 && f.w < (r.xEnd - r.x) + r.size * 3);
    // 等宽字体（行内代码）：统一用代码样式；原稿有底色时沿用原稿的底色
    if (r.mono && !base.mono) { const bc = bgFill?.color ?? r.bg; t = `<code${bc && dist(bc, [240, 241, 243]) > 12 ? ` style="background:${hexOf(bc)}"` : ''}>${t}</code>`; }
    else if (bgFill) css.push(`background:${hexOf(bgFill.color)}`, 'padding:0 .25em', 'border-radius:.25em');
    if (r.bold !== base.bold) t = r.bold ? `<b>${t}</b>` : `<span style="font-weight:400">${t}</span>`;
    if (r.italic && !base.italic) t = `<i>${t}</i>`;
    if (r.underline) t = `<u>${t}</u>`;
    if (css.length) t = `<span style="${css.join(';')}">${t}</span>`;
    if (r.href) t = `<a href="${escH(r.href)}">${t}</a>`;
    html += t;
    prevEnd = r.xEnd; prevText = r.text;
  }
  // 相邻的同类标记合并：同一个链接、连续的代码被拆成多段时还原成一段
  return joinTags(html).replace(/^\s+|\s+$/g, '');
}

function joinTags(html: string) {
  return html.replace(/<\/b><b>/g, '').replace(/<\/u>(\s*)<u>/g, '$1').replace(/<\/code>(\s*)<code>/g, '$1').replace(/<\/a>(\s*)<a href="([^"]*)">/g, (m, sp: string, h: string, off: number, all: string) => prevHref(all, off) === h ? sp : m);
}

/** 位置 off 之前最近一个链接的地址 */
function prevHref(html: string, off: number) {
  const i = html.lastIndexOf('<a href="', off);
  return i < 0 ? '' : html.slice(i + 9, html.indexOf('"', i + 9));
}

/** 多行段落：行与行之间按语言决定要不要补空格 */
export function paraHtml(p: VPara, base: Base, fills: Fill[]): { html: string; right: string } {
  let html = '';
  p.lines.forEach((l, i) => {
    const h = inlineHtml(l.items, base, fills);
    if (i > 0) {
      const prevText = html.replace(/<[^>]+>/g, '');
      const a = prevText.slice(-1), b = h.replace(/<[^>]+>/g, '')[0] ?? '';
      if (/[A-Za-z0-9,.;:)]/.test(a) && /[A-Za-z0-9(]/.test(b) && !prevText.endsWith('-')) html += ' ';
    }
    html += h;
  });
  const right = p.lines.map(l => inlineHtml(l.right, base, fills)).filter(Boolean).join(' ');
  return { html: joinTags(html), right };
}
