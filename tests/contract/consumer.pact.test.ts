import { MatchersV3, PactV4 } from '@pact-foundation/pact';
import { describe, expect, it } from 'vitest';
import { LibraryClient } from '../../consumer/library-client.js';
import { CONSUMER, ISO_DATETIME, PACT_DIR, PROVIDER, STATES } from './pact-config.js';

const { eachLike, integer, regex, string } = MatchersV3;

/**
 * CONSUMER side. Each test:
 *  1. declares what the app sends and the minimum it needs back (with type matchers, not exact values),
 *  2. runs the real client against a Pact mock server that answers exactly that,
 *  3. on success, Pact writes the interaction into the contract file (pacts/*.json).
 */
const pact = new PactV4({ consumer: CONSUMER, provider: PROVIDER, dir: PACT_DIR, logLevel: 'warn' });

// Only the fields the app uses. Matchers mean "any integer/string", so the contract is about shape, not data.
const bookShape = {
  id: integer(1),
  title: string('Clean Code'),
  author: string('Robert C. Martin'),
  availableCopies: integer(2),
};

// `code` is a plain value, so it must match EXACTLY (the app branches on it); `message` may be any text.
// (Wrapping the whole object in like() would have turned `code` into "any string" too.)
const errorShape = (code: string) => ({ error: { code, message: string('Human readable reason') } });

describe('Library Mobile App -> Library API contract', () => {
  it('gets a book by id', async () => {
    await pact
      .addInteraction()
      .given(STATES.bookExists)
      .uponReceiving('a request for book 1')
      .withRequest('GET', '/books/1', (req) => req.headers({ Accept: 'application/json' }))
      // Pact regexes must match the WHOLE value, so allow parameters such as "; charset=utf-8"
      .willRespondWith(200, (res) =>
        res.headers({ 'Content-Type': regex(/^application\/json(;.*)?$/, 'application/json') }).jsonBody(bookShape),
      )
      .executeTest(async (mockServer) => {
        const book = await new LibraryClient(mockServer.url).getBook(1);
        expect(book).toEqual({ id: 1, title: 'Clean Code', author: 'Robert C. Martin', availableCopies: 2 });
      });
  });

  it('gets null for a book that does not exist', async () => {
    await pact
      .addInteraction()
      .given(STATES.noBooks)
      .uponReceiving('a request for a book that does not exist')
      .withRequest('GET', '/books/999', (req) => req.headers({ Accept: 'application/json' }))
      .willRespondWith(404, (res) => res.jsonBody(errorShape('NOT_FOUND')))
      .executeTest(async (mockServer) => {
        expect(await new LibraryClient(mockServer.url).getBook(999)).toBeNull();
      });
  });

  it('lists available books', async () => {
    await pact
      .addInteraction()
      .given(STATES.availableBooksExist)
      .uponReceiving('a request for available books')
      .withRequest('GET', '/books', (req) => req.query({ available: 'true' }).headers({ Accept: 'application/json' }))
      // eachLike: an array with at least one element shaped like this
      .willRespondWith(200, (res) => res.jsonBody(eachLike(bookShape)))
      .executeTest(async (mockServer) => {
        const books = await new LibraryClient(mockServer.url).listAvailableBooks();
        expect(books.length).toBeGreaterThan(0);
        expect(books[0]).toHaveProperty('availableCopies');
      });
  });

  it('borrows a book', async () => {
    await pact
      .addInteraction()
      .given(STATES.memberCanBorrow)
      .uponReceiving('a request to borrow book 1 for member 1')
      .withRequest('POST', '/loans', (req) =>
        req.headers({ 'Content-Type': 'application/json' }).jsonBody({ bookId: 1, memberId: 1 }),
      )
      .willRespondWith(201, (res) =>
        res.jsonBody({ id: integer(1), dueAt: regex(ISO_DATETIME, '2026-03-15T09:00:00.000Z') }),
      )
      .executeTest(async (mockServer) => {
        const result = await new LibraryClient(mockServer.url).borrow(1, 1);
        expect(result).toEqual({ ok: true, loan: { id: 1, dueAt: new Date('2026-03-15T09:00:00.000Z') } });
      });
  });

  it('learns why a loan was refused', async () => {
    await pact
      .addInteraction()
      .given(STATES.memberAtLoanLimit)
      .uponReceiving('a request to borrow when the member is at the loan limit')
      .withRequest('POST', '/loans', (req) =>
        req.headers({ 'Content-Type': 'application/json' }).jsonBody({ bookId: 1, memberId: 1 }),
      )
      // The app shows a different message per reason, so the exact code IS part of the contract
      .willRespondWith(409, (res) => res.jsonBody(errorShape('LOAN_LIMIT_REACHED')))
      .executeTest(async (mockServer) => {
        const result = await new LibraryClient(mockServer.url).borrow(1, 1);
        expect(result).toEqual({ ok: false, reason: 'LOAN_LIMIT_REACHED' });
      });
  });

  it('returns a late book and gets the late fee', async () => {
    await pact
      .addInteraction()
      .given(STATES.loanReturnedLate)
      .uponReceiving('a request to return loan 1')
      .withRequest('POST', '/loans/1/return', (req) => req.headers({ Accept: 'application/json' }))
      .willRespondWith(200, (res) => res.jsonBody({ lateDays: integer(3), lateFee: integer(6000) }))
      .executeTest(async (mockServer) => {
        const result = await new LibraryClient(mockServer.url).returnLoan(1);
        expect(result).toEqual({ lateDays: 3, lateFee: 6000 });
      });
  });
});
