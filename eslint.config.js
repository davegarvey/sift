import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'server/**/*.ts', 'tests/**/*.ts', 'vite.config.ts', 'vitest.config.ts', '.opencode/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        DOMParser: 'readonly',
        ReadableStream: 'readonly',
        IDBKeyRange: 'readonly',
        btoa: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        indexedDB: 'readonly',
        self: 'readonly',
        window: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-wrapper-object-types': 'off',
      'no-empty': 'off',
      'no-constant-condition': 'off',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', '.wrangler/**'],
  },
  {
    files: ['server/sync.ts', 'server/sync/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
);