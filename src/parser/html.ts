// SPDX-License-Identifier: AGPL-3.0-only
import type { Extracted, Fill, ImgBox, Marker, Rule, Run, VRule } from './types';
import { isWhite, parseCss, type RGB } from './color';
import { normText } from './text';

const FRAME_PX = 1000; // iframe 比 A4 宽，避免触发原文件的窄屏样式
const A4 = { w: 595.28, h: 841.89 };
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'NAV']);

/**
 * 在隔离的 iframe 里排版（不执行脚本），读出“页面上画了什么”：每段文字的位置和计算样式、
 * 色块、边框线、列表符号、图片，转成与 PDF 相同的中间格式。
 */
export async function extractHtml(html: string): Promise<Extracted> {
  const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-same-origin');
  f.style.cssText = `position:fixed;left:-10000px;top:0;width:${FRAME_PX}px;height:1200px;border:0;visibility:hidden`;
  document.body.appendChild(f);
  try {
    f.srcdoc = clean;
    await new Promise<void>(r => { f.onload = () => r(); });
    const d = f.contentDocument!;
    const w = f.contentWindow!;
    await Promise.race([d.fonts?.ready, new Promise(r => setTimeout(r, 2500))]);
    const cs = (el: Element, pseudo?: string) => w.getComputedStyle(el, pseudo);
    const hidden = (el: Element) => { const s = cs(el); return s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0; };

    // 页面容器：宽度接近 A4 的最外层元素
    let page: Element = d.body;
    for (const el of d.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.width > 560 && r.width <= 860 && r.height > 300) { page = el; break; }
    }
    const pr = page.getBoundingClientRect();
    const pw = page === d.body ? 794 : pr.width;
    // 纸张：Word 转来的页面标了纸张尺寸（pt），其他 HTML 按 A4
    const P = (page as HTMLElement).dataset?.pgw ? { w: +(page as HTMLElement).dataset.pgw!, h: +(page as HTMLElement).dataset.pgh! } : A4;
    const k = P.w / pw;               // px → pt
    const ox = page === d.body ? 0 : pr.left, oy = pr.top;
    const totalH = Math.max(page.scrollHeight, pr.height) * k;
    const nPages = Math.max(1, Math.ceil((totalH - 4) / P.h));
    const ex: Extracted = { kind: 'html', pages: Array.from({ length: nPages }, () => ({ ...P })), runs: [], images: [], fills: [], rules: [], markers: [] };
    const place = (r: { left: number; top: number; right: number; bottom: number }) => {
      const y = (r.top - oy) * k;
      const pg = Math.max(0, Math.min(nPages - 1, Math.floor(y / P.h)));
      return { page: pg, x: (r.left - ox) * k, xEnd: (r.right - ox) * k, top: y - pg * P.h, bottom: (r.bottom - oy) * k - pg * P.h };
    };

    // ---------- 文字：逐字取位置，同一行连续的字合成一段 ----------
    const tw = d.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    const rg = d.createRange();
    const blockIds = new Map<Element, number>();
    while ((n = tw.nextNode())) {
      const t = n.textContent ?? '';
      if (!t.trim()) continue;
      const pe = n.parentElement!;
      if (SKIP.has(pe.tagName) || pe.closest('svg') || hidden(pe)) continue;
      const s = cs(pe);
      const size = parseFloat(s.fontSize) * k;
      const color = parseCss(s.color) ?? [20, 20, 20];
      const bold = +s.fontWeight >= 600;
      const italic = s.fontStyle === 'italic' || s.fontStyle === 'oblique';
      const mono = /mono|courier|consol|menlo/i.test(s.fontFamily);
      const font = s.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      let underline = false, bg: RGB | null = null;
      for (let e: Element | null = pe; e && e !== page; e = e.parentElement) {
        const es = cs(e);
        if (es.textDecorationLine.includes('underline')) underline = true;
        if (es.display.startsWith('inline') && !bg) { const b = parseCss(es.backgroundColor); if (b && !isWhite(b)) bg = b; }
        if (!es.display.startsWith('inline')) break;
      }
      const href = (pe.closest('a') as HTMLAnchorElement | null)?.href;
      let blockEl: Element = pe;
      while (blockEl !== page && blockEl.parentElement && cs(blockEl).display.startsWith('inline')) blockEl = blockEl.parentElement;
      if (!blockIds.has(blockEl)) blockIds.set(blockEl, blockIds.size + 1);
      const blk = blockIds.get(blockEl)!;
      let cur: Run | null = null;
      let lastTop = NaN;
      for (let i = 0; i < t.length; i++) {
        rg.setStart(n, i); rg.setEnd(n, i + 1);
        const rects = rg.getClientRects();
        if (!rects.length) continue;
        const r = rects[0];
        const ch = t[i];
        if (!r.width && !ch.trim()) continue;
        const pos = place(r);
        const mid = (pos.top + pos.bottom) / 2;
        if (cur && Math.abs(r.top - lastTop) < 2 && pos.page === cur.page) {
          cur.text += ch; cur.xEnd = pos.xEnd;
          continue;
        }
        if (!ch.trim()) continue;
        cur = {
          text: ch, page: pos.page, x: pos.x, xEnd: pos.xEnd, top: mid - size * 0.51, bottom: mid + size * 0.51, size,
          blk, bold, italic, mono, font, color, bg, underline, href: href && /^(https?:|mailto:|tel:)/.test(href) ? href : undefined,
        };
        ex.runs.push(cur);
        lastTop = r.top;
      }
      if (cur) cur.text = cur.text.replace(/\s+$/, '');
    }
    for (const r of ex.runs) r.text = normText(r.text.replace(/[\t\n\r ]+/g, ' '));

    // ---------- 色块、边框、列表符号、图片 ----------
    const fills: Fill[] = [], rules: Rule[] = [], markers: Marker[] = [], images: ImgBox[] = [], vrules: VRule[] = [];
    const all = [page, ...page.querySelectorAll('*')];
    let liIndex = new Map<Element, number>();
    for (const el of all) {
      if (SKIP.has(el.tagName) || hidden(el)) continue;
      const s = cs(el);
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const pos = place(r);
      const bgc = parseCss(s.backgroundColor);
      if (bgc && !isWhite(bgc) && el !== page) fills.push({ page: pos.page, x: pos.x, top: pos.top, w: pos.xEnd - pos.x, h: pos.bottom - pos.top, color: bgc });
      const bw = (side: 'Top' | 'Bottom' | 'Left' | 'Right') => parseFloat(s[`border${side}Width` as 'borderTopWidth']) * k;
      const bc = (side: 'Top' | 'Bottom' | 'Left' | 'Right') => s[`border${side}Style` as 'borderTopStyle'] !== 'none' ? parseCss(s[`border${side}Color` as 'borderTopColor']) : null;
      // 表格格子的四条边框：作为表格线（之后由版面分析还原成表格）
      if (el.tagName === 'TD' || el.tagName === 'TH') {
        for (const side of ['Top', 'Bottom'] as const) if (bw(side) >= 0.3 && bc(side)) rules.push({ page: pos.page, x: pos.x, xEnd: pos.xEnd, y: side === 'Top' ? pos.top : pos.bottom, t: bw(side), color: bc(side)!, grid: true });
        for (const side of ['Left', 'Right'] as const) if (bw(side) >= 0.3 && bc(side)) vrules.push({ page: pos.page, x: side === 'Left' ? pos.x : pos.xEnd, y0: pos.top, y1: pos.bottom, t: bw(side), color: bc(side)! });
      } else if (bw('Bottom') >= 0.4 && bc('Bottom') && pos.xEnd - pos.x > 12) rules.push({ page: pos.page, x: pos.x, xEnd: pos.xEnd, y: pos.bottom - bw('Bottom') / 2, t: bw('Bottom'), color: bc('Bottom')! });
      if (el.tagName !== 'TD' && el.tagName !== 'TH' && bw('Top') >= 0.4 && bc('Top') && pos.xEnd - pos.x > 12) {
        if (el === page && bw('Top') >= 3) fills.push({ page: 0, x: 0, top: 0, w: P.w, h: bw('Top'), color: bc('Top')! });
        else rules.push({ page: pos.page, x: pos.x, xEnd: pos.xEnd, y: pos.top + bw('Top') / 2, t: bw('Top'), color: bc('Top')! });
      }
      if (el.tagName !== 'TD' && el.tagName !== 'TH' && bw('Left') >= 1.2 && bc('Left') && pos.bottom - pos.top > 6) fills.push({ page: pos.page, x: pos.x, top: pos.top, w: bw('Left'), h: pos.bottom - pos.top, color: bc('Left')! });

      // 列表符号：<li> 与 ::before 伪元素
      const first = firstLine(el, d);
      if (s.display === 'list-item' && s.listStyleType !== 'none' && first) {
        const size = parseFloat(s.fontSize) * k;
        const fp = place(first);
        const type = s.listStyleType;
        if (/decimal|alpha|roman/.test(type)) {
          const parent = el.parentElement!;
          if (!liIndex.has(parent)) liIndex = new Map(liIndex).set(parent, 0);
          const idx = (liIndex.get(parent) ?? 0) + 1; liIndex.set(parent, idx);
          ex.runs.push({ text: idx + '.', page: fp.page, x: fp.x - size * 1.4, xEnd: fp.x - size * 0.5, top: (fp.top + fp.bottom) / 2 - size * 0.51, bottom: (fp.top + fp.bottom) / 2 + size * 0.51, size, bold: false, italic: false, mono: false, font: '', color: parseCss(s.color) ?? [20, 20, 20] });
        } else markers.push({ page: fp.page, x: fp.x - size * 0.75, top: (fp.top + fp.bottom) / 2 - size * 0.16, size: size * 0.32, shape: type === 'circle' ? 'circle' : type === 'square' ? 'square' : 'disc', color: parseCss(s.color) ?? [20, 20, 20] });
      }
      const before = cs(el, '::before');
      if (before.content && before.content !== 'none' && before.content !== 'normal' && first && !/counter/.test(before.content)) {
        const txt = before.content.replace(/^["']|["']$/g, '');
        const size = parseFloat(s.fontSize) * k;
        const fp = place(first);
        const bb = parseCss(before.backgroundColor);
        const bwid = parseFloat(before.width) * k;
        if (txt.trim() && txt.length <= 2) ex.runs.push({ text: txt, page: fp.page, x: fp.x - size * 1.1, xEnd: fp.x - size * 0.4, top: (fp.top + fp.bottom) / 2 - size * 0.51, bottom: (fp.top + fp.bottom) / 2 + size * 0.51, size, bold: false, italic: false, mono: false, font: '', color: parseCss(before.color) ?? [20, 20, 20] });
        else if (!txt.trim() && (bb || parseFloat(before.borderTopWidth) > 0) && bwid > 0 && bwid < size) markers.push({ page: fp.page, x: fp.x - size * 0.75, top: (fp.top + fp.bottom) / 2 - bwid / 2, size: bwid, shape: !bb ? 'circle' : parseFloat(before.borderTopLeftRadius) > 0 ? 'disc' : 'square', color: bb ?? parseCss(before.borderTopColor) ?? [20, 20, 20] });
      }

      // 图片
      if (el.tagName === 'IMG') {
        const src = imgSrc(el as HTMLImageElement, d);
        if (src) images.push({ page: pos.page, x: pos.x, top: pos.top, w: pos.xEnd - pos.x, h: pos.bottom - pos.top, src, raster: !/svg/.test(src.slice(0, 30)) });
      } else if (el.tagName.toLowerCase() === 'svg') {
        const svg = el.cloneNode(true) as SVGElement;
        svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        svg.setAttribute('width', String(r.width)); svg.setAttribute('height', String(r.height));
        if (!svg.getAttribute('fill') && s.fill) svg.setAttribute('fill', s.fill);
        svg.setAttribute('color', s.color);
        images.push({ page: pos.page, x: pos.x, top: pos.top, w: pos.xEnd - pos.x, h: pos.bottom - pos.top, src: 'data:image/svg+xml;utf8,' + encodeURIComponent(svg.outerHTML), raster: false });
      } else if (/url\(/.test(s.backgroundImage) && r.width < 120 && r.height < 120) {
        const m = s.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
        if (m && /^(data:image|https?:)/.test(m[1])) images.push({ page: pos.page, x: pos.x, top: pos.top, w: pos.xEnd - pos.x, h: pos.bottom - pos.top, src: m[1], raster: false });
      }
    }
    // 底色块里要排除纯装饰的大面积页面底色
    ex.fills = fills.filter(fl => fl.w * fl.h < P.w * P.h * 0.9);
    ex.rules = rules; ex.markers = markers; ex.images = images; ex.vrules = vrules;
    return ex;
  } finally {
    f.remove();
  }
}

/** 元素第一行文字的位置 */
function firstLine(el: Element, d: Document): DOMRect | null {
  const tw = d.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = tw.nextNode())) {
    if (!n.textContent?.trim()) continue;
    const r = d.createRange(); r.selectNodeContents(n);
    const rects = r.getClientRects();
    if (rects.length) return rects[0];
  }
  return null;
}

function imgSrc(img: HTMLImageElement, d: Document): string | null {
  if (img.src.startsWith('data:')) return img.src;
  try {
    const c = d.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    if (!c.width || !c.height) return /^https?:/.test(img.src) ? img.src : null;
    c.getContext('2d')!.drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  } catch { return /^https?:/.test(img.src) ? img.src : null; }
}
