// The lint run by `npm run lint` and in CI: plain mistakes (undefined names, unused variables,
// unreachable code, shadowed names), no style rules. Warnings fail the run too.
import globals from 'globals';

export default [
  { ignores: ['dist/', 'build/', 'vendor/', 'node_modules/'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, AFRAME: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-self-assign': 'error',
      'no-dupe-class-members': 'error',
      'no-redeclare': 'error',
      'no-unused-expressions': 'warn',
      'no-shadow': ['warn', { builtinGlobals: false }],
      'no-constant-condition': 'warn',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-mixed-operators': ['warn', { groups: [['&&', '||', '??']] }],
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
    },
  },
];
