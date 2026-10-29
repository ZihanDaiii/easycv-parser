// SPDX-License-Identifier: AGPL-3.0-only
export type FontKey = 'yahei' | 'hei' | 'song' | 'kai' | 'fang';
export type ListKind = 'disc' | 'circle' | 'square' | 'dash' | 'arrow' | 'check' | 'star' | 'num';
/** 段落角色：决定用哪一套外观。name 姓名 · title 模块标题 · head 经历标题 · sub 经历下的小标题 · body 正文 */
export type Role = 'name' | 'title' | 'head' | 'sub' | 'body';

/** 一种段落外观（模块标题、经历标题等各一套）。属于模板：换模板时整套替换。 */
export interface Look {
  fs: number;        // 字号倍数（相对正文字号）
  bold: boolean;
  color: string;     // '' 跟随正文 · 'accent' 主题色 · #hex
  bg: string;        // 底色：'' · 'accent' · 'tint'（主题色浅底） · #hex
  bar: string;       // 左侧竖条：'' · 'accent' · #hex
  rule: string;      // 下划线：'' · 'accent' · #hex
  ruleW: number;     // 下划线粗细 pt
  pad: number;       // 有底色或竖条时的左右内边距 mm
  ls: number;        // 字间距 em
  bleed?: boolean;   // 底色通栏到纸边
  after?: number;    // 标题与下方内容的间距 pt（不设则用默认）
}

export interface PageSize { name: string; w: number; h: number } // mm

/** 两栏版式：侧栏位置、宽度、底色 */
export interface Columns { side: 'left' | 'right'; w: number; gap: number; bg: string; ink: string; edge?: number /* 侧栏底色边界 mm（不设则取栏间距中线） */; pg?: number /* 侧栏的段落间距 pt（与主栏不同时） */ }

/** 一份“样式 DNA”：模板 = 这组参数。内容和样式分开存，换模板只换这组参数。 */
export interface StyleConfig {
  page: PageSize;
  font: FontKey;
  latin: string;         // 西文字体：'' 跟随中文字体；否则为字体名（如 EB Garamond）
  cjk?: string;          // 原稿的中文字体名（如 PingFang SC），本机有就优先用，保证还原；换字体后清空
  fontSize: number;      // 正文字号 pt
  lineHeight: number;    // 行高倍数
  sectionGap: number;    // 模块间距 pt
  itemGap: number;       // 经历间距 pt
  paraGap: number;       // 段落 / 条目间距 pt
  headGap?: number;      // 页眉与正文的间距 pt（不设则按模块间距）
  marginV: number;       // 上下页边距 mm
  marginH: number;       // 左右页边距 mm
  marginR?: number;      // 右页边距 mm（与左边不同时，如右侧栏比主栏更贴近纸边）
  accent: string;        // 主题色
  ink: string;           // 正文颜色
  topBar: string | null; // 顶部色条颜色，null 表示没有
  headerAlign: 'center' | 'left';
  looks: Record<Exclude<Role, 'body'>, Look>;
  photoW: number;        // 照片宽 mm
  photoH: number;        // 照片高 mm
  cols: Columns | null;
  headPlace?: 'top' | 'side' | 'main'; // 两栏模板的页眉位置（换到这个模板时用）
  frame?: { color: string; w: number; pad: number } | null; // 模块外框（表格式简历）：边框色、粗细 pt、内边距 mm
}

export interface Template {
  id: string;
  name: string;
  source: 'original' | 'uploaded' | 'builtin';
  style: StyleConfig;
}

/**
 * 段落：简历里的每一行文字（姓名、联系方式、模块标题、经历标题、描述）都是段落。
 * 不预设“单位 | 职位 | 时间”这类固定字段，原稿怎么写就怎么存：富文本 + 可选的右对齐部分。
 */
export interface Para {
  id: string;
  kind: 'para';
  role: Role;
  html: string;          // 富文本：b / i / u / a / code / span(颜色、字号、底色) / img
  right?: string;        // 右对齐部分（时间、地点）
  list?: ListKind;       // 列表符号
  num?: string;          // list = 'num' 时的编号文字，如 “1.”
  ind?: number;          // 文字左缩进 em（相对正文字号）
  align?: 'center' | 'right';
  fs?: number;           // 以下为单段覆盖：字号倍数
  color?: string;
  bold?: boolean;
  bg?: string;           // 底色；'none' 表示去掉角色外观自带的底色
  mk?: string;           // 列表符号颜色
  ti?: number;           // 首行缩进 em
  sb?: number;           // 段前间距 pt（覆盖默认的段落间距，用于还原原稿里特殊的间距）
}

/** 分组：模块（section）或经历（entry）。标题本身也是段落；经历可以嵌套（公司 → 项目 → 描述）。 */
export interface Group {
  id: string;
  kind: 'group';
  role: 'section' | 'entry';
  head: Para;
  items: Block[];
}

/** 表格的一格：里面是若干段落，编辑方式和正文一样 */
export interface Cell {
  id: string;
  items: Para[];
  cs?: number;            // 跨列
  rs?: number;            // 跨行
  bg?: string;            // 底色
  align?: 'center' | 'right';
  va?: 'middle';          // 垂直居中
}

/** 表格：表格式简历里的个人信息栏等。按原稿保留列宽、行高、边框和底色 */
export interface Table {
  id: string;
  kind: 'table';
  cols: number[];         // 各列宽度 %
  rows: { h?: number /* 最小行高 mm */; cells: Cell[] }[];
  line: string;           // 边框颜色，'' 表示无边框
  lw: number;             // 边框粗细 pt
  pad: number;            // 格内边距 mm
}

export type Block = Group | Para | Table;

export interface Header {
  items: Para[];          // 第一段通常是姓名
  photo: string | null;   // data URL
  photoVisible: boolean;
  photoDx?: number;       // 照片相对默认位置（页眉右上角）的偏移 mm：用户拖动调整
  photoDy?: number;
  place: 'top' | 'side' | 'main';  // 两栏版式时页眉放在顶部通栏、侧栏顶部还是主栏顶部
  bg?: string;            // 页眉底色（通栏色块）
  padB?: number;          // 有底色时页眉下方留白 mm
  noPad?: boolean;        // 居中页眉不为照片两侧留白（原稿文字本来就不会碰到照片）
  rule?: { color: string; w: number; gap: number }; // 页眉下方的分隔线：颜色、粗细 pt、与页眉文字的距离 pt
}

/** 不在文字流里的图片（徽章、装饰图），按第一页坐标绝对定位，单位 mm */
export interface FloatImg { id: string; src: string; x: number; y: number; w: number; h: number }

export interface Resume {
  v: 2;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  header: Header;
  body: Block[];          // 主栏
  side: Block[];          // 侧栏（单栏版式时为空）
  floats: FloatImg[];
  style: StyleConfig;
  templates: Template[];
  activeTemplateId: string | null;
  bodyOrder?: string[];   // 换到两栏模板前主栏各块的顺序：换回单栏时按这个顺序放回
  srcPages?: number;      // 刚导入的原稿页数：首次排版若多出页数，自动微调回原稿页数，之后清除
}
