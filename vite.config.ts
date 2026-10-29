// SPDX-License-Identifier: AGPL-3.0-only
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 库构建：dist/index.js（解析）和 dist/render.js（React 渲染组件）
export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: false,
    lib: { entry: { index: 'src/index.ts', render: 'src/render/index.ts' }, formats: ['es'] },
    rollupOptions: { external: [/^pdfjs-dist/, 'react', 'react/jsx-runtime', 'react-dom'] },
  },
});
