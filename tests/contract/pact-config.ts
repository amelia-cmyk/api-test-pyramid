import path from 'node:path';

/** Shared between the consumer test (writes the contract) and the provider test (verifies it). */
export const CONSUMER = 'LibraryMobileApp';
export const PROVIDER = 'LibraryAPI';
export const PACT_DIR = path.resolve(import.meta.dirname, '../../pacts');
export const PACT_FILE = path.join(PACT_DIR, `${CONSUMER}-${PROVIDER}.json`);

/**
 * Provider states: the situation the provider must be in before an interaction is replayed.
 * Using constants keeps the consumer and provider spelling in sync.
 */
export const STATES = {
  bookExists: 'book 1 exists with 2 available copies',
  noBooks: 'no books exist',
  availableBooksExist: 'some books are available and some are fully borrowed',
  memberCanBorrow: 'member 1 can borrow book 1',
  memberAtLoanLimit: 'member 1 has reached the loan limit',
  loanReturnedLate: 'loan 1 is returned 3 days after its due date',
} as const;

export const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
