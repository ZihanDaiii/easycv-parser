// SPDX-License-Identifier: AGPL-3.0-only
import type { Block, Cell, Resume, Table } from './types';

const cellsOf = (t: Table): Cell[] => t.rows.flatMap(r => r.cells);

/** 识别结果统计：模块数、经历数、段落行数 */
export function stats(doc: Resume) {
  let sections = 0, entries = 0, lines = 0;
  const walk = (l: Block[]) => l.forEach(b => {
    if (b.kind === 'para') { lines++; return; }
    if (b.kind === 'table') { cellsOf(b).forEach(c => { lines += c.items.length; }); return; }
    if (b.role === 'section') sections++; else entries++;
    walk(b.items);
  });
  walk(doc.body); walk(doc.side);
  return { sections, entries, lines };
}
