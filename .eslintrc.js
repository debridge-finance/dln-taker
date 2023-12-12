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
  plugins: ['@typescript-eslint/eslint-plugin', 'eslint-comments'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  reportUnusedDisableDirectives: true,
  rules: {
    // currently, dln-taker has ineffective architecture, must be refactored first before enabling this rule
    // TODO: refactor class graph / architecture of the dln-taker
    'import/no-cycle': 'off',

    // avoid unnecessary console logging, use explicit logging instead
    'no-console': 'error',

    // prefer named exports over default exports; exception: sample.config.ts
    'import/prefer-default-export': 'off',
    'import/no-default-export': 'error',

    // disable this rule because IMO this is absolutely safe
    'no-plusplus': 'off',

    // keep no-empty-pattern, but still allow empty objects to be used as stubs for unused parameters as this is the
    // only way to leave function parameters visible, e.g.:
    // async (/* chainId: ChainId */{}, /* context: OrderFilterInitContext */{}) => {}
    'no-empty-pattern': ["error", { "allowObjectPatternsAsParameters": true }],

    // disabling eslint rules is a bad-smelling practice. Give descriptive argument each time the rule is contextually disabled
    "eslint-comments/require-description": ["error", {"ignore": []}],

    // override AirBNB rule: allow for-of statements
    // https://github.com/airbnb/javascript/blob/b6fc6dc7c3cb76497db0bb81edaa54d8f3427796/packages/eslint-config-airbnb-base/rules/style.js#L257
    'no-restricted-syntax': [
      'error',
      'ForInStatement',
      // 'ForOfStatement', <-- commented out to enable for(... of ...)
      'LabeledStatement',
      'WithStatement',
    ],

    'max-classes-per-file': 'off',
  },
  overrides: [{
    files: ["*.test.ts"],
    rules: {
      // allow console for tests
      'no-console': 'off',

      // tests may do more
      'no-await-in-loop': 'off',

      // disable this rule because specs often call `it(async () => {})` within loops
      '@typescript-eslint/no-loop-func': 'off',

      // disable this rule because specs should not be necessary strict, they don't have
      // security impact
      'default-case': 'off',

      // disable this rule because specs often use helper functions defined in the bottom of a file
      '@typescript-eslint/no-use-before-define': 'off',

      // disable this rule because specs use unnamed function(){}s for grouping
      'func-names': 'off',

      // for interface compatibility
      '@typescript-eslint/no-unused-vars': [
        "error",
        {
          "argsIgnorePattern": "^_",
        }
      ]
    },
  }]
};
