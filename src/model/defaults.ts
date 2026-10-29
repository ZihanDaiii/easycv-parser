// SPDX-License-Identifier: AGPL-3.0-only
import type { FontKey, Look, PageSize, Para, Resume, StyleConfig } from './types';

/** 列表默认缩进（em）：圆点左边正好落在文字左边界上，不超出模块标题 */
export const LIST_IND = 0.75, LIST_IND_NUM = 1.6;

export const uid = (p = 'b') => p + Math.random().toString(36).slice(2, 9);

// 黑体、宋体、楷体、仿宋自带的西文字形是等宽的，排在简历里很别扭；按中文简历惯例，西文和数字配 Arial / Times New Roman
export const FONTS: { key: FontKey; label: string; stack: string }[] = [
  { key: 'yahei', label: '微软雅黑', stack: '"Microsoft YaHei","微软雅黑","PingFang SC","Hiragino Sans GB","Noto Sans SC",sans-serif' },
  { key: 'hei', label: '黑体', stack: 'Arial,"Helvetica Neue","SimHei","黑体","Heiti SC","STHeiti","Noto Sans SC",sans-serif' },
  { key: 'song', label: '宋体', stack: '"Times New Roman",Times,"SimSun","宋体","Songti SC","STSong","Noto Serif SC",serif' },
  { key: 'kai', label: '楷体', stack: '"Times New Roman",Times,"KaiTi","楷体","Kaiti SC","STKaiti",serif' },
  { key: 'fang', label: '仿宋', stack: '"Times New Roman",Times,"FangSong","仿宋","STFangsong","FangSong_GB2312",serif' },
];

export function fontStack(k: FontKey, latin = '', cjk = '') {
  const base = (FONTS.find(f => f.key === k) ?? FONTS[0]).stack;
  return (latin ? `"${latin}",` : '') + (cjk ? `"${cjk}",` : '') + base;
}

/** 用来识别原稿纸张尺寸（mm） */
export const KNOWN_PAGES: PageSize[] = [
  { name: 'A4', w: 210, h: 297 },
  { name: 'A3', w: 297, h: 420 },
  { name: 'Letter', w: 215.9, h: 279.4 },
];

const look = (p: Partial<Look>): Look => ({ fs: 1, bold: false, color: '', bg: '', bar: '', rule: '', ruleW: 0, pad: 0, ls: 0, ...p });

/** 识别前的默认样式：识别时会用原稿里的字体、字号、颜色、边距等逐项覆盖 */
export const BASE_STYLE: StyleConfig = {
  page: KNOWN_PAGES[0],
  font: 'yahei',
  latin: '',
  fontSize: 9.5,
  lineHeight: 1.45,
  sectionGap: 6,
  itemGap: 4,
  paraGap: 1.2,
  marginV: 10,
  marginH: 12,
  accent: '#2f5bd3',
  ink: '#161616',
  topBar: null,
  headerAlign: 'center',
  looks: {
    name: look({ fs: 2, bold: true, ls: 0.06 }),
    title: look({ fs: 1.2, bold: true, color: 'accent', bg: 'tint', bar: 'accent', pad: 3, ls: 0.08 }),
    head: look({}),
    sub: look({ bold: true }),
  },
  photoW: 17,
  photoH: 23.8,
  cols: null,
};

export const para = (html = '', p: Partial<Para> = {}): Para => ({ id: uid('p'), kind: 'para', role: 'body', html, ...p });

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function blankResume(): Resume {
  const now = Date.now();
  return {
    v: 2,
    id: uid('d'),
    title: '',
    createdAt: now,
    updatedAt: now,
    header: { items: [para('', { role: 'name' }), para('')], photo: null, photoVisible: true, place: 'top' },
    body: [],
    side: [],
    floats: [],
    style: structuredClone(BASE_STYLE),
    templates: [],
    activeTemplateId: null,
  };
}
