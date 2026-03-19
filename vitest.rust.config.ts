import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/rust-formatter.test.ts'],
    globals: true,
  },
});
