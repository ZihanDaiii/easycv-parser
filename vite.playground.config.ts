// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 在线演示：上传简历 → 查看解析结果（还原效果 + 结构化 JSON）
export default defineConfig({
  root: 'playground',
  publicDir: 'public',
  base: './',
  plugins: [react()],
  server: { port: 5190 },
  build: { outDir: '../dist-playground', emptyOutDir: true },
});
