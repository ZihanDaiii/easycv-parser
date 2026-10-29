// SPDX-License-Identifier: AGPL-3.0-only
import type { Look, StyleConfig } from '../model/types';
import { fontStack } from '../model/defaults';

/** 简历本身的样式（解析结果的渲染样式）。 */
export const RESUME_CSS = `
.rs {
  box-sizing: border-box; position: relative; width: var(--pgw); background: #fff; color: var(--ink);
  font-family: var(--ff); font-size: var(--fs); line-height: var(--lh);
  padding: var(--mv) var(--mr, var(--mh)) 0 var(--mh); -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility; overflow-wrap: break-word;
}
.rs * { box-sizing: border-box; }
.rs[data-topbar] { border-top: 3.4mm solid var(--bar); }
.rs b, .rs strong { font-weight: 700; }
.rs a { color: inherit; text-decoration: none; }
.rs u { text-underline-offset: .15em; }
.rs code { font-family: "Courier New", Menlo, Consolas, monospace; font-size: .92em; background: #f0f1f3; padding: 0 .25em; border-radius: .25em; }
.rs .sep { margin: 0 .55em; color: #555; }
.rs img.ri { display: inline-block; height: 1.15em; width: auto; vertical-align: -.2em; object-fit: contain; }
.rs img.ri.blk { display: block; height: auto; max-width: 100%; }

/* 两栏：侧栏底色铺满整页高度（每一页都有） */
.rs-cols { display: grid; grid-template-columns: var(--sw) minmax(0, 1fr); column-gap: var(--cg); align-items: start; }
.rs[data-side="right"] .rs-cols { grid-template-columns: minmax(0, 1fr) var(--sw); }
.rs[data-side="right"] .rs-side { order: 2; }
.rs[data-cols] { background: linear-gradient(to right, var(--sbg) 0 var(--sedge, calc(var(--mh) + var(--sw) + var(--cg) / 2)), #fff 0); }
.rs[data-cols][data-side="right"] { background: linear-gradient(to left, var(--sbg) 0 var(--sedge, calc(var(--mh) + var(--sw) + var(--cg) / 2)), #fff 0); }
.rs-side { color: var(--sink, inherit); min-width: 0; }
.rs-side .rs-items > .rs-p, .rs-side > .rs-p { margin-top: var(--spg, var(--pg)); }
.rs-side .rs-g > .rs-p:first-child, .rs-side .rs-items > .rs-p:first-child, .rs-side > .rs-p:first-child { margin-top: 0; }
.rs-body { min-width: 0; }

/* 页眉 */
.rs-head { position: relative; text-align: center; }
.rs-head.left { text-align: left; }
.rs-head > .rs-p { margin-top: .2em; }
.rs-head > :first-child, .rs-head > .rs-photo + * { margin-top: 0; }
/* 页眉文字给照片让位置；照片被拖向左、向下时（--pdx 为负、--pdy 为正）让得更多 */
.rs-head.has-photo { min-height: calc(var(--phh) + var(--pdy, 0mm)); padding-left: calc(var(--phw) + 4mm - var(--pdx, 0mm)); padding-right: calc(var(--phw) + 4mm - var(--pdx, 0mm)); }
.rs-head.left.has-photo { padding-left: 0; }
.rs-head.has-photo.no-pad { padding-left: 0; padding-right: 0; min-height: 0; }
.rs-photo { position: absolute; right: 0; top: 0; width: var(--phw); height: var(--phh); object-fit: cover; display: block; }
.rs-head[data-bg] { margin: calc(var(--mv) * -1) calc(var(--mh) * -1) 0; padding-top: var(--mv); padding-left: var(--mh); padding-right: var(--mh); }
.rs-head[data-bg].has-photo { padding-right: calc(var(--phw) + 4mm + var(--mh) - var(--pdx, 0mm)); }
.rs-head[data-bg] .rs-photo { right: var(--mh); top: var(--mv); }
.rs-side .rs-head, .rs-cols .rs-body > .rs-head { text-align: left; padding: 0 !important; min-height: 0; }
.rs-cols .rs-body > .rs-head + * { margin-top: var(--hg, calc(var(--sg) * .8)); }
.rs-side .rs-head .rs-photo { position: static; margin: 0 0 3mm; }
/* 侧栏里的页眉：竖杠分隔的各项一行一个（侧栏窄，挤在一行会把电话号码、日期从中间折断） */
.rs-side .rs-head .sep { display: block; width: 0; height: 0; margin: 0; overflow: hidden; }
.rs-float { position: absolute; display: block; object-fit: contain; }

/* 分组与段落：间距一律用上边距，不用下边距，便于精确分页 */
.rs-g { margin-top: var(--ig); }
.rs-g[data-role="section"] { margin-top: var(--sg); }
.rs-body > :first-child, .rs-side > :first-child, .rs-items > :first-child { margin-top: 0; }
.rs-head + .rs-body, .rs-head + .rs-cols { margin-top: var(--hg, calc(var(--sg) * .8)); }
.rs-items { margin-top: var(--pg); }
.rs-g[data-role="section"] > .rs-items { margin-top: calc(var(--ig) * .6); }
.pg-gap:first-child + * { margin-top: 0; }
.rs-g > .rs-p:first-child { margin-top: 0; }
.rs-flat { margin-top: var(--sg); }
.rs-flat > :first-child { margin-top: 0; }

.rs-p {
  position: relative; margin-top: var(--pg);
  padding-left: calc(var(--ind, 0em) + var(--padx, 0mm) + var(--bleed, 0mm));
  padding-right: calc(var(--padx, 0mm) + var(--bleed, 0mm));
  margin-left: calc(var(--bleed, 0mm) * -1); margin-right: calc(var(--bleed, 0mm) * -1);
}
/* 表格（表格式简历的个人信息栏等）：整张表是一个分页单位 */
.rs-tw { margin-top: var(--pg); }
.rs-tbl { width: 100%; border-collapse: collapse; table-layout: fixed; }
.rs-tbl td { border: var(--tb); padding: calc(var(--tp) * .8) var(--tp); vertical-align: top; overflow-wrap: anywhere; }
.rs-tbl td[data-va="middle"] { vertical-align: middle; }
.rs-tbl td[data-align="center"] { text-align: center; }
.rs-tbl td[data-align="right"] { text-align: right; }
.rs-tbl td > :first-child, .rs-tbl td > .pg-gap:first-child + * { margin-top: 0; }
.rs-tbl td .rs-p { margin-top: .15em; }
.rs-tbl td img.ri { vertical-align: middle; }

/* 模块外框（表格式简历）：每个模块一个框，标题一栏、内容一栏，相邻的框共用边线 */
.rs[data-frame] .rs-g[data-role="section"] { border: var(--frw) solid var(--frc); }
.rs[data-frame] .rs-body > .rs-g[data-role="section"]:not(:first-child), .rs[data-frame] .rs-side > .rs-g[data-role="section"]:not(:first-child) { margin-top: calc(var(--sg) - var(--frw)); }
.rs[data-frame] .rs-g[data-role="section"] > .rs-p[data-role="title"] { border-bottom: var(--frw) solid var(--frc); padding-top: calc(var(--frp) * .8); padding-bottom: calc(var(--frp) * .8); }
.rs[data-frame] .rs-g[data-role="section"] > .rs-items, .rs[data-frame] .rs-g[data-role="section"] > .rs-p[data-role="title"] + .rs-items { margin-top: 0; padding: calc(var(--frp) * .8) var(--frp); }
.rs[data-frame] .rs-tw + .rs-g[data-role="section"] { margin-top: calc(var(--sg) - var(--frw)); }

.rs-p.has-r { display: flex; align-items: baseline; }
.rs-p.has-r > .rs-t { flex: 1 1 auto; min-width: 0; }
.rs-r { flex: none; margin-left: 1em; white-space: nowrap; text-align: right; font-variant-numeric: tabular-nums; }
/* 侧栏窄：标题放不下时，时间换到下一行靠右，不把标题挤成一列碎字 */
.rs-side .rs-p.has-r { flex-wrap: wrap; }
.rs-side .rs-p.has-r > .rs-r { margin-left: auto; padding-left: 1em; }
.rs-p[data-align="center"] { text-align: center; }
.rs-p[data-align="right"] { text-align: right; }
.rs-t:empty { min-height: calc(var(--lh) * 1em); }
/* 折行规则：中英文混排时按字符换行，保证和原稿接近 */
.rs-t, .rs-r { -webkit-line-break: after-white-space; line-break: after-white-space; overflow-wrap: break-word; }

/* 列表符号：画在文字左侧，换行后与文字对齐 */
.rs-p[data-list]::before { position: absolute; left: calc(var(--ind, 0em) + var(--padx, 0mm) + var(--bleed, 0mm) - 1em); width: 1em; text-align: center; top: 0; }
.rs-p[data-list="disc"]::before, .rs-p[data-list="circle"]::before, .rs-p[data-list="square"]::before {
  content: ''; left: calc(var(--ind, 0em) + var(--padx, 0mm) + var(--bleed, 0mm) - .68em); width: .32em; height: .32em;
  top: calc(var(--lh) * .5em - .16em); border-radius: 50%; background: var(--mk, currentColor);
}
.rs-p[data-list="circle"]::before { background: transparent; border: .075em solid var(--mk, currentColor); width: .36em; height: .36em; top: calc(var(--lh) * .5em - .18em); }
.rs-p[data-list="square"]::before { border-radius: 0; width: .3em; height: .3em; }
.rs-p[data-list="dash"]::before { content: '–'; color: var(--mk, inherit); }
.rs-p[data-list="arrow"]::before { content: '▸'; color: var(--mk, inherit); }
.rs-p[data-list="check"]::before { content: '✓'; color: var(--mk, inherit); }
.rs-p[data-list="star"]::before { content: '★'; color: var(--mk, inherit); font-size: .8em; line-height: calc(var(--lh) * 1.25); }
.rs-p[data-list="num"]::before { content: attr(data-num); width: 3em; text-align: right; padding-right: .3em; box-sizing: border-box; left: calc(var(--ind, 0em) + var(--padx, 0mm) + var(--bleed, 0mm) - 3em); color: var(--mk, inherit); }
`;

const tok = (c: string, tint = false) => c === 'accent' ? 'var(--accent)' : c === 'tint' ? 'color-mix(in srgb, var(--accent) 9%, #fff)' : c || (tint ? '' : '');

/** 角色外观（模块标题、经历标题…）→ CSS。字号用正文字号的倍数，排版参数变化时一起缩放 */
export function lookCss(s: StyleConfig) {
  const one = (role: string, l: Look) => {
    const d: string[] = [`font-size:calc(var(--fs) * ${l.fs})`, `font-weight:${l.bold ? 700 : 400}`];
    if (l.color) d.push(`color:${tok(l.color)}`);
    if (l.ls) d.push(`letter-spacing:${l.ls}em`);
    if (l.bg) d.push(`background:${tok(l.bg)}`);
    if (l.bar) d.push(`border-left:.8mm solid ${tok(l.bar)}`);
    if (l.rule && l.ruleW) d.push(`border-bottom:${l.ruleW}pt solid ${tok(l.rule)}`, 'padding-bottom:.4mm');
    if (l.bg || l.bar) d.push(`--padx:${l.pad}mm`, '--pt:.3mm', 'padding-top:.3mm', 'padding-bottom:.3mm');
    if (l.bleed) d.push('--bleed:var(--mh)');
    const after = l.after !== undefined ? `\n.rs .rs-g[data-role="${role === 'title' ? 'section' : 'entry'}"] > .rs-p[data-role="${role}"] + .rs-items{margin-top:${l.after}pt}` : '';
    return `.rs .rs-p[data-role="${role}"]{${d.join(';')}}` + after;
  };
  return [
    one('name', s.looks.name), one('title', s.looks.title), one('head', s.looks.head), one('sub', s.looks.sub),
    '.rs .rs-p[data-role="name"]{line-height:1.3}',
    '.rs .rs-p[data-role="title"],.rs .rs-p[data-role="head"],.rs .rs-p[data-role="sub"]{break-after:avoid}',
  ].join('\n');
}

export function styleVars(s: StyleConfig): Record<string, string> {
  const v: Record<string, string> = {
    '--pgw': s.page.w + 'mm',
    '--ff': fontStack(s.font, s.latin, s.cjk),
    '--fs': s.fontSize + 'pt',
    '--lh': String(s.lineHeight),
    '--sg': s.sectionGap + 'pt',
    '--ig': s.itemGap + 'pt',
    '--pg': s.paraGap + 'pt',
    '--mv': s.marginV + 'mm',
    '--mh': s.marginH + 'mm',
    ...(s.marginR !== undefined ? { '--mr': s.marginR + 'mm' } : {}),
    '--accent': s.accent,
    '--ink': s.ink || '#161616',
    '--bar': s.topBar ?? s.accent,
    '--phw': s.photoW + 'mm',
    '--phh': s.photoH + 'mm',
  };
  if (s.headGap !== undefined) v['--hg'] = s.headGap + 'pt';
  if (s.frame) { v['--frc'] = s.frame.color; v['--frw'] = s.frame.w + 'pt'; v['--frp'] = s.frame.pad + 'mm'; }
  if (s.cols) {
    v['--sw'] = s.cols.w + 'mm';
    v['--cg'] = s.cols.gap + 'mm';
    v['--sbg'] = s.cols.bg ? tok(s.cols.bg) : '#fff';
    if (s.cols.ink) v['--sink'] = s.cols.ink;
    if (s.cols.pg !== undefined) v['--spg'] = s.cols.pg + 'pt';
    if (s.cols.edge) v['--sedge'] = (s.cols.side === 'left' ? s.cols.edge : +(s.page.w - s.cols.edge).toFixed(2)) + 'mm';
  }
  return v;
}

export const varsToCss = (v: Record<string, string>) => Object.entries(v).map(([k, val]) => `${k}:${val}`).join(';');

/** mm ↔ px（CSS 96dpi） */
export const MM = 96 / 25.4;
