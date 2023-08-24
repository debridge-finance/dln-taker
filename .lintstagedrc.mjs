export default {
    "**/*.ts": [
      "eslint --cache --fix",
      () => 'npm run lint:tsc',
      "npm run pretty:ts"
    ],
    "package.json": [
      "prettier-package-json --write"
    ]
  }