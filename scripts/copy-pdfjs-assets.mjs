// SPDX-License-Identifier: AGPL-3.0-only
// 把 pdf.js 的 CJK 字符映射表和标准字体复制到演示页的静态目录（中文 PDF 需要 cmaps 才能正确取字）
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));
const out = 'playground/public/pdfjs';
for (const d of ['cmaps', 'standard_fonts']) {
  const to = join(out, d);
  if (existsSync(to)) continue;
  mkdirSync(to, { recursive: true });
  cpSync(join(root, d), to, { recursive: true });
}
cpSync('examples/sample-resume.pdf', 'playground/public/sample-resume.pdf');
console.log('pdf.js assets ready →', out);
