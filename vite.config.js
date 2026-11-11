import { defineConfig } from 'vite';

// The web app lives in web/; the engine it imports sits beside it in engine/.
// `npm run build` writes the site to dist/, which the iOS and Android apps wrap.
export default defineConfig({
  root: 'web',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2019' },
  server: { fs: { allow: ['..'] } },
});
