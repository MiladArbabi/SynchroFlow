module.exports = {
  root: true,
  extends: ['../../.eslintrc.cjs'], // adapt if you use JSON or different file at repo root
  parserOptions: {
    project: ['./tsconfig.vite.json']
  },
  rules: {
    // keep this file minimal — only to ensure typed linting works for vite.config.ts
  }
};
