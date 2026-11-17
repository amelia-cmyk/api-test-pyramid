import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['node_modules', 'coverage', 'dist', 'pacts', 'eslint.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // Parameters starting with "_" are required by a signature but intentionally unused
      // (e.g. Express only treats a middleware as an error handler when it takes 4 arguments)
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // HTTP response bodies are untyped (`any`) by nature; the tests' assertions are what check their shape.
    // Application code under src/ keeps the strict rules.
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  prettier,
);
