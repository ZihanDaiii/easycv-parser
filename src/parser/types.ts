// SPDX-License-Identifier: AGPL-3.0-only
import type { RGB } from './color';

/**
 * 解析器的中间格式：PDF 与 HTML 都先还原成“页面上画了什么”——文字片段、图片、色块、横线、列表符号，
 * 再由同一套版面分析（layout.ts）和结构识别（structure.ts）还原成可编辑的简历。
 * 坐标单位为 pt，原点在每页左上角。
 */
export interface Run {
  text: string;
  page: number;
  x: number; xEnd: number;
  top: number; bottom: number;   // 字框（按字号估算）
  size: number;                  // 字号 pt
  bold: boolean;
  italic: boolean;
  mono: boolean;
  font: string;                  // 字体族名（去掉子集前缀和字重）
  color: RGB;
  bg?: RGB | null;               // 文字底色（行内代码、高亮）
  underline?: boolean;
  href?: string;
  strike?: boolean;
  blk?: number;                  // HTML：所在块元素的编号（同一个块就是同一段）
}

export interface ImgBox { page: number; x: number; top: number; w: number; h: number; src: string; raster: boolean; flow?: boolean /* 文字之间的小图形（技能条等）：作为单独一段 */ }
/** 实色矩形：标题色带、色块、行内代码底色、侧栏底色 */
export interface Fill { page: number; x: number; top: number; w: number; h: number; color: RGB }
/** 横线：标题下划线、分隔线；grid = 属于表格边框 */
export interface Rule { page: number; x: number; xEnd: number; y: number; t: number; color: RGB; grid?: boolean }
/** 表格的竖边框 */
export interface VRule { page: number; x: number; y0: number; y1: number; t: number; color: RGB }
/** 画出来的列表符号（PDF 里圆点常常是图形不是文字） */
export interface Marker { page: number; x: number; top: number; size: number; shape: 'disc' | 'circle' | 'square'; color: RGB }

export interface Extracted {
  pages: { w: number; h: number }[];
  runs: Run[];
  images: ImgBox[];
  fills: Fill[];
  rules: Rule[];
  markers: Marker[];
  vrules?: VRule[];
  /** HTML：页面左右内边距（pt），PDF 由文字位置推断 */
  margins?: { top: number; left: number; right: number };
  topBar?: { color: RGB; h: number } | null;
  kind?: 'pdf' | 'html';
}

export const emptyExtracted = (): Extracted => ({ pages: [{ w: 595.28, h: 841.89 }], runs: [], images: [], fills: [], rules: [], markers: [] });
