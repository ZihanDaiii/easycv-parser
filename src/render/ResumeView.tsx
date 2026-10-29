// SPDX-License-Identifier: AGPL-3.0-only
import { Fragment, type CSSProperties } from 'react';
import type { Block, Group, Para, Resume, Table } from '../model/types';
import { lookCss, styleVars } from './resumeCss';
import { LIST_IND, LIST_IND_NUM } from '../model/defaults';

interface FieldProps { part: 'text' | 'right'; value: string; className: string }

function F(p: FieldProps) {
  // 空的正文也保留一行高度，排版不变；空的右侧内容不占位置
  if (!p.value && p.part === 'right') return null;
  return <div className={p.className} dangerouslySetInnerHTML={{ __html: p.value }} />;
}

const tok = (c: string) => (c === 'accent' ? 'var(--accent)' : c === 'tint' ? 'color-mix(in srgb, var(--accent) 9%, #fff)' : c);

export function ParaView({ p, brk }: { p: Para; brk?: string }) {
  const st: Record<string, string> = {};
  if (p.ind) st['--ind'] = p.ind + 'em';
  else if (p.list) st['--ind'] = (p.list === 'num' ? LIST_IND_NUM : LIST_IND) + 'em'; // 没写缩进的列表：圆点和上方标题的左边对齐
  if (p.fs) st.fontSize = `calc(var(--fs) * ${p.fs})`;
  if (p.color) st.color = tok(p.color);
  if (p.bold !== undefined) st.fontWeight = p.bold ? '700' : '400';
  if (p.bg === 'none') { st.background = 'none'; st['--padx'] = '0mm'; } // 去掉角色外观自带的底色
  else if (p.bg) { st.background = tok(p.bg); st['--padx'] = '1.5mm'; }
  if (p.mk) st['--mk'] = tok(p.mk);
  if (p.ti) st.textIndent = p.ti + 'em';
  if (p.sb !== undefined) st.marginTop = p.sb + 'pt';
  const showR = !!p.right;
  return (
    <div className={'rs-p' + (showR ? ' has-r' : '')} data-block={brk ? undefined : 'para'} data-atom="" data-brk={brk ?? p.id}
      data-id={p.id} data-role={p.role} data-list={p.list} data-num={p.list === 'num' ? p.num ?? '1.' : undefined} data-align={p.align}
      style={st as CSSProperties}>
      <F part="text" value={p.html} className="rs-t" />
      {showR && <F part="right" value={p.right!} className="rs-r" />}
    </div>
  );
}

function GroupView({ g }: { g: Group }) {
  return (
    <div className="rs-g" data-block="group" data-role={g.role} data-id={g.id}>
      <ParaView p={g.head} brk={g.id} />
      <div className="rs-items" data-container={g.id} data-ckind={g.role}>
        <List items={g.items} />
      </div>
    </div>
  );
}

/** 表格整体是一个分页单位（不在格子中间换页） */
function TableView({ t }: { t: Table }) {
  const bd = t.line ? `${t.lw}pt solid ${tok(t.line)}` : 'none';
  return (
    <div className="rs-tw" data-block="table" data-atom="" data-brk={t.id} data-id={t.id}>
      <table className="rs-tbl" style={{ '--tb': bd, '--tp': t.pad + 'mm' } as CSSProperties}>
        <colgroup>{t.cols.map((w, i) => <col key={i} style={{ width: w + '%' }} />)}</colgroup>
        <tbody>
          {t.rows.map((r, ri) => (
            <tr key={ri} style={r.h ? { height: r.h + 'mm' } : undefined}>
              {r.cells.map(c => (
                <td key={c.id} colSpan={c.cs} rowSpan={c.rs} data-container={c.id} data-ckind="cell" data-align={c.align} data-va={c.va}
                  style={c.bg ? { background: tok(c.bg) } : undefined}>
                  <List items={c.items} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function List({ items }: { items: Block[] }) {
  return <>{items.map(b => (
    <Fragment key={b.id}>
      {b.kind === 'group' ? <GroupView g={b} /> : b.kind === 'table' ? <TableView t={b} /> : <ParaView p={b} />}
    </Fragment>
  ))}</>;
}

/** 照片被拖动过：在默认位置上平移 */
export const photoShift = (h: Resume['header']): CSSProperties | undefined =>
  h.photoDx || h.photoDy ? { transform: `translate(${h.photoDx ?? 0}mm, ${h.photoDy ?? 0}mm)` } : undefined;

function HeaderView({ doc }: { doc: Resume }) {
  const h = doc.header;
  // 只有真的有照片时才给照片让出位置
  const showPhoto = h.photoVisible && !!h.photo;
  return (
    <header className={'rs-head ' + doc.style.headerAlign + (showPhoto ? ' has-photo' : '') + (h.noPad ? ' no-pad' : '')} data-container="header" data-ckind="header"
      data-bg={h.bg ? '' : undefined}
      style={{ ...(showPhoto && (h.photoDx ?? 0) < 0 ? { '--pdx': h.photoDx + 'mm' } : {}), ...(showPhoto && (h.photoDy ?? 0) > 0 ? { '--pdy': h.photoDy + 'mm' } : {}), ...(h.bg ? { background: tok(h.bg), paddingBottom: (h.padB ?? 3) + 'mm' } : {}), ...(h.rule ? { borderBottom: `${h.rule.w}pt solid ${tok(h.rule.color)}`, paddingBottom: h.rule.gap + 'pt' } : {}) } as CSSProperties}>
      {showPhoto ? <img className="rs-photo" src={h.photo!} alt="" style={photoShift(h)} /> : null}
      <List items={h.items} />
    </header>
  );
}

/** 按原稿样式渲染一份解析结果。需要同时把 RESUME_CSS 放进页面（见 render/index.ts） */
export function ResumeView({ doc, sheetRef }: { doc: Resume; sheetRef?: React.Ref<HTMLDivElement> }) {
  const s = doc.style;
  const cols = s.cols;
  const head = <HeaderView doc={doc} />;
  return (
    <>
      <div className="rs" ref={sheetRef} style={styleVars(s) as CSSProperties}
        data-topbar={s.topBar ? '' : undefined} data-cols={cols ? '' : undefined} data-side={cols?.side} data-frame={s.frame ? '' : undefined}>
        <style dangerouslySetInnerHTML={{ __html: lookCss(s) }} />
        {(!cols || doc.header.place === 'top') && head}
        {cols ? (
          <div className="rs-cols">
            <div className="rs-side" data-container="side" data-ckind="side">
              {doc.header.place === 'side' && head}
              <List items={doc.side} />
            </div>
            <div className="rs-body" data-container="root" data-ckind="root">
              {doc.header.place === 'main' && head}
              <List items={doc.body} />
            </div>
          </div>
        ) : (
          <div className="rs-body" data-container="root" data-ckind="root">
            <List items={doc.body} />
            {!!doc.side.length && <div className="rs-items rs-flat" data-container="side" data-ckind="side"><List items={doc.side} /></div>}
          </div>
        )}
        {doc.floats.map(f =>
          <img key={f.id} className="rs-float" src={f.src} alt="" style={{ left: f.x + 'mm', top: f.y + 'mm', width: f.w + 'mm', height: f.h + 'mm' }} />)}
      </div>
    </>
  );
}
