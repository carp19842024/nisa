import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相対パスで出力し、GitHub Pages のサブパスや Netlify にそのまま置けるようにする
  base: './',
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
