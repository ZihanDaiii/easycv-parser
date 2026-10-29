// SPDX-License-Identifier: AGPL-3.0-only
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { configurePdfjs, parseResume, type ParseResult } from '../src';
import { ResumeView, RESUME_CSS } from '../src/render';
import './style.css';

// pdf.js 资源：worker 由 Vite 打包，cmaps / 标准字体由 scripts/copy-pdfjs-assets.mjs 复制到 public/pdfjs
configurePdfjs({ workerSrc: workerUrl, cMapUrl: './pdfjs/cmaps/', standardFontDataUrl: './pdfjs/standard_fonts/' });

type Tab = 'view' | 'json';

/** 原稿预览：PDF 用 pdf.js 画出来，其他格式只显示文件名 */
function Original({ file }: { file: File }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current!;
    el.innerHTML = '';
    if (!/\.pdf$/i.test(file.name)) { el.textContent = `${file.name}（非 PDF 原稿不提供预览）`; return; }
    let stop = false;
    (async () => {
      const doc = await pdfjs.getDocument({ data: await file.arrayBuffer(), cMapUrl: './pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: './pdfjs/standard_fonts/' }).promise;
      for (let i = 1; i <= Math.min(doc.numPages, 4) && !stop; i++) {
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1.5 });
        const c = document.createElement('canvas');
        c.width = vp.width; c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
        if (!stop) el.appendChild(c);
      }
    })();
    return () => { stop = true; };
  }, [file]);
  return <div className="orig" ref={box} />;
}

/** 解析结果按真实纸张尺寸（mm）渲染，这里整体缩放到栏宽 */
function Fit({ children }: { children: React.ReactNode }) {
  const outer = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(1), [h, setH] = useState(0);
  useEffect(() => {
    const fit = () => {
      const o = outer.current, i = inner.current;
      if (!o || !i) return;
      const kk = Math.min(1, o.clientWidth / i.scrollWidth);
      setK(kk); setH(i.scrollHeight * kk);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(outer.current!); ro.observe(inner.current!);
    return () => ro.disconnect();
  }, []);
  return <div className="fit" ref={outer} style={{ height: h || undefined }}><div ref={inner} style={{ transform: `scale(${k})`, transformOrigin: 'top left', width: 'max-content' }}>{children}</div></div>;
}

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<ParseResult | null>(null);
  const [ms, setMs] = useState(0);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<Tab>('view');
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const run = async (f: File) => {
    setFile(f); setRes(null); setErr(''); setBusy(true);
    const t = performance.now();
    try { setRes(await parseResume(f)); setMs(Math.round(performance.now() - t)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const sample = async () => {
    const b = await fetch('./sample-resume.pdf').then(r => r.blob());
    run(new File([b], 'sample-resume.pdf', { type: 'application/pdf' }));
  };

  return (
    <div className="app">
      <header className="top">
        <b>easycv-parser</b><span>PDF / Word / HTML 简历 → 结构化数据 + 原样式还原 · 文件只在你的浏览器里处理</span>
        <a href="https://github.com/ZihanDaiii/easycv-parser" id="gh" target="_blank" rel="noreferrer">GitHub</a>
      </header>

      <div className={'drop' + (over ? ' over' : '')} onClick={() => input.current?.click()}
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) run(f); }}>
        <input ref={input} type="file" accept=".pdf,.docx,.html,.htm" hidden onChange={e => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ''; }} />
        {busy ? '解析中…' : <>拖入简历（PDF / .docx / HTML），或点击选择文件</>}
        <button onClick={e => { e.stopPropagation(); sample(); }} disabled={busy}>用示例简历试试</button>
      </div>

      {err && <p className="err">{err}</p>}
      {res && (
        <div className="bar">
          <span>{res.stats.sections} 个模块 · {res.stats.entries} 段经历 · {res.stats.lines} 行内容 · {res.extracted.pages.length} 页 · 用时 {ms} ms</span>
          <span className="tabs">
            <button className={tab === 'view' ? 'on' : ''} onClick={() => setTab('view')}>还原效果</button>
            <button className={tab === 'json' ? 'on' : ''} onClick={() => setTab('json')}>结构化 JSON</button>
          </span>
        </div>
      )}

      {file && (
        <div className="cmp">
          <section><h3>原稿</h3><Original file={file} /></section>
          <section>
            <h3>{tab === 'view' ? '解析后重新渲染' : '解析结果（JSON）'}</h3>
            {res && (tab === 'view'
              ? <Fit><style>{RESUME_CSS}</style><div className="paper"><ResumeView doc={res.resume} /></div></Fit>
              : <pre className="json">{JSON.stringify(res.resume, (k, v) => (k === 'templates' ? undefined : typeof v === 'string' ? v.replace(/(data:[\w/+.-]+;base64,)[A-Za-z0-9+/=]{16,}/g, '$1…') : v), 2)}</pre>)}
          </section>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
