# 参与贡献

感谢你愿意帮忙改进 easycv-parser！

## 报告识别问题

最有价值的反馈是“某种版式识别错了”。提交前请：

1. **不要上传含真实个人信息的简历**（姓名、电话、邮箱、身份证号、住址等）。请把内容替换成虚构信息、保留原来的版式后再附上；或者只附截图并打码。
2. 说明：文件格式（PDF / DOCX / HTML）、简历是用什么工具做的（Word、WPS、某个简历网站……）、哪里识别错了、你期望的结果。
3. 在演示页（`npm run dev`）里截一张“原稿 / 解析后重新渲染”的对比图。

## 开发

```bash
npm install
npm run dev         # 演示页 http://localhost:5190
npm run typecheck
npm run build       # 构建 dist/
npm run smoke       # 冒烟测试（需要先 npm run dev，且本机装有 Chrome；可用 CHROME_PATH 指定）
```

代码结构：

```
src/
  index.ts            对外 API：parseResume / extract / buildResume
  parser/             提取（pdf / html / docx）、版面分析（layout）、结构识别与样式还原（structure）
  model/              数据类型与默认值
  render/             只读渲染组件
playground/           演示页
examples/             示例简历（内容全部虚构）
```

## 提交 PR

- 一个 PR 只做一件事，说明改动解决了哪种版式的问题，附上修改前后的对比截图。
- 改动识别逻辑时，确认示例简历的识别结果没有变差（`npm run smoke`）。
- 新增的测试样例必须是虚构内容。
- 第一次提 PR 时，CLA 机器人会请你签署[贡献者许可协议](CLA.md)：在 PR 下回复 `I have read the CLA Document and I hereby sign the CLA` 即可，只需一次。
  - 为什么需要 CLA：本项目以 AGPL-3.0 开源，同时项目所有者会提供商业授权；CLA 让项目所有者可以把包含你贡献的代码以其他许可证发布。你仍然保留自己贡献的版权。
