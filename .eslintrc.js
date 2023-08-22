module.exports = {
  extends: [
    'airbnb-base',
    'airbnb-typescript/base',
    'prettier'
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  rules: {
    // avoid unnecessary console logging, use explicit logging instead
    'no-console': 'error',

    // disable this rule because nest actively uses named exports
    'import/prefer-default-export': 'off',

    // disable this rule because nest actively uses instance methods without relying on this
    'class-methods-use-this': 'off',

    // disable this rule because nest actively uses multiple classes per file
    'max-classes-per-file': 'off',

    // disable this rule because IMO this is absolutely safe
    'no-plusplus': 'off',

    // override AirBNB rule: allow for-of statements
    // https://github.com/airbnb/javascript/blob/b6fc6dc7c3cb76497db0bb81edaa54d8f3427796/packages/eslint-config-airbnb-base/rules/style.js#L257
    'no-restricted-syntax': [
      'error',
      'ForInStatement',
      // 'ForOfStatement',
      'LabeledStatement',
      'WithStatement',
    ],
  },
};
