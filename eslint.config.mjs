// Lint: what the compiler cannot see. Hooks rules first (a stale closure in an effect is how a note once saved
// into the wrong chat), then the TypeScript recommendations. Types are checked by `npm run typecheck`.
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', 'design/**', 'resources/**', 'build/**', 'setup/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // `_name` is the house way of saying "deliberately unused" (and rest siblings drop fields on purpose).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true, caughtErrors: 'none' }],
      // `err ? reject(err) : resolve()` and `ok && run()` are statements here on purpose.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
      // A `let` declared early because a closure reads it before the one assignment (adapters, the later service).
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }]
    }
  },
  {
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
)
