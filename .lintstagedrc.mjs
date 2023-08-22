export default {
    "**/*.ts": [
      "eslint --cache --fix",
      () => 'tsc -p tsconfig.json --noEmit',
      "npm run pretty:ts"
    ],
    "package.json": [
      "prettier-package-json --write"
    ]
  }