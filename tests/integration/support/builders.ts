import type request from 'supertest';
import type { Book, Loan, Member } from '../../../src/services/library-service.js';

type Api = ReturnType<typeof request>;

let sequence = 0;
const next = () => ++sequence;

/** Builds a valid ISBN-13 (978 + 9 digits + check digit) that is unique within the test run. */
export function uniqueIsbn(): string {
  const body = `978${String(next()).padStart(9, '0')}`;
  const sum = [...body].reduce((acc, digit, i) => acc + Number(digit) * (i % 2 === 0 ? 1 : 3), 0);
  return body + String((10 - (sum % 10)) % 10);
}

/** Valid request bodies with sensible defaults; a test only overrides what it cares about. */
export const aBook = (overrides: Record<string, unknown> = {}) => ({
  title: 'Clean Code',
  author: 'Robert C. Martin',
  isbn: uniqueIsbn(),
  copies: 2,
  ...overrides,
});

export const aMember = (overrides: Record<string, unknown> = {}) => ({
  name: 'Siti Rahma',
  email: `member${next()}@example.com`,
  ...overrides,
});

// Arrange helpers: create data through the public API, exactly like a real client would
export async function createBook(api: Api, overrides: Record<string, unknown> = {}): Promise<Book> {
  const res = await api.post('/books').send(aBook(overrides)).expect(201);
  return res.body as Book;
}

export async function createMember(api: Api, overrides: Record<string, unknown> = {}): Promise<Member> {
  const res = await api.post('/members').send(aMember(overrides)).expect(201);
  return res.body as Member;
}

export async function borrow(api: Api, bookId: number, memberId: number): Promise<Loan> {
  const res = await api.post('/loans').send({ bookId, memberId }).expect(201);
  return res.body as Loan;
}
