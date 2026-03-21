import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/rust-passthrough.test.ts'],
    globals: true,
  },
});
