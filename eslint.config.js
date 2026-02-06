export default [
  {
    ignores: ['node_modules/', 'dist/', 'build/', 'coverage/'],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['error'] }],
    },
  },
  {
    files: ['src/cli.js', 'format-stdin.js'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['test/**/*.js'],
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
