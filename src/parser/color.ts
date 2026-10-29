// SPDX-License-Identifier: AGPL-3.0-only
export type RGB = [number, number, number];

export function hsv([r, g, b]: RGB) {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  return { s: mx === 0 ? 0 : (mx - mn) / mx, v: mx };
}
export const hex = ([r, g, b]: RGB) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export const hexToRgb = (h: string): RGB => { let m = h.replace('#', ''); if (m.length === 3) m = [...m].map(x => x + x).join(''); return [parseInt(m.slice(0, 2), 16) || 0, parseInt(m.slice(2, 4), 16) || 0, parseInt(m.slice(4, 6), 16) || 0]; };
export const dist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
export const lum = (c: RGB) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
export const isWhite = (c: RGB) => c[0] > 242 && c[1] > 242 && c[2] > 242;
/** 大面积底色（侧栏、页眉、表格格子）：很浅的灰也是有意的底色，只有接近纯白才算没有 */
export const isPaper = (c: RGB) => c[0] > 250 && c[1] > 250 && c[2] > 250;
export const isAccent = (c: RGB) => { const h = hsv(c); return h.s > 0.3 && h.v > 0.25 && h.v < 0.97; };
export const isTint = (c: RGB) => { const h = hsv(c); return !isWhite(c) && h.v > 0.88 && h.s > 0.015 && h.s < 0.3; };
/** 接近黑 / 深灰的正文色 */
export const isInk = (c: RGB) => hsv(c).s < 0.25 && lum(c) < 110;

export function parseCss(c: string): RGB | null {
  const m = c.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) / (m[4].endsWith('%') ? 100 : 1) < 0.1) return null;
  return [+m[1], +m[2], +m[3]];
}

/** 把相近的颜色归成一类，返回按出现量排序的代表色 */
export function clusterColors(items: { c: RGB; w: number }[], tol = 26): { c: RGB; w: number }[] {
  const out: { c: RGB; w: number; sum: RGB }[] = [];
  for (const it of items) {
    const hit = out.find(o => dist(o.c, it.c) < tol);
    if (hit) { hit.w += it.w; hit.sum = [hit.sum[0] + it.c[0] * it.w, hit.sum[1] + it.c[1] * it.w, hit.sum[2] + it.c[2] * it.w]; hit.c = [hit.sum[0] / hit.w, hit.sum[1] / hit.w, hit.sum[2] / hit.w]; }
    else out.push({ c: it.c, w: it.w, sum: [it.c[0] * it.w, it.c[1] * it.w, it.c[2] * it.w] });
  }
  return out.sort((a, b) => b.w - a.w).map(o => ({ c: o.c.map(Math.round) as RGB, w: o.w }));
}
