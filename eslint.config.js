import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';

const sharedGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  Headers: 'readonly',
  FormData: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  process: 'readonly',
  module: 'readonly',
  require: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
};

const vitestGlobals = {
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  vi: 'readonly',
  beforeAll: 'readonly',
  afterAll: 'readonly',
  beforeEach: 'readonly',
  afterEach: 'readonly',
};

const tsConfigs = tsPlugin.configs['flat/recommended'].map((config) => ({
  ...config,
  files: config.files ?? ['**/*.{ts,tsx,cts,mts}'],
  languageOptions: {
    ...(config.languageOptions ?? {}),
    parser: tsParser,
    parserOptions: {
      ...(config.languageOptions?.parserOptions ?? {}),
      ecmaFeatures: {
        ...(config.languageOptions?.parserOptions?.ecmaFeatures ?? {}),
        jsx: true,
      },
    },
    globals: sharedGlobals,
  },
}));

const reactFlatRecommended = reactPlugin.configs.flat.recommended;

export default [
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      'data/**',
      '**/*.d.ts',
      'extension/icons/**',
    ],
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    ...js.configs.recommended,
    languageOptions: {
      ...(js.configs.recommended.languageOptions ?? {}),
      globals: {
        ...(js.configs.recommended.languageOptions?.globals ?? {}),
        ...sharedGlobals,
      },
    },
  },
  ...tsConfigs,
  {
    files: ['**/*.{ts,tsx,cts,mts}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: {
      ...(reactFlatRecommended.plugins ?? {}),
      'react-hooks': reactHooksPlugin,
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    languageOptions: {
      ...(reactFlatRecommended.languageOptions ?? {}),
      parser: tsParser,
      parserOptions: {
        ...(reactFlatRecommended.languageOptions?.parserOptions ?? {}),
        ecmaFeatures: {
          ...(reactFlatRecommended.languageOptions?.parserOptions?.ecmaFeatures ?? {}),
          jsx: true,
        },
      },
      globals: sharedGlobals,
    },
    rules: {
      ...(reactFlatRecommended.rules ?? {}),
      ...(reactPlugin.configs['jsx-runtime']?.rules ?? {}),
      ...(reactHooksPlugin.configs.recommended.rules ?? {}),
      'react/react-in-jsx-scope': 'off',
    },
  },
  {
    files: ['**/*.{test,spec}.{ts,tsx,js,jsx}'],
    languageOptions: {
      globals: {
        ...sharedGlobals,
        ...vitestGlobals,
      },
    },
  },
  prettierConfig,
];
