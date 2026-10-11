import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import angularPlugin from '@angular-eslint/eslint-plugin';
import templateParser from '@angular-eslint/template-parser';
import templatePlugin from '@angular-eslint/eslint-plugin-template';

export default [
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 'latest', sourceType: 'module' } },
    plugins: { '@typescript-eslint': tsPlugin, '@angular-eslint': angularPlugin },
    rules: {
      'no-debugger': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
      '@angular-eslint/contextual-lifecycle': 'error',
    },
  },
  {
    files: ['src/**/*.html'],
    languageOptions: { parser: templateParser },
    plugins: { '@angular-eslint/template': templatePlugin },
    rules: { '@angular-eslint/template/banana-in-box': 'error' },
  },
];
