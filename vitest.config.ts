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
      {
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          // Starting an in-memory PostgreSQL takes a moment, so hooks get more time than the default
          hookTimeout: 30_000,
        },
      },
      // Contract tests run as two steps, in order: the consumer writes the pact file, the provider verifies it.
      // See the "test:contract" script.
      {
        test: {
          name: 'contract-consumer',
          include: ['tests/contract/consumer.pact.test.ts'],
        },
      },
      {
        test: {
          name: 'contract-provider',
          include: ['tests/contract/provider.pact.test.ts'],
          hookTimeout: 30_000,
          testTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'], // process entry point only: reads env vars and starts listening
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        // The whole codebase must stay well covered...
        lines: 95,
        branches: 90,
        functions: 90,
        statements: 95,
        // ...and business rules are pure functions, so they must be fully covered.
        'src/domain/**': { lines: 100, branches: 100, functions: 100, statements: 100 },
      },
    },
  },
});
