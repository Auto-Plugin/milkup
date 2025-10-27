import antfu from '@antfu/eslint-config'
import oxlint from 'eslint-plugin-oxlint'

export default antfu({
  ...oxlint.configs['flat/recommended'],
  vue: {
    overrides: {
      'vue/html-self-closing': 'off',
    },
  },
  typescript: {
    overrides: {
      'ts/ban-ts-comment': 'off',
    },
  },
  ignores: [
    '**/renderer/main.ts',
    '**/renderer/theme-editor-main.ts',
    '**/*.md',
    '**/iconfont',
    'lang/index.js',
  ],
  rules: {
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
    'no-console': 'off',
    'on-debug': 'off',
    'style/space-in-parens': 'off',
    'style/max-statements-per-line': 'off',
    'style/brace-style': ['error', '1tbs', { allowSingleLine: false }],
    'unused-imports/no-unused-vars': 'off',
  },
})
