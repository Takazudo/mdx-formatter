import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: [...configDefaults.exclude, 'test/rust-formatter.test.ts', 'test/rust-passthrough.test.ts', 'worktrees/**', 'doc/**'],
  },
});
