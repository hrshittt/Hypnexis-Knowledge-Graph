// ESLint 8 config matching the installed devDependencies (@typescript-eslint v7, react-hooks, react-refresh).
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', 'node_modules', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
  },
  overrides: [
    {
      // These modules deliberately export helpers next to their components: context providers with
      // their hooks (auth, toast), UI-kit variants, route guards, shared formatters and view helpers.
      // Fast refresh just falls back to a full reload for them in dev, so the hint is noise here.
      files: [
        'src/lib/*.tsx',
        'src/components/ui/*.tsx',
        'src/components/workspace/MetaEditor.tsx',
        'src/routes/guards.tsx',
        'src/pages/app/ActivityPage.tsx',
        'src/workspaces/*/shared.tsx',
        'src/workspaces/research/PaperView.tsx',
      ],
      rules: { 'react-refresh/only-export-components': 'off' },
    },
  ],
};
