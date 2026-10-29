# easycv-parser

### 把简历还原成数据，也还原成原来的样子。

[![easycv-parser：把 PDF / Word / HTML 简历解析成结构化数据，并按原样式重新渲染](.github/assets/readme-banner.jpg)](#快速开始)

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="docs/how-it-works.md">工作原理</a> ·
  <a href="docs/data-model.md">数据格式</a> ·
  <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-blue"></a>
  <a href="https://github.com/ZihanDaiii/easycv-parser/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ZihanDaiii/easycv-parser/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6">
  <img alt="Runs in browser" src="https://img.shields.io/badge/runs%20in-browser-2f5bd3">
</p>

easycv-parser 是一个开源的简历解析引擎。它读取 PDF、Word（.docx）或 HTML 格式的简历，输出一份结构化的数据：页眉、模块、经历、要点、表格，以及原稿的字体、配色和版式。

和只抽取文字的解析器不同，它同时还原**内容**和**样子**：解析结果可以按原稿的样式重新渲染出来，和原稿几乎一致。

整个过程在浏览器里完成，文件不会离开用户的设备。它也是「简单简历 EasyCV」背后的解析引擎。

## 效果

左边是原稿 PDF，右边是解析成结构化数据后重新渲染的结果。示例简历中的人物、学校和公司均为虚构。

![原稿与解析后重新渲染的对比](docs/images/compare.png)

## 设计理念

- **结构与样式同样重要**
  - 简历的版式本身就是信息。字体、主题色、模块标题样式、两栏布局都会被识别并保留。
  - 结构和样式分开存储：内容可以单独使用，样式也可以单独替换。

- **不预设字段**
  - 不把每段经历强行拆成“单位 / 职位 / 时间”。原稿怎么写就怎么还原：富文本段落，加上可选的右对齐部分。
  - 任何写法的简历都能完整保留，不会因为对不上字段而丢内容。

- **一条管线，多种格式**
  - PDF、DOCX、HTML 先转成同一种中间表示，再走同一套版面分析和结构识别。改进一处，所有格式一起受益。

- **本地优先**
  - 没有服务端，不发起网络请求。简历是高度敏感的个人数据，应该留在用户自己的设备上。

## 它能做什么

- **识别结构。** 页眉（姓名、联系方式、证件照）、模块标题、经历标题与右侧时间、多级要点、表格。
- **还原版式。** 单栏与左右两栏、页边距、段落间距、缩进、对齐、页眉位置。
- **还原样式。** 中西文字体、字号、粗斜体、主题色、模块标题样式（色带、下划线、色块……）、背景色块、分隔线、列表符号。
- **保留图片。** 证件照、公司 Logo 和矢量图标。
- **重新渲染。** 自带一个只读的 React 组件，按原稿样式画出解析结果。

中文简历是重点优化对象，英文简历同样可用。扫描件和图片 PDF 需要先做 OCR。

## 快速开始

在本地运行演示页：

```bash
git clone https://github.com/ZihanDaiii/easycv-parser.git
cd easycv-parser
npm install
npm run dev
```

打开 <http://localhost:5190>，点击「用示例简历试试」，或者拖入你自己的简历。

### 在项目中使用

```ts
import { configurePdfjs, parseResume } from 'easycv-parser';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// 中文 PDF 需要 pdf.js 的字符映射表：把 node_modules/pdfjs-dist/cmaps 放到静态目录
configurePdfjs({ workerSrc: workerUrl, cMapUrl: '/pdfjs/cmaps/', standardFontDataUrl: '/pdfjs/standard_fonts/' });

const { resume, stats } = await parseResume(file);
// stats  → { sections: 4, entries: 8, lines: 26 }
// resume → 模块 → 经历 → 段落的树，以及样式参数
```

按原样式渲染：

```tsx
import { ResumeView, RESUME_CSS } from 'easycv-parser/render';

<>
  <style>{RESUME_CSS}</style>
  <ResumeView doc={resume} />
</>
```

| API | 说明 |
|---|---|
| `parseResume(input, { kind? })` | `File` / `Blob` / `ArrayBuffer` → `{ resume, stats, extracted }` |
| `extract(data, kind)` | 只读取原稿里的文字、色块、线条和图片 |
| `buildResume(extracted)` | 版面分析、结构识别、样式还原 |
| `configurePdfjs(options)` | 设置 pdf.js 的 worker 和资源路径 |
| `ResumeView`、`RESUME_CSS` | 只读渲染组件（`easycv-parser/render`） |

npm 包即将发布，目前可以用 `npm run build` 从源码构建。

## 工作原理

```text
原稿 ──▶ 提取        文字、字体、颜色、色块、线条、列表符号、图片
     ──▶ 版面分析    分栏、行、段落、列表、对齐、表格
     ──▶ 结构识别    页眉、模块、经历、时间、要点
     ──▶ 样式还原    字体、字号、主题色、标题样式、边距
     ──▶ Resume JSON
```

PDF 的文字和字体来自 pdf.js，颜色、色块和线条来自对页面位图的逐格分析；HTML 在隔离的 iframe 中排版后读取；DOCX 先转换成等效的 HTML。

详见 [工作原理](docs/how-it-works.md) 和 [数据格式](docs/data-model.md)。

## 仓库结构

```text
src/parser/     # 提取（pdf / html / docx）、版面分析、结构识别与样式还原
src/model/      # 数据类型
src/render/     # 只读渲染组件
playground/     # 演示页
examples/       # 示例简历（内容均为虚构）
docs/           # 原理与数据格式
```

## 开发

```bash
npm run dev         # 演示页
npm run typecheck
npm run build       # 构建 dist/
npm run smoke       # 冒烟测试：需要先运行 npm run dev，并安装 Chrome
```

提交 Issue 或测试样例时，请使用虚构内容，不要上传含真实个人信息的简历。

## 安全

请通过 GitHub 的 [Security Advisories](https://github.com/ZihanDaiii/easycv-parser/security/advisories/new) 私下报告漏洞，不要公开提 Issue。见 [SECURITY.md](SECURITY.md)。

## 许可证与贡献

本项目的原创代码以 [AGPL-3.0-only](LICENSE) 授权，第三方组件保留各自的许可证。

贡献需要签署 [CLA](CLA.md)，见 [CONTRIBUTING.md](CONTRIBUTING.md)。
