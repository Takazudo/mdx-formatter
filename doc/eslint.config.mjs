import globals from 'globals';
import js from '@eslint/js';
import typescript from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import eslintReact from 'eslint-plugin-react';
import eslintReactHooks from 'eslint-plugin-react-hooks';
import prettierPlugin from 'eslint-plugin-prettier';
import eslintConfigPrettier from 'eslint-config-prettier';

/** @type {import('eslint').Linter.FlatConfig[]} */
export default [
  // Main configuration for source files
  {
    files: ['**/*.{js,mjs,cjs,jsx,ts,tsx}'],
    ignores: [
      'dist/**',
      'node_modules/**',
      '.git/**',
      '.docusaurus/**',
      'build/**',
      'coverage/**',
      '.cache/**',
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    settings: { react: { version: 'detect' } },
    plugins: {
      '@typescript-eslint': typescript,
      react: eslintReact,
      'react-hooks': eslintReactHooks,
      prettier: prettierPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...typescript.configs.recommended.rules,
      ...eslintReact.configs.recommended.rules,
      ...eslintReact.configs['jsx-runtime'].rules,
      ...eslintReactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'prettier/prettier': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      ...eslintConfigPrettier.rules,
    },
  },
  // Configuration for config files
  {
    files: ['*.config.js', '*.config.ts', 'docusaurus.config.js'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.node },
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      prettier: prettierPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...typescript.configs.recommended.rules,
      'prettier/prettier': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-undef': 'off', // Node.js globals
      ...eslintConfigPrettier.rules,
    },
  },
];
