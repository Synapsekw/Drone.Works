import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/.drone-works/**',
      '**/.next/**',
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      'spikes/**/internal-build/work/**',
      'spikes/**/internal-build/publish/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@drone-works/database', '@drone-works/database/*'],
              message: 'The web application must use the versioned API client.',
            },
          ],
        },
      ],
    },
  },
);
