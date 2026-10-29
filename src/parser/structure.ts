// SPDX-License-Identifier: AGPL-3.0-only
import type { Block, Cell, FontKey, Group, Look, Para, Resume, Role, StyleConfig, Table } from '../model/types';
import { BASE_STYLE, KNOWN_PAGES, blankResume, para as mkPara, uid } from '../model/defaults';
import { stats as countStats } from '../model/stats';
import type { Extracted, ImgBox } from './types';
import { analyzeLayout, baseOf, paraHtml, type Base, type Layout, type VPara } from './layout';
import { clusterColors, dist, hex, hexToRgb, isAccent, isPaper, isWhite, type RGB } from './color';
import { isCjk } from './text';

const PT_MM = 25.4 / 72;
const clean0 = (t: string) => t.replace(/[\s:：|｜■●◆▶►▌█【】\[\]·•]+/g, '');
const KNOWN = /^(教育背景|教育经历|学历背景|学习经历|实习经历|实习经验|工作经历|工作经验|职业经历|项目经历|项目经验|校园经历|在校经历|社团经历|学生工作|科研经历|科研成果|研究经历|论文发表|发表论文|学术成果|个人优势|个人总结|自我评价|个人评价|专业技能|技能|技能证书|证书|资格证书|技能特长|专业能力|荣誉奖项|获奖经历|获奖情况|荣誉|奖项|荣誉证书|竞赛经历|比赛经历|志愿经历|志愿者经历|兴趣爱好|个人信息|基本信息|联系方式|作品集|作品|个人作品|开源贡献|开源项目|语言能力|语言|培训经历|其他|其他信息|求职意向|个人简介|个人亮点|核心优势|核心能力|相关经历|课外活动|领导经历|education|experience|work experience|professional experience|employment|internships?|projects?|skills|technical skills|awards|honors|honors & awards|publications|research|research experience|activities|leadership|summary|profile|certifications?|languages|interests|volunteer|extracurricular|contact)$/i;
const KNOWN_TAIL = /(经历|经验|技能|背景|优势|奖项|荣誉|评价|总结|竞赛|成果|证书|作品|信息|简介|能力|项目|贡献)$/;
const DATE_RE = /((?:19|20)\d{2}\s*[.\-/年]\s*\d{1,2}\s*月?(?:\s*[.\-/]\s*\d{1,2})?)\s*(?:[-–—~～至到]+|to)\s*((?:19|20)\d{2}\s*[.\-/年]\s*\d{1,2}\s*月?|至今|现在|今|present|now|current)|((?:19|20)\d{2}\s*[.\-/年]\s*\d{1,2}\s*月?)|((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(?:19|20)\d{2})|((?:19|20)\d{2}\s*[-–—]\s*(?:(?:19|20)\d{2}|present|now))/i;
const FOOTER_RE = /^(\d+\s*(\/|of)\s*\d+|第\s*\d+\s*页(\s*\/?\s*共\s*\d+\s*页)?|page\s*\d+(\s*of\s*\d+)?|-\s*\d+\s*-)$/i;

interface P {
  v: VPara;
  base: Base;
  text: string;
  html: string;
  right: string;
  imgStart: boolean;
  date: boolean;
  bold: number;     // 加粗字数比例
  flow: 'top' | 'side' | 'main';
  role: Role;
  level: number;    // 经历标题层级
}

export interface Parsed { doc: Resume; stats: { sections: number; entries: number; lines: number } }

/** 证件照：第一页上部、竖向比例、尺寸合理的最大位图 */
function pickPhoto(ex: Extracted): ImgBox | null {
  const p0 = ex.pages[0];
  return ex.images.filter(i => i.raster && i.page === 0 && i.top < p0.h * 0.4 && i.h > 45 && i.w > 34 && i.h / i.w > 0.9 && i.h / i.w < 1.8 && i.w < p0.w * 0.35)
    .sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
}

const textOf = (v: VPara) => v.lines.map(l => l.items.map(i => (i.t === 'run' ? i.r.text : '')).join('')).join('').trim();

export function fontKeyOf(name: string): FontKey | null {
  if (/yahei|雅黑|msyh/i.test(name)) return 'yahei';
  if (/simhei|heiti|\bhei\b|黑体/i.test(name)) return 'hei';
  if (/kai|楷/i.test(name)) return 'kai';
  if (/fang ?song|仿宋/i.test(name)) return 'fang';
  if (/song|simsun|宋|serif|mincho|ming/i.test(name)) return 'song';
  if (/ping ?fang|noto ?sans|source ?han ?sans|hiragino|sans|苹方|思源黑/i.test(name)) return 'yahei';
  return null;
}
const CANON: [RegExp, string][] = [[/^arial/i, 'Arial'], [/^helvetica ?neue/i, 'Helvetica Neue'], [/^helvetica/i, 'Helvetica'], [/^times/i, 'Times New Roman'], [/^georgia/i, 'Georgia'], [/^calibri/i, 'Calibri'], [/^cambria/i, 'Cambria'], [/^garamond/i, 'Garamond'], [/^courier/i, 'Courier New'], [/^verdana/i, 'Verdana']];
function latinName(f: string) {
  const name = f.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  for (const [re, n] of CANON) if (re.test(name)) return n;
  return name;
}

export function buildResume(ex: Extracted): Parsed {
  const photo = pickPhoto(ex);
  const L = analyzeLayout(ex, { photo });
  const pageW = ex.pages[0].w, pageH = ex.pages[0].h;

  // 去掉页码页脚
  // 浏览器打印时自动加的页眉页脚（日期时间、网页标题、file:// 地址、页码）：出现在页边、字号小
  const inMargin = (v: VPara) => v.top < ex.pages[v.page].h * 0.035 || v.bottom > ex.pages[v.page].h * 0.965;
  const PRINT_RE = /^\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?\s+\d{1,2}:\d{2}|^(file|https?):\/\/\S+|^\d+\s*\/\s*\d+$/i;
  const printed = L.paras.some(v => inMargin(v) && PRINT_RE.test(textOf(v)));
  // 浏览器页眉页脚是小字（≤ 9pt 左右）；大字的姓名即使离纸边很近也不能删
  const printLine = (v: VPara) => printed && inMargin(v) && v.lines.length === 1 && v.size <= 9.5;
  const vparas = L.paras.filter(v => !(v.top > ex.pages[v.page].h * 0.93 && FOOTER_RE.test(textOf(v))) && !printLine(v));

  // 正文字号：按字数统计最多的字号
  const sizeW = new Map<number, number>();
  for (const v of vparas) for (const l of v.lines) for (const it of l.items) if (it.t === 'run') { const k = Math.round(it.r.size * 4) / 4; sizeW.set(k, (sizeW.get(k) ?? 0) + it.r.text.length); }
  const body = [...sizeW.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;

  const sideCol = L.cols?.sideCol ?? -1;
  const allPs: P[] = vparas.map(v => {
    const base = baseOf(v.lines);
    const { html, right } = paraHtml(v, base, ex.fills);
    const text = textOf(v);
    const first = v.lines[0].items[0];
    let b = 0, n = 0;
    v.lines.forEach(l => l.items.forEach(i => { if (i.t === 'run') { const k = i.r.text.replace(/\s/g, '').length; n += k; if (i.r.bold) b += k; } }));
    const flow: P['flow'] = !L.cols ? 'main' : v.col === 0 ? (v.page === 0 ? 'top' : 'main') : v.col === sideCol ? 'side' : 'main';
    return { v, base, text, html, right, imgStart: first?.t === 'img', date: DATE_RE.test(text + ' ' + right.replace(/<[^>]+>/g, '')), bold: n ? b / n : 0, flow, role: 'body' as Role, level: 0 };
  }).filter(p => p.text || p.html.includes('<img'));
  // 表格格子里的段落单独处理（不参与姓名、标题、经历的识别）
  const cellPs = allPs.filter(p => p.v.col >= 10);
  const ps = allPs.filter(p => p.v.col < 10);

  // ---------- 姓名 ----------
  const early = ps.filter(p => p.v.page === 0).slice(0, 8);
  // 姓名：第一页开头字号最大的一段（同一行右侧可能还有求职意向等小字，所以看最大字号）
  const maxSize = (p: P) => Math.max(...p.v.lines[0].items.map(i => (i.t === 'run' ? i.r.size : 0)));
  let name = early.reduce<P | null>((m, p) => (p.v.lines.length === 1 && (!m || maxSize(p) > maxSize(m)) ? p : m), null);
  if (name && maxSize(name) < body * 1.3) name = null;
  // 没有明显更大的字号时（Word 转来的简历常见）：第一段短文字且不是模块名，当作姓名
  if (!name && early[0] && early[0].v.lines.length === 1 && clean0(early[0].text).length <= (isCjk(early[0].text) ? 6 : 30) && !KNOWN.test(clean0(early[0].text)) && !/[|｜@:：]|\d{5,}/.test(early[0].text)) name = early[0];
  if (name) name.role = 'name';

  // ---------- 模块标题：先用常见标题名找到标题的样子，再把同样样子的段落都当作标题 ----------
  const clean = (t: string) => t.replace(/[\s:：|｜■●◆▶►▌█【】\[\]·•]+/g, '');
  const cand = (p: P) => p.role === 'body' && p.v.lines.length === 1 && !p.v.list && !p.right &&
    clean(p.text).length > 0 && clean(p.text).length <= (isCjk(p.text) ? 14 : 34) && !/[，。；,;@]|\d{3,}/.test(p.text) && !p.date;
  const sig = (p: P) => [Math.round((p.base.size / body) * 10), p.base.bold ? 1 : 0, hex(p.base.color.map(c => Math.round(c / 40) * 40) as RGB), p.v.bg ? hex(p.v.bg.color.map(c => Math.round(c / 40) * 40) as RGB) : '-', p.v.rule ? 1 : 0, p.v.bar ? 1 : 0, p.text === p.text.toUpperCase() && /[A-Z]/.test(p.text) ? 1 : 0].join('|');
  const prominent = (p: P) => p.base.size >= body * 1.1 || p.bold > 0.6 || !!p.v.bg || !!p.v.rule || !!p.v.bar || (p.text === p.text.toUpperCase() && /[A-Z]{3}/.test(p.text));
  const groups = new Map<string, P[]>();
  ps.filter(p => cand(p) && prominent(p)).forEach(p => { const k = sig(p); groups.set(k, [...(groups.get(k) ?? []), p]); });
  let best: { k: string; known: number; size: number } | null = null;
  for (const [k, g] of groups) {
    const known = g.filter(p => KNOWN.test(clean(p.text))).length + g.filter(p => KNOWN_TAIL.test(clean(p.text))).length * 0.5;
    const size = g[0].base.size;
    if (!known && g.length < 2) continue;
    if (!best || known > best.known || (known === best.known && size > best.size)) best = { k, known, size };
  }
  if (best) {
    for (const p of groups.get(best.k)!) p.role = 'title';
    // 同样样子、但文字更长的标题（如“AI Startup 兼职 & 开源项目：github.com/…”）
    const big = groups.get(best.k)![0].base.size >= body * 1.25;
    const noSize = (k: string) => { const a = k.split('|'); return [a[3], a[4], a[5]].join('|'); }; // 只比底色、下划线、竖条
    for (const p of ps) if (p.role === 'body' && big && p.v.lines.length === 1 && !p.v.list && p.text.length <= 70 && p.base.size >= body * 1.15 && p.bold > 0.3 && (p.v.rule || p.v.bg || p.v.bar) && noSize(sig(p)) === noSize(best.k)) p.role = 'title';
  }
  // 样子不同但名字明确的标题（例如原稿里某个标题单独换了颜色）
  for (const p of ps) if (cand(p) && prominent(p) && KNOWN.test(clean(p.text)) && p.role === 'body') p.role = 'title';

  // ---------- 页眉：第一个标题之前的段落 ----------
  const doc = blankResume();
  doc.header.items = [];
  doc.side = [];
  doc.body = [];
  const firstTitle = (flow: P['flow']) => ps.findIndex(p => p.flow === flow && p.role === 'title');
  const headerPs: P[] = [];
  if (!L.cols) {
    const ft = firstTitle('main');
    ps.forEach((p, i) => { if (ft < 0 ? p === name : i < ft) headerPs.push(p); });
  } else {
    ps.forEach(p => { if (p.flow === 'top') headerPs.push(p); });
    if (name && name.flow === 'side') {
      const ft = firstTitle('side');
      ps.forEach((p, i) => { if (p.flow === 'side' && (ft < 0 ? p === name : i < ft)) headerPs.push(p); });
      doc.header.place = 'side';
    } else if (name && name.flow === 'main' && !headerPs.length) {
      // 姓名在主栏顶部（侧栏从页顶开始）：页眉放在主栏里
      const ft = firstTitle('main');
      ps.forEach((p, i) => { if (p.flow === 'main' && p.v.page === 0 && (ft < 0 ? p === name : i < ft)) headerPs.push(p); });
      doc.header.place = 'main';
    }
  }
  const inHeader = new Set(headerPs);

  // ---------- 经历标题：按“视觉重要程度”自动分层，而不是套固定的 单位|职位|时间 ----------
  const keyStart = (p: P) => /^<b>[^<]{1,24}[：:]<\/b>/.test(p.html) || /^<b>[^<]{1,24}<\/b>[：:]/.test(p.html);
  const headCand = (p: P) => p.role === 'body' && !inHeader.has(p) && !p.v.list && !!p.text && p.v.lines.length <= 2 && !keyStart(p) && !/[：:]$/.test(p.text) &&
    (!!p.right || (p.date && p.text.length < 90) || p.imgStart || (!!p.v.bg && p.text.length < 90) || (p.bold > 0.7 && p.text.length <= (p.v.lines.length === 1 ? 130 : 80)) || (p.base.size >= body * 1.08 && p.text.length <= 60));
  const rankOf = (p: P) => (p.imgStart || p.v.bg ? 20 : 0) + (p.right || p.date ? 10 : 0) + (p.base.size >= body * 1.18 ? 5 : 0) + (p.bold > 0.7 && !p.imgStart && !p.date && !p.right ? 1 : 0);
  const hsig = (p: P) => [p.base.size >= body * 1.18 ? 1 : 0, p.bold > 0.7 && !p.imgStart && !p.date && !p.right ? 1 : 0, hex(p.base.color.map(c => Math.round(c / 48) * 48) as RGB), p.imgStart || p.v.bg ? 1 : 0, p.right || p.date ? 1 : 0].join('|');
  const sigRank = new Map<string, number[]>();
  ps.filter(headCand).forEach(p => { const k = hsig(p); sigRank.set(k, [...(sigRank.get(k) ?? []), rankOf(p)]); });
  const rankOfSig = (p: P) => { const r = sigRank.get(hsig(p))!; return r.reduce((a, b) => a + b, 0) / r.length; };

  const toPara = (p: P, role: Role): Para => mkPara(p.html, { role, right: p.right || (role === 'head' || role === 'sub' ? '' : undefined) });
  const meta = new Map<Para, P>();

  const buildFlow = (list: P[]): Block[] => {
    const out: Block[] = [];
    let sec: Group | null = null;
    let stack: { g: Group; rank: number }[] = [];
    for (const p of list) {
      if (p.role === 'title') {
        const head = toPara(p, 'title'); meta.set(head, p);
        sec = { id: uid('s'), kind: 'group', role: 'section', head, items: [] };
        out.push(sec); stack = [];
        continue;
      }
      const target = () => stack.length ? stack[stack.length - 1].g.items : sec ? sec.items : out;
      // 粗体标题下面紧跟一行普通字的时间地点（“Barcelona · 2022 – Present”）：属于这条经历，不是新的经历
      const top = stack[stack.length - 1];
      // 只认“基本只有时间（加上地点）”的短行，带公司名的普通字时间行仍是新经历
      const rest = p.text.replace(DATE_RE, '').replace(/[\s·|｜,，-]/g, '');
      const plainDate = p.date && !p.right && !p.v.bg && !p.imgStart && p.bold < 0.3 && p.base.size <= body * 1.05 && rest.length <= (isCjk(rest) ? 6 : 14);
      if (top && plainDate && !meta.get(top.g.head)?.date && !top.g.head.right) {
        const para = toPara(p, 'body'); meta.set(para, p);
        top.g.items.push(para);
        continue;
      }
      if (sec && headCand(p)) {
        const r = rankOfSig(p);
        while (stack.length && stack[stack.length - 1].rank <= r + 0.01) stack.pop();
        p.level = stack.length;
        const head = toPara(p, stack.length ? 'sub' : 'head'); meta.set(head, p);
        const g: Group = { id: uid('e'), kind: 'group', role: 'entry', head, items: [] };
        target().push(g);
        stack.push({ g, rank: r });
        continue;
      }
      const para = toPara(p, 'body'); meta.set(para, p);
      target().push(para);
    }
    // 没有内容的“经历标题”其实是普通段落（如带时间的获奖条目）
    const demote = (items: Block[]) => {
      for (let i = 0; i < items.length; i++) {
        const b = items[i];
        if (b.kind !== 'group') continue;
        demote(b.items);
        if (b.role === 'entry' && !b.items.length) { const h = b.head; h.role = 'body'; if (!h.right) delete h.right; items[i] = h; }
      }
    };
    demote(out);
    // 子标题提升：只有子标题、没有上一级时，保持经历标题样式
    const fixRoles = (items: Block[], depth: number) => items.forEach(b => { if (b.kind === 'group') { if (b.role === 'entry') b.head.role = depth === 0 ? 'head' : 'sub'; fixRoles(b.items, b.role === 'section' ? 0 : depth + 1); } });
    fixRoles(out, 0);
    return out;
  };

  const headerParas = headerPs.map(p => { const x = toPara(p, p === name ? 'name' : 'body'); meta.set(x, p); return x; });
  doc.header.items = headerParas.length ? headerParas : [mkPara('', { role: 'name' })];
  const restMain = ps.filter(p => !inHeader.has(p) && p.flow !== 'side');
  const restSide = ps.filter(p => !inHeader.has(p) && p.flow === 'side');
  doc.body = buildFlow(restMain);
  doc.side = buildFlow(restSide);

  // ---------- 样式 ----------
  const style = detectStyle(ex, { ps, body, name, meta, L, photo, headerPs });
  doc.style = style.s;
  // ---------- 表格 ----------
  const photoInCell = buildTables(doc, L, cellPs, meta, photo, ex, body);
  // 正文以表格开头：页眉与正文的间距按到表格上框的距离算
  const lastHead = headerPs[headerPs.length - 1];
  if (doc.body[0]?.kind === 'table' && lastHead && !L.cols) {
    const t0 = L.tables.find(t => t.page === lastHead.v.page && t.y0 > lastHead.v.bottom);
    const lh = lastHead === name ? 1.3 : doc.style.lineHeight;
    if (t0) doc.style.headGap = r1(clamp(t0.y0 - lastHead.v.bottom - (lh - 1) / 2 * lastHead.base.size + lastHead.base.size * 0.1, 0, 40));
  }
  applyParaStyles(doc, meta, style, body);
  tidyCells(doc);
  applyFrame(doc, L, ps, body, pageW);

  // 两栏版式里照片不在页眉那一栏：作为那一栏里的图片
  let photoInFlow = false;
  if (photo && !photoInCell && L.cols && doc.header.place !== 'side') {
    const cx = photo.x + photo.w / 2;
    const sideRg = L.regions.find(r => r.page === 0 && r.col === L.cols!.sideCol);
    if (sideRg && cx >= sideRg.x0 && cx <= sideRg.x1) {
      const em = (v: number) => +(v / body).toFixed(3) + 'em';
      const pic = mkPara(`<img class="ri" src="${photo.src}" style="width:${em(photo.w)};height:${em(photo.h)}" alt="">`);
      const left = Math.min(...ps.filter(p => p.flow === 'side').map(p => p.v.markerX ?? p.v.x));
      if (photo.x - left > body) pic.ind = r2((photo.x - left) / body);
      doc.side.unshift(pic);
      photoInFlow = true;
      // 照片比正文第一行更靠上：上边距按照片算，主栏第一段补上差值
      const dv = doc.style.marginV - photo.top * PT_MM;
      if (dv > 0.5 && doc.header.items[0]) { doc.style.marginV = r1(photo.top * PT_MM); doc.header.items[0].sb = r1((doc.header.items[0].sb ?? 0) + dv / PT_MM); }
    }
  }
  // 侧栏页眉：照片在姓名上方，姓名的段前距从照片下沿算（.rs-side .rs-photo 下方有 3mm）
  if (photo && !photoInCell && !photoInFlow && doc.header.place === 'side' && doc.header.items[0]) {
    const fp = meta.get(doc.header.items[0]);
    if (fp && fp.v.top > photo.top + photo.h) doc.header.items[0].sb = r1(Math.max(0, fp.v.top - (photo.top + photo.h) - (doc.header.items[0].role === 'name' ? 0.15 : (doc.style.lineHeight - 1) / 2) * fp.base.size - 3 / PT_MM));
  }
  if (photo && !photoInCell && !photoInFlow) {
    doc.header.photo = photo.src; doc.header.photoVisible = true;
    // 原稿页眉文字离照片还有距离：居中时不再给照片两侧额外留白，保持原稿的行宽
    if (headerPs.every(p => p.v.xEnd < photo.x - 2 || p.v.top > photo.top + photo.h)) doc.header.noPad = true;
  } else {
    // 原稿没有证件照：编辑器里仍显示一个待选框（不占排版位置，导出时没有），方便直接添加；照片已在表格 / 文字里的除外
    doc.header.photo = null; doc.header.photoVisible = !photoInCell && !photoInFlow;
  }
  // 不在文字行里的图片（徽章、装饰）：按原位置绝对定位（.rs 的坐标原点在纸张左上角、顶部色条下方）
  doc.floats = L.floats.filter(f => f.page === 0 && f.w < pageW * 0.5 && f.h < pageH * 0.3).map(f => ({ id: uid('f'), src: f.src, x: +(f.x * PT_MM).toFixed(2), y: +(f.top * PT_MM - (style.s.topBar ? 3.4 : 0)).toFixed(2), w: +(f.w * PT_MM).toFixed(2), h: +(f.h * PT_MM).toFixed(2) }));
  // 页眉通栏底色：第一页顶部一块几乎和纸一样宽、盖住页眉文字的色块
  if (headerPs.length && doc.header.place === 'top') {
    const first = headerPs[0].v, last = headerPs[headerPs.length - 1].v;
    const fill = ex.fills.find(f => f.page === 0 && f.w > pageW * 0.92 && f.top < first.top && f.top + f.h >= last.bottom - 1 && f.top < 40);
    if (fill && !isPaper(fill.color)) {
      doc.header.bg = hex(fill.color);
      doc.header.items.forEach(x => { delete x.bg; });
      doc.header.padB = +Math.max(0, ((fill.top + fill.h) - last.bottom) * PT_MM - (doc.style.fontSize * (doc.style.lineHeight - 1) / 2) * PT_MM).toFixed(1);
      // 色块从纸边开始：页眉第一段的段前距按色块内的位置算
      const fp = doc.header.items[0];
      const fm = meta.get(fp);
      if (fm) fp.sb = r1(Math.max(0, fm.v.top - fill.top - doc.style.fontSize * (doc.style.lineHeight - 1) / 2 - doc.style.marginV / PT_MM));
      const nextTop = ps.find(p => !inHeader.has(p))?.v.top;
      if (nextTop !== undefined) doc.style.headGap = r1(Math.max(0, nextTop - (fill.top + fill.h) - doc.style.fontSize * (doc.style.lineHeight - 1) / 2));
    }
  }
  // 页眉下方的通栏分隔线
  const lastH = headerPs[headerPs.length - 1], firstB = ps.find(p => !inHeader.has(p) && p.v.page === 0);
  if (lastH && firstB && doc.header.place === 'top' && !doc.header.bg) {
    const hb = Math.max(...headerPs.filter(p => p.v.page === 0).map(p => p.v.bottom));
    const r = ex.rules.find(r => r.page === 0 && !r.grid && r.y > hb && r.y < firstB.v.top && r.xEnd - r.x > (pageW - 2 * doc.style.marginH / PT_MM) * 0.8);
    if (r) {
      const half = (doc.style.lineHeight - 1) / 2 * lastH.base.size;
      doc.header.rule = { color: hex(r.color), w: r2(r.t), gap: r1(Math.max(0, r.y - hb - half - r.t / 2)) };
      doc.style.headGap = r1(Math.max(0, firstB.v.top - r.y - r.t / 2 - (doc.style.lineHeight - 1) / 2 * firstB.base.size));
    }
  }
  if (ex.kind === 'pdf') doc.srcPages = ex.pages.length;
  const intent = guessIntent(doc);
  doc.title = [doc.header.items.find(x => x.role === 'name')?.html.replace(/<[^>]+>/g, '').trim(), intent].filter(Boolean).join('-') || '我的简历';
  return { doc, stats: countStats(doc) };
}

function guessIntent(doc: Resume) {
  for (const l of doc.header.items) {
    const t = l.html.replace(/<[^>]+>/g, '');
    const m = t.match(/(?:求职意向|意向岗位|应聘岗位|求职方向|目标岗位)[:：]\s*([^|｜\s]+(?:\s[^|｜\s]+)?)/);
    if (m) return m[1].trim();
  }
  return '';
}

interface Ctx { ps: P[]; body: number; name: P | null; meta: Map<Para, P>; L: ReturnType<typeof analyzeLayout>; photo: ImgBox | null; headerPs: P[] }
interface Detected { s: StyleConfig; accent: RGB; ink: RGB; colLeft: (p: P) => number }

const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const r1 = (v: number) => +v.toFixed(1);
const r2 = (v: number) => +v.toFixed(2);

/** 还原“样式 DNA”：纸张、字体、字号、行距、间距、边距、主题色、各级标题外观、两栏 */
function detectStyle(ex: Extracted, c: Ctx): Detected {
  const s: StyleConfig = structuredClone(BASE_STYLE);
  const p0 = ex.pages[0];
  const wmm = p0.w * PT_MM, hmm = p0.h * PT_MM;
  s.page = KNOWN_PAGES.find(p => Math.abs(p.w - wmm) < 3 && Math.abs(p.h - hmm) < 3) ?? { name: '原稿', w: r1(wmm), h: r1(hmm) };
  s.fontSize = r2(c.body);

  // 字体
  const cjk = new Map<string, number>(), lat = new Map<string, number>();
  for (const r of ex.runs) {
    const n = r.text.length;
    if (isCjk(r.text)) cjk.set(r.font, (cjk.get(r.font) ?? 0) + n);
    else if (/[A-Za-z0-9]/.test(r.text) && !r.mono) lat.set(r.font, (lat.get(r.font) ?? 0) + n);
  }
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const ck = fontKeyOf(top(cjk));
  if (ck) s.font = ck;
  const CJK_NAMES: [RegExp, string][] = [[/ping ?fang/i, 'PingFang SC'], [/hiragino ?sans/i, 'Hiragino Sans GB'], [/source ?han ?sans|noto ?sans ?(sc|cjk)/i, 'Noto Sans SC'], [/source ?han ?serif|noto ?serif/i, 'Noto Serif SC'], [/songti|stsong/i, 'Songti SC'], [/stheiti|heiti ?sc/i, 'Heiti SC'], [/kaiti ?sc|stkaiti/i, 'Kaiti SC']];
  const cjkHit = CJK_NAMES.find(([re]) => re.test(top(cjk).replace(/\s/g, '')));
  if (cjkHit) s.cjk = cjkHit[1];
  const lf = top(lat);
  s.latin = lf && !fontKeyOf(lf) && !isCjk(lf) ? latinName(lf) : '';
  if (s.latin && /^(ping|hiragino|microsoft|noto sans cjk|source han)/i.test(s.latin)) s.latin = '';

  // 颜色：正文色、主题色
  const inkC = clusterColors(c.ps.filter(p => p.role === 'body').map(p => ({ c: p.base.color, w: p.text.length })))[0]?.c ?? [22, 22, 22];
  s.ink = hex(inkC);
  const sat: { c: RGB; w: number }[] = [];
  for (const p of c.ps) {
    if (p.role === 'title') sat.push({ c: p.base.color, w: 400 });
    if (p.v.bg && p.role === 'title') sat.push({ c: p.v.bg.color, w: 300 });
    if (p.v.rule && p.role === 'title') sat.push({ c: p.v.rule.color, w: 300 });
    if (p.v.bar) sat.push({ c: p.v.bar, w: 300 });
    for (const l of p.v.lines) for (const it of l.items) if (it.t === 'run') sat.push({ c: it.r.color, w: it.r.text.length });
  }
  const accentC = clusterColors(sat.filter(x => isAccent(x.c)))[0]?.c ?? null;
  const accent: RGB = accentC ?? [47, 91, 211];
  s.accent = hex(accent);

  // 顶部色条
  const bar = ex.fills.find(f => f.page === 0 && f.top < 2 && f.w > p0.w * 0.95 && f.h >= 2 && f.h < 16);
  s.topBar = bar ? hex(bar.color) : null;

  // 栏与边距
  const colX = new Map<string, number>();
  for (const p of c.ps) {
    const k = p.v.page + ':' + p.v.col;
    if (p.v.bg?.bleed) continue;
    colX.set(k, Math.min(colX.get(k) ?? 1e9, p.v.markerX ?? p.v.x));
  }
  const colLeft = (p: P) => colX.get(p.v.page + ':' + p.v.col) ?? 0;
  const page0 = c.ps.filter(p => p.v.page === 0);
  const minX = Math.min(...page0.map(p => p.v.bg?.bleed ? p.v.x : (p.v.markerX ?? p.v.x)));
  const rights = c.ps.filter(p => p.v.lines.length > 1 && !c.L.cols).flatMap(p => p.v.lines.slice(0, -1).map(l => l.xEnd));
  const maxR = c.L.cols || !rights.length ? Math.max(...page0.map(p => p.v.xEnd)) : Math.max(...rights);
  // 保持原稿的正文宽度：换行位置才能一致
  const contentW = Math.min(p0.w, maxR - minX + c.body * 0.3);
  s.marginH = r1(clamp(((p0.w - contentW) / 2) * PT_MM, 3, 30));
  const firstTop = (page: number) => Math.min(...c.ps.filter(p => p.v.page === page).map(p => p.v.bg?.bleed ? p.v.top + 2 : p.v.top));
  const t0 = firstTop(0) - (bar ? bar.h : 0);
  const t1 = ex.pages.length > 1 && c.ps.some(p => p.v.page === 1) ? firstTop(1) : NaN;
  const topMm = (v: number) => v * PT_MM - (s.fontSize * (s.lineHeight - 1) / 2 + 0.5) * PT_MM;
  s.marginV = r1(clamp(isNaN(t1) ? topMm(t0) : topMm(t1), 0, 30));
  // 下边距：原稿排满的页面，最后一行离页底的距离；比上边距小时取小的（否则会多出一页）
  const nPages = Math.max(...c.ps.map(p => p.v.page)) + 1;
  const bottoms: number[] = [];
  for (let pg = 0; pg < nPages; pg++) {
    const onPage = c.ps.filter(p => p.v.page === pg);
    if (!onPage.length) continue;
    const gap = ex.pages[pg].h - Math.max(...onPage.map(p => p.v.bottom));
    if (pg < nPages - 1 || gap < ex.pages[pg].h * 0.08) bottoms.push(gap);
  }
  if (bottoms.length && ex.kind !== 'html') s.marginV = r1(clamp(Math.min(s.marginV, Math.min(...bottoms) * PT_MM - 1.5), 0, 30));

  // 行距：多行段落里相邻两行的距离
  const pitches: number[] = [];
  for (const p of c.ps) for (let i = 1; i < p.v.lines.length; i++) {
    const a = p.v.lines[i - 1], b = p.v.lines[i];
    if (a.page === b.page && b.top > a.top) pitches.push((b.top - a.top) / p.base.size);
  }
  const lh = median(pitches);
  if (!isNaN(lh)) s.lineHeight = r2(clamp(lh, 1, 2.2));

  // 间距：上一段最后一行到这一段第一行的距离，减去一个行距
  const roleOf = new Map<P, Role>();
  for (const [pp, x] of c.meta) roleOf.set(x, pp.role);
  const gapsBy: Record<'title' | 'head' | 'body' | 'afterTitle' | 'afterHead', number[]> = { title: [], head: [], body: [], afterTitle: [], afterHead: [] };
  const inHead = new Set(c.headerPs);
  let headGapV = NaN;
  const sideBody: number[] = [];
  for (const flow of ['main', 'side'] as const) {
    const list = c.ps.filter(p => (flow === 'main' || !inHead.has(p)) && (p.flow === flow || (flow === 'main' && p.flow === 'top')));
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1], b = list[i];
      const la = a.v.lines[a.v.lines.length - 1];
      if (la.page !== b.v.page || b.v.top <= la.top || a.v.col !== b.v.col || !a.text || !b.text) continue;
      const fb0 = b.v.lines[0];
      // 一行里字号不同时，行高由最大的字决定
      const big = (l: typeof la) => ({ ...l, size: Math.max(l.size, ...l.items.concat(l.right).map(i => (i.t === 'run' ? i.r.size : 0))) });
      const fb = big(fb0);
      const laB = big(la);
      const tallA = laB.bottom - laB.top > laB.size * s.lineHeight * 1.05, tallB = fb.bottom - fb.top > fb.size * s.lineHeight * 1.05;
      // 用基线距离：CSS 里相邻两行基线距离 = 两行行高的一半之和 + 段间距
      const baseOf = (l: typeof la) => { const r = l.items.find(i => i.t === 'run'); return r && r.t === 'run' ? r.r.top + r.r.size * 0.88 : l.top + l.size * 0.88; };
      let gap = tallA || tallB
        ? (b.v.top - la.bottom) - (tallB ? 0 : (s.lineHeight - 1) / 2 * fb.size) - (tallA ? 0 : (s.lineHeight - 1) / 2 * laB.size)
        : (baseOf(fb) - baseOf(la)) - s.lineHeight * (laB.size + fb.size) / 2 - 0.38 * (fb.size - laB.size);
      const padOf = (p: P) => (p.v.bg || p.v.bar ? 0.85 : 0) + (p.v.rule ? 1.2 + p.v.rule.t : 0);
      gap -= padOf(a) + (b.v.bg || b.v.bar ? 0.85 : 0);
      const ra = roleOf.get(a), rb = roleOf.get(b);
      if (inHead.has(a) !== inHead.has(b)) { headGapV = gap; continue; }
      if (ra === 'title') gapsBy.afterTitle.push(gap);
      else if (ra === 'head' || ra === 'sub') gapsBy.afterHead.push(gap);
      else if (rb === 'title') gapsBy.title.push(gap);
      else if (rb === 'head') gapsBy.head.push(gap);
      else if (rb === 'body') (flow === 'side' ? sideBody : gapsBy.body).push(gap);
    }
  }
  const g = (a: number[], d: number) => { const m = median(a); return isNaN(m) ? d : r1(clamp(m, 0, 30)); };
  s.paraGap = g(gapsBy.body, s.paraGap);
  s.itemGap = g(gapsBy.head, Math.max(s.paraGap, s.itemGap));
  s.sectionGap = g(gapsBy.title, s.sectionGap);
  if (!isNaN(headGapV) && !c.L.cols) s.headGap = r1(clamp(headGapV, 0, 40));
  if (c.L.cols) {
    const sc = c.L.cols;
    s.cols = { side: sc.side, w: r1(sc.w * PT_MM + 0.5), gap: r1(sc.gap * PT_MM), bg: sc.bg && !isPaper(sc.bg) ? hex(sc.bg) : '', ink: '' };
    if (sc.bg && sc.side === 'left') {
      // 有侧栏底色：以底色边界为准，栏间距左右对称，主栏文字起点与原稿一致
      const L1 = s.marginH / PT_MM;
      const half = Math.max(2, sc.mainLeft - sc.edge);
      const rightPad = Math.min(L1, half) * 0.78; // 侧栏右侧内边距：通常与左侧内边距接近
      s.cols.w = r1((sc.edge - rightPad - L1) * PT_MM);
      s.cols.gap = r1((sc.mainLeft - (L1 + (sc.edge - rightPad - L1))) * PT_MM);
      s.cols.edge = r1(sc.edge * PT_MM);
    }
    if (sc.side === 'right') {
      // 右侧栏：右边距按侧栏文字到纸边的距离，左边距按主栏文字起点；两者可以不同
      const side = c.ps.filter(p => p.flow === 'side'), main = c.ps.filter(p => p.flow === 'main' && p.v.page === 0);
      const sideRight = Math.max(...side.map(p => p.v.xEnd)), mainRight = Math.max(...main.map(p => p.v.xEnd));
      const mainLeft = Math.min(...main.map(p => p.v.markerX ?? p.v.x));
      if (isFinite(sideRight) && isFinite(mainRight) && isFinite(mainLeft)) {
        s.marginH = r1(clamp(mainLeft * PT_MM, 3, 30));
        s.marginR = r1(clamp((p0.w - sideRight) * PT_MM - 1, 2, 30));
        s.cols.w = r1((sideRight - sc.sideLeft) * PT_MM + 1);
        s.cols.gap = r1(Math.max(2, (sc.sideLeft - mainRight) * PT_MM - 1));
        if (sc.bg) s.cols.edge = r1(sc.edge * PT_MM);
      }
    }
    const sideG = median(sideBody);
    if (!isNaN(sideG) && Math.abs(sideG - s.paraGap) > 1) s.cols.pg = r1(clamp(sideG, 0, 30));
    const sideInk = clusterColors(c.ps.filter(p => p.flow === 'side' && p.role === 'body').map(p => ({ c: p.base.color, w: p.text.length })))[0]?.c;
    if (sideInk && dist(sideInk, inkC) > 40) s.cols.ink = hex(sideInk);
  }

  // 页眉
  if (c.name) {
    const nl = c.name.v.lines[0];
    const mid = (nl.x + nl.xEnd) / 2; // 只看姓名本身，不算同一行右侧的联系方式
    const L = colLeft(c.name), R = p0.w - (L);
    s.headerAlign = Math.abs(mid - (L + R) / 2) < p0.w * 0.06 ? 'center' : 'left';
  } else s.headerAlign = 'left';
  if (c.photo) { s.photoW = r1(c.photo.w * PT_MM); s.photoH = r1(c.photo.h * PT_MM); }

  // 各级标题外观
  const tok = (col: RGB | null | undefined, fallbackInk = true) => !col ? '' : dist(col, accent) < 34 && accentC ? 'accent' : fallbackInk && dist(col, inkC) < 34 ? '' : hex(col);
  const lookOf = (members: P[], role: Role): Look | null => {
    if (!members.length) return null;
    const p = members[Math.min(1, members.length - 1)]; // 第二个往往比第一个更典型（第一个可能贴着页眉）
    const sizes = members.map(m => m.base.size);
    const l: Look = { fs: r2(median(sizes) / c.body), bold: p.base.bold, color: tok(p.base.color), bg: '', bar: '', rule: '', ruleW: 0, pad: 0, ls: 0 };
    if (p.v.bg) {
      l.bg = tok(p.v.bg.color, false);
      if (accentC && l.bg !== 'accent' && !isWhite(p.v.bg.color) && dist(p.v.bg.color, mixWhite(accent, 0.9)) < 18) l.bg = 'tint';
      l.pad = r1(Math.max(0, (p.v.x - p.v.bg.x) * PT_MM));
      l.bleed = p.v.bg.bleed;
      if (l.bleed) l.pad = r1(Math.max(0, (p.v.x - colLeft(p)) * PT_MM));
    }
    if (p.v.bar) { l.bar = tok(p.v.bar, false); l.pad = Math.max(l.pad, r1(Math.max(1, (p.v.x - colLeft(p)) * PT_MM - 0.8))); }
    if (p.v.rule) { l.rule = tok(p.v.rule.color, false) || hex(p.v.rule.color); l.ruleW = r2(clamp(p.v.rule.t, 0.3, 3)); }
    if (role === 'title' || role === 'head' || role === 'sub') {
      const after = role === 'title' ? gapsBy.afterTitle : gapsBy.afterHead;
      const m = median(after);
      if (!isNaN(m)) l.after = r1(clamp(m, 0, 24));
    }
    return l;
  };
  const byRole = (r: Role) => [...c.meta.entries()].filter(([pp]) => pp.role === r).map(([, P]) => P);
  const nm = lookOf(c.name ? [c.name] : [], 'name'); if (nm) s.looks.name = { ...nm, ls: 0 };
  const tl = lookOf(byRole('title'), 'title'); if (tl) s.looks.title = tl;
  const hd = lookOf(byRole('head'), 'head'); if (hd) s.looks.head = hd;
  const sb = lookOf(byRole('sub'), 'sub'); if (sb) s.looks.sub = sb;
  return { s, accent, ink: inkC, colLeft };
}

const mixWhite = (c: RGB, k: number): RGB => c.map(v => v + (255 - v) * k) as RGB;

/** 每段与所属角色外观不同的地方（字号、粗细、颜色、缩进、列表符号、底色）写到段落上 */
function applyParaStyles(doc: Resume, meta: Map<Para, P>, d: Detected, body: number) {
  const s = d.s;
  const tok = (col: RGB) => dist(col, d.accent) < 34 ? 'accent' : hex(col);
  for (const [para, p] of meta) {
    const look = para.role === 'body' ? null : s.looks[para.role as Exclude<Role, 'body'>];
    const fs = look?.fs ?? 1;
    const k = p.base.size / body;
    if (Math.abs(k - fs) > 0.04) para.fs = r2(k);
    const bold = look?.bold ?? false;
    if (p.base.bold !== bold) para.bold = p.base.bold;
    const lookColor = look?.color ? (look.color === 'accent' ? d.accent : hexToRgb(look.color)) : (para.role === 'body' && p.flow === 'side' && s.cols?.ink ? hexToRgb(s.cols.ink) : d.ink);
    if (dist(p.base.color, lookColor) > 34) para.color = tok(p.base.color);
    // 列表与缩进（em，相对本段字号）
    if (p.v.list) { para.list = p.v.list; if (p.v.num) para.num = p.v.num; if (p.v.mkColor && dist(p.v.mkColor, p.base.color) > 40) para.mk = tok(p.v.mkColor); }
    const left = d.colLeft(p);
    const textX = p.v.lines.length > 1 && !p.v.list ? Math.min(p.v.lines[0].x, p.v.lines[1].x) : p.v.lines[0].x;
    // 同一角色里原稿没有底色的段落（如经历标题大多有灰底，个别没有）：单独去掉底色和内边距
    const noBg = !!look?.bg && !look.bar && !p.v.bg;
    if (noBg) para.bg = 'none';
    const pad = look && (look.bg || look.bar) && !noBg ? look.pad / PT_MM : 0;
    let ind = (textX - left - pad) / p.base.size;
    if (look?.bleed) ind = 0;
    if (p.v.list) ind = Math.max(ind, 1.1);
    const centered = !!p.v.align || (s.headerAlign === 'center' && doc.header.items.includes(para));
    if (ind > 0.2 && !centered) para.ind = r2(ind);
    if (p.v.firstIndent) para.ti = r2(p.v.firstIndent / p.base.size);
    if (p.v.align && para.role !== 'name' && !(s.headerAlign === 'center' && doc.header.items.includes(para) && p.v.align === 'center')) para.align = p.v.align;
    // 单独的底色（与角色外观不同的才写到段落上）
    if (p.v.bg && !(look?.bg) && !p.v.bg.bleed) para.bg = hex(p.v.bg.color);
  }
  // 圆点形状按嵌套层级取多数：小圆点在位图里不好分辨实心圆、空心圆和方块，同一层级应当一致。
  // 层级按结构算（比上一条更靠右就是下一层），不按绝对缩进：有的简历第二层空心圆和别处第一层实心圆缩进相同
  const depthOf = new Map<Para, number>();
  const walkDepth = (items: Block[]) => {
    const stack: Para[] = [];
    for (const b of items) {
      if (b.kind === 'group') { stack.length = 0; walkDepth(b.items); continue; }
      if (b.kind !== 'para' || !b.list || b.list === 'num') { stack.length = 0; continue; }
      const ind = b.ind ?? 0;
      while (stack.length && (stack[stack.length - 1].ind ?? 0) >= ind - 0.3) stack.pop();
      depthOf.set(b, stack.length);
      stack.push(b);
    }
  };
  walkDepth(doc.body); walkDepth(doc.side);
  const dots = [...depthOf.keys()].filter(x => x.list === 'disc' || x.list === 'circle' || x.list === 'square');
  const byLevel = new Map<number, Map<string, number>>();
  for (const x of dots) { const k = depthOf.get(x)!; const m = byLevel.get(k) ?? new Map(); m.set(x.list!, (m.get(x.list!) ?? 0) + 1); byLevel.set(k, m); }
  const pick = (k: number) => { const m = byLevel.get(k); return m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] as Para['list'] : undefined; };
  // 嵌套列表惯例（网页 / Markdown 导出的简历）：实心圆 → 空心圆 → 方块。第三层的小方块在位图里常被认成圆点
  const nested = pick(0) === 'disc' && pick(1) === 'circle';
  for (const x of dots) { const k = depthOf.get(x)!; x.list = k >= 2 && nested ? 'square' : pick(k); }
  // 第一页顶部留白与其他页不同时（页眉更靠下），记在第一段上
  const first = doc.header.items[0] && meta.get(doc.header.items[0]);
  if (first && first.v.page === 0) {
    const want = first.v.top - (first.base.size * (s.lineHeight - 1) / 2) - (s.topBar ? 3.4 / PT_MM : 0) - s.marginV / PT_MM;
    if (want > 2) doc.header.items[0].sb = r1(Math.min(220, want));
  }
  // 页眉各段：保留原稿的段间距
  const hs = doc.header.items;
  for (let i = 1; i < hs.length; i++) {
    const a = meta.get(hs[i - 1]), b = meta.get(hs[i]);
    if (!a || !b) continue;
    const la = a.v.lines[a.v.lines.length - 1];
    if (la.page !== b.v.page || b.v.top <= la.top) continue;
    const lhA = hs[i - 1].role === 'name' ? 1.3 : s.lineHeight;
    const fb = b.v.lines[0];
    const mx = (l: typeof la) => Math.max(l.size, ...l.items.concat(l.right).map(it => (it.t === 'run' ? it.r.size : 0)));
    const base = (l: typeof la) => { const r = l.items.find(it => it.t === 'run'); return r && r.t === 'run' ? r.r.top + r.r.size * 0.88 : l.top + l.size * 0.88; };
    const sA = mx(la), sB = mx(fb);
    hs[i].sb = r1(clamp(base(fb) - base(la) - lhA * sA / 2 - s.lineHeight * sB / 2 - 0.38 * (sB - sA), 0, 30));
  }
}

// ---------- 表格 ----------
const topKey = (p: P) => p.v.page * 10000 + p.v.top;

/** 按原稿位置把块插进文档：插在最后一个比它靠上的块后面；落在某个分组内容中间时插进该分组 */
function insertByTop(list: Block[], blk: Block, key: number, meta: Map<Para, P>): void {
  const keyOf = (b: Block): number => {
    const p = b.kind === 'para' ? meta.get(b) : b.kind === 'group' ? meta.get(b.head) : undefined;
    return p ? topKey(p) : b.kind === 'table' ? (b as Table & { _k?: number })._k ?? -1 : -1;
  };
  const lastKey = (b: Block): number => b.kind === 'group' && b.items.length ? Math.max(keyOf(b), lastKey(b.items[b.items.length - 1])) : keyOf(b);
  let i = -1;
  for (let j = 0; j < list.length; j++) if (keyOf(list[j]) >= 0 && keyOf(list[j]) < key) i = j;
  const prev = list[i];
  if (prev && prev.kind === 'group' && lastKey(prev) > key) return insertByTop(prev.items, blk, key, meta);
  list.splice(i + 1, 0, blk);
}

/** 表格里不是通栏的行 → 表格块（格子内是普通段落，可以直接编辑）。返回照片是否放进了表格 */
function buildTables(doc: Resume, L: Layout, cellPs: P[], meta: Map<Para, P>, photo: ImgBox | null, ex: Extracted, body: number): boolean {
  let photoUsed = false;
  for (const t of L.tables) {
    const nr = t.ys.length - 1;
    // 连续的非通栏行组成一张表
    for (let r0 = 0; r0 < nr; r0++) {
      if (t.full[r0]) continue;
      let rEnd = r0; while (rEnd + 1 < nr && !t.full[rEnd + 1]) rEnd++;
      const W = t.xs[t.xs.length - 1] - t.xs[0];
      const pads: number[] = [];
      const rows: Table['rows'] = [];
      for (let r = r0; r <= rEnd; r++) {
        const cells: Cell[] = [];
        for (const c of t.cells.filter(c => c.r === r)) {
          const inside = cellPs.filter(p => p.v.col === c.col).sort((a, b) => a.v.top - b.v.top);
          const items: Para[] = inside.map(p => { const x = mkPara(p.html, { right: p.right || undefined }); meta.set(x, p); return x; });
          inside.forEach(p => pads.push(p.v.x - c.x0));
          // 照片在这个格子里：作为格子里的图片
          if (photo && photo.page === t.page && photo.x >= c.x0 - 2 && photo.x + photo.w <= c.x1 + 2 && photo.top >= c.y0 - 2 && photo.top + photo.h <= c.y1 + 2) {
            const em = (v: number) => +(v / body).toFixed(3) + 'em';
            items.push(mkPara(`<img class="ri" src="${photo.src}" style="width:${em(photo.w)};height:${em(photo.h)}" alt="">`));
            photoUsed = true;
          }
          const cell: Cell = { id: uid('c'), items: items.length ? items : [mkPara('')] };
          if (c.cs > 1) cell.cs = c.cs;
          const rs = Math.min(c.rs, rEnd - r + 1);
          if (rs > 1) cell.rs = rs;
          const fill = ex.fills.find(f => f.page === t.page && f.x <= c.x0 + 3 && f.x + f.w >= c.x1 - 3 && f.top <= c.y0 + 3 && f.top + f.h >= c.y1 - 3);
          if (fill && !isPaper(fill.color)) cell.bg = hex(fill.color);
          if (inside.length || cell.items.length) {
            const xs0 = inside.map(p => p.v.x), xs1 = inside.map(p => p.v.xEnd);
            const imgOnly = !inside.length;
            const cx = (c.x0 + c.x1) / 2;
            const mid = imgOnly ? cx : (Math.min(...xs0) + Math.max(...xs1)) / 2;
            if (imgOnly || (Math.abs(mid - cx) < 3 && Math.min(...xs0) - c.x0 > 6)) cell.align = 'center';
            const top = imgOnly ? photo!.top : Math.min(...inside.map(p => p.v.top)), bot = imgOnly ? photo!.top + photo!.h : Math.max(...inside.map(p => p.v.bottom));
            if (Math.abs((top + bot) / 2 - (c.y0 + c.y1) / 2) < 3 && (c.y1 - c.y0) > (bot - top) * 1.3) cell.va = 'middle';
          }
          cells.push(cell);
        }
        rows.push({ h: r1(((t.ys[r + 1] - t.ys[r]) * PT_MM) - 0.2), cells });
      }
      const tb: Table & { _k?: number } = {
        id: uid('t'), kind: 'table', cols: t.xs.slice(1).map((x, i) => r2(((x - t.xs[i]) / W) * 100)), rows,
        line: hex(t.color), lw: r2(t.t), pad: r1(Math.max(0.5, Math.min(6, (pads.length ? Math.min(...pads) : 5) * PT_MM))),
      };
      tb._k = t.page * 10000 + t.ys[r0];
      insertByTop(doc.body, tb, tb._k, meta);
      r0 = rEnd;
    }
  }
  return photoUsed;
}

/** 格子里的段落：对齐、底色由格子决定 */
function tidyCells(doc: Resume) {
  const walk = (l: Block[]) => l.forEach(b => {
    if (b.kind === 'group') walk(b.items);
    if (b.kind === 'table') { delete (b as Table & { _k?: number })._k; b.rows.forEach(r => r.cells.forEach(c => c.items.forEach(p => { delete p.ind; delete p.align; delete p.bg; delete p.sb; }))); }
  });
  walk(doc.body); walk(doc.side);
}

/** 表格式简历：模块标题和内容各占一个通栏格子 → 模块加外框 */
function applyFrame(doc: Resume, L: Layout, ps: P[], body: number, pageW: number) {
  const titles = ps.filter(p => p.role === 'title');
  for (const t of L.tables) {
    const fullRows = t.full.map((f, r) => (f ? r : -1)).filter(r => r >= 0);
    const inRow = (p: P, r: number) => p.v.page === t.page && p.v.top >= t.ys[r] - 1 && p.v.bottom <= t.ys[r + 1] + 1;
    const titleRows = fullRows.filter(r => titles.some(p => inRow(p, r)));
    if (titleRows.length < 2) continue;
    const textX = ps.filter(p => p.role !== 'title' && fullRows.some(r => inRow(p, r))).map(p => p.v.markerX ?? p.v.x);
    const s = doc.style;
    const pad = textX.length ? Math.min(...textX) - t.x0 : body * 0.6;
    s.frame = { color: hex(t.color), w: r2(t.t), pad: r1(Math.max(0.5, pad * PT_MM)) };
    s.marginH = r1(Math.max(3, Math.min(t.x0, pageW - t.x1) * PT_MM));
    // 相邻的框紧挨着：模块间距只算原稿框与框之间的空隙
    s.sectionGap = 0;
    s.looks.title = { ...s.looks.title, pad: s.frame.pad, bleed: false };
    return;
  }
}
