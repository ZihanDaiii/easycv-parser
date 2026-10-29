// SPDX-License-Identifier: AGPL-3.0-only
/**
 * easycv-parser：把 PDF / Word（.docx）/ HTML 简历还原成结构化、带样式的数据。
 *
 * 流程：读取原稿（文字、字体、颜色、色块、线条、图片） → 版面分析（分栏、行、段落、列表）
 *      → 结构识别（页眉、模块、经历、要点、表格） → 样式还原（字体、字号、主题色、边距、模块标题样式）
 *
 * 全部在浏览器里完成，不上传文件。
 */
import type { Resume } from './model/types';
import { extractPdf } from './parser/pdf';
import { extractHtml } from './parser/html';
import { docxToHtml } from './parser/docx';
import { buildResume } from './parser/structure';
import type { Extracted } from './parser/types';

export type FileKind = 'pdf' | 'docx' | 'html';
export interface ParseStats { sections: number; entries: number; lines: number }
export interface ParseResult {
  /** 结构化简历（数据格式见 docs/data-model.md） */
  resume: Resume;
  /** 识别出的模块数、经历数、段落行数 */
  stats: ParseStats;
  /** 原稿的原始提取结果（文字片段、色块、线条、图片……），调试或二次开发用 */
  extracted: Extracted;
}

export class ParseError extends Error {
  constructor(public code: 'unsupported' | 'no_text', message: string) { super(message); }
}

/** 根据文件名 / MIME 判断格式 */
export function detectKind(name = '', mime = ''): FileKind | null {
  const n = name.toLowerCase();
  if (n.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (n.endsWith('.docx') || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (n.endsWith('.html') || n.endsWith('.htm') || mime === 'text/html') return 'html';
  return null;
}

/** 只做第一步：读取原稿里的文字和图形元素 */
export async function extract(data: ArrayBuffer, kind: FileKind): Promise<Extracted> {
  if (kind === 'pdf') return extractPdf(data);
  if (kind === 'docx') return extractHtml(await docxToHtml(data));
  return extractHtml(new TextDecoder().decode(data));
}

/**
 * 解析一份简历。
 * @param input  File / Blob / ArrayBuffer
 * @param opts.kind  文件格式；传 File 时可以省略，按文件名自动判断
 */
export async function parseResume(input: File | Blob | ArrayBuffer, opts: { kind?: FileKind } = {}): Promise<ParseResult> {
  const name = typeof File !== 'undefined' && input instanceof File ? input.name : '';
  const mime = input instanceof Blob ? input.type : '';
  const kind = opts.kind ?? detectKind(name, mime);
  if (!kind) throw new ParseError('unsupported', '不支持的格式，请使用 PDF、Word（.docx）或 HTML');
  const data = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const extracted = await extract(data, kind);
  if (!extracted.runs.length) throw new ParseError('no_text', '没有读到文字。扫描件或图片 PDF 需要先做 OCR');
  const { doc, stats } = buildResume(extracted);
  if (doc.style.cols) doc.style.headPlace = doc.header.place;
  if (name) doc.title = name.replace(/\.[^.]+$/, '').trim().slice(0, 80);
  return { resume: doc, stats, extracted };
}

export { buildResume } from './parser/structure';
export { configurePdfjs } from './parser/pdf';
export { stats } from './model/stats';
export type * from './model/types';
export type { Extracted, Run, ImgBox, Fill, Rule, VRule, Marker } from './parser/types';
