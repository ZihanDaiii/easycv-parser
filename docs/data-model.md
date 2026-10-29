# 数据格式

解析结果是一个 `Resume` 对象，完整类型定义见 [`src/model/types.ts`](../src/model/types.ts)。设计原则：**内容和样式分开存**，不预设“单位 / 职位 / 时间”这类固定字段，原稿怎么写就怎么存。

```
Resume
├── header        页眉：items（第一段通常是姓名）、photo、place
├── body: Block[] 主栏
├── side: Block[] 侧栏（单栏简历为空）
├── floats        不在文字流里的图片（徽章、装饰），按 mm 绝对定位
└── style         样式参数 StyleConfig
```

`Block` 有三种：

| kind | 说明 |
|---|---|
| `group` | 模块（`role: 'section'`）或经历（`role: 'entry'`）。`head` 是标题段落，`items` 是下面的内容，可以嵌套 |
| `para` | 段落。`role`：`name` 姓名 · `title` 模块标题 · `head` 经历标题 · `sub` 小标题 · `body` 正文；`html` 富文本；`right` 右对齐部分（时间、地点）；`list` 列表符号 |
| `table` | 表格。`cols` 列宽百分比，`rows[].cells[]` 里是段落，支持跨行跨列、底色、边框 |

## 示例（节选）

```json
{
  "header": { "items": [{ "kind": "para", "role": "name", "html": "沈知远" }], "photo": null, "place": "top" },
  "body": [{
    "kind": "group", "role": "section",
    "head": { "kind": "para", "role": "title", "html": "实习经历" },
    "items": [{
      "kind": "group", "role": "entry",
      "head": { "kind": "para", "role": "head", "html": "<b>澜图科技 · 大模型平台部</b>", "right": "2025.06 – 2025.12" },
      "items": [{ "kind": "para", "role": "body", "list": "disc", "html": "<b>背景与目标</b>：……" }]
    }]
  }],
  "style": { "page": { "name": "A4", "w": 210, "h": 297 }, "font": "song", "fontSize": 9.5, "accent": "#2f5bd3", "cols": null }
}
```

## 只要纯文本？

遍历 `header.items`、`body`、`side`，把每个段落的 `html` 去掉标签即可；模块标题是 `role === 'title'` 的段落，经历标题是 `role === 'head'`。
