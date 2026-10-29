// SPDX-License-Identifier: AGPL-3.0-only
// 冒烟测试：用本机 Chrome 打开演示页，解析示例简历，检查识别结果；加 --shot 时顺便更新 README 里的对比截图
// 用法：npm run dev（另开终端） → npm run smoke [-- --shot]
import puppeteer from 'puppeteer-core';

const URL = process.env.PLAYGROUND_URL || 'http://localhost:5190/';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 2 });
const errors = [];
p.on('pageerror', e => errors.push(e.message));
await p.goto(URL, { waitUntil: 'networkidle0' });
await p.$$eval('button', bs => bs.find(x => x.textContent.includes('示例简历')).click());
await p.waitForSelector('.paper .rs', { timeout: 30000 });
await new Promise(r => setTimeout(r, 800));
const bar = await p.$eval('.bar span', e => e.textContent);
const [sections, entries] = (bar.match(/\d+/g) || []).map(Number);
console.log('解析结果：', bar);
if (process.argv.includes('--shot')) {
  await p.screenshot({ path: 'docs/images/compare.png', clip: { x: 0, y: 150, width: 1400, height: 850 } });
  console.log('已更新 docs/images/compare.png');
}
await b.close();
if (errors.length) { console.error('页面报错：', errors); process.exit(1); }
if (!(sections >= 4 && entries >= 8)) { console.error('识别结果低于预期（示例简历应有 ≥4 个模块、≥8 段经历）'); process.exit(1); }
console.log('✓ 冒烟测试通过');
