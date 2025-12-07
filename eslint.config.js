import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.test.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // 允许未使用的参数（常见于回调函数）
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
      // 允许 @ts-ignore 等注释
      '@typescript-eslint/ban-ts-comment': 'off',
      // 允许空函数（常见于占位符）
      '@typescript-eslint/no-empty-function': 'off',
      // 允许使用 prototype 方法
      'no-prototype-builtins': 'off',
      // 允许显式 any 类型（逐步迁移）
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // 测试文件的特殊规则
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // 忽略的文件和目录
    ignores: [
      'main.js',
      'node_modules/**',
      'coverage/**',
      '*.config.js',
      '*.config.cjs',
      '*.config.mjs',
    ],
  }
);
