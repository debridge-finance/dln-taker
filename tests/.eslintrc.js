module.exports = {
  rules: {
    // allow console for tests
    'no-console': 'off',

    // disable this rule because specs often call `it(async () => {})` within loops
    '@typescript-eslint/no-loop-func': 'off',

    // disable this rule because specs should not be necessary strict, they don't have
    // security impact
    'default-case': 'off',

    // disable this rule because specs often use helper functions defined in the bottom of a file
    '@typescript-eslint/no-use-before-define': 'off',

    // disable this rule because specs use unnamed function(){}s for grouping
    'func-names': 'off'
  },
};
