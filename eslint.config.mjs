import antfu from '@antfu/eslint-config'

export default antfu({
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
    '**/*.md',
    '**/iconfont',
  ],
  rules: {
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
    'no-console': 'off',
    'on-debug': 'off',
    'style/space-in-parens': 'off',
    'style/max-statements-per-line': 'off',
    'unused-imports/no-unused-vars': 'off',
  },
})
