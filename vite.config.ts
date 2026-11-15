/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/** Build id: the commit (GitHub Actions sets GITHUB_SHA), or 'dev' locally. */
const BUILD = process.env.GITHUB_SHA?.slice(0, 7) ?? 'dev';

/** Writes version.json next to index.html so a running page can see a newer deploy. */
function versionFile(): Plugin {
  return {
    name: 'agentwall-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build: BUILD, builtAt: new Date().toISOString() }),
      });
    },
  };
}

export default defineConfig({
  plugins: [iwsdkDev(), versionFile()],
  define: { __AGENTWALL_BUILD__: JSON.stringify(BUILD) },
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    // Only the two icons the UI kit needs, not the 4.1 MB icon set (see src/stubs).
    alias: [
      {
        find: /^@pmndrs\/uikit-lucide$/,
        replacement: fileURLToPath(new URL('./src/stubs/uikit-lucide-lite.ts', import.meta.url)),
      },
    ],
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
