import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Konfiguracja minimalna — celowo.
 *
 * Sekcja 12 planu umieszcza pełny pipeline (lint + test + security gate)
 * w Fazie 1. Tutaj jest tylko tyle, żeby `npm run lint` faktycznie coś
 * sprawdzał: reguły typu-aware kosztują czas uruchomienia i wchodzą razem
 * z resztą pipeline'u, a nie przed nim.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'dist-single/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      // Prefiks podkreślenia jako świadome „nieużywane".

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  {
    // Skrypty budujące działają w Node, nie w przeglądarce.
    files: ['scripts/**/*.mjs', '*.config.js'],
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly' },
    },
  },
);
