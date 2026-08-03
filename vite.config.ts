import { defineConfig } from 'vite';

export default defineConfig({
  base: '/recycle-factory/',
  server: {
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
