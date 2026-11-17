import { defineConfig } from 'vitest/config';

/**
 * Each layer of the test pyramid is its own Vitest project, so it can run on its own
 * (`npm run test:unit`) and shows up as a separate group in the report.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html', 'json-summary'],
      // Business rules are pure functions, so they must be fully covered.
      thresholds: {
        'src/domain/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  },
});
