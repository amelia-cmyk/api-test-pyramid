import { describe, expect, it } from 'vitest';
import { LOAN_POLICY } from '../../src/domain/loan-policy.js';
import { borrow, createBook, createMember } from './support/builders.js';
import { START_TIME, useTestApp } from './support/test-app.js';

const t = useTestApp();

describe('POST /loans (borrow)', () => {
  it('creates a loan due in 14 days and takes one copy out of stock', async () => {
    const book = await createBook(t.api, { copies: 2 });
    const member = await createMember(t.api);

    const res = await t.api.post('/loans').send({ bookId: book.id, memberId: member.id });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      bookId: book.id,
      memberId: member.id,
      borrowedAt: START_TIME,
      dueAt: '2026-03-15T09:00:00.000Z',
      returnedAt: null,
      lateFee: null,
    });
    await t.api.get(`/books/${book.id}`).expect(200, { ...book, availableCopies: 1 });
    expect((await t.api.get(`/members/${member.id}`)).body.activeLoans).toBe(1);
  });

  it(`rejects loan number ${LOAN_POLICY.maxActiveLoans + 1} and leaves the database unchanged`, async () => {
    const member = await createMember(t.api);
    for (let i = 0; i < LOAN_POLICY.maxActiveLoans; i++) {
      await borrow(t.api, (await createBook(t.api)).id, member.id);
    }
    const extraBook = await createBook(t.api, { copies: 1 });

    const res = await t.api.post('/loans').send({ bookId: extraBook.id, memberId: member.id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('LOAN_LIMIT_REACHED');
    // The transaction must not leave half-done work behind
    const { rows } = await t.db.query<{ count: number }>(`SELECT count(*)::int AS count FROM loans`);
    expect(rows[0]?.count).toBe(LOAN_POLICY.maxActiveLoans);
    await t.api.get(`/books/${extraBook.id}`).expect(200, { ...extraBook, availableCopies: 1 });
  });

  it('rejects borrowing when no copies are left, without going below zero', async () => {
    const book = await createBook(t.api, { copies: 1 });
    await borrow(t.api, book.id, (await createMember(t.api)).id);

    const res = await t.api.post('/loans').send({ bookId: book.id, memberId: (await createMember(t.api)).id });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOK_UNAVAILABLE');
    expect((await t.api.get(`/books/${book.id}`)).body.availableCopies).toBe(0);
  });

  it('gives the last copy to exactly one of two simultaneous requests', async () => {
    const book = await createBook(t.api, { copies: 1 });
    const [alice, bob] = [await createMember(t.api), await createMember(t.api)];

    const responses = await Promise.all([
      t.api.post('/loans').send({ bookId: book.id, memberId: alice.id }),
      t.api.post('/loans').send({ bookId: book.id, memberId: bob.id }),
    ]);

    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await t.api.get(`/books/${book.id}`)).body.availableCopies).toBe(0);
  });

  it('blocks a member with an overdue loan until it is returned', async () => {
    const member = await createMember(t.api);
    const overdue = await borrow(t.api, (await createBook(t.api)).id, member.id);
    const wanted = await createBook(t.api);

    t.clock.advanceDays(LOAN_POLICY.loanPeriodDays + 1);
    const blocked = await t.api.post('/loans').send({ bookId: wanted.id, memberId: member.id });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('HAS_OVERDUE_LOAN');

    await t.api.post(`/loans/${overdue.id}/return`).expect(200);
    await t.api.post('/loans').send({ bookId: wanted.id, memberId: member.id }).expect(201);
  });

  it.each([
    { target: 'book', status: 404 },
    { target: 'member', status: 404 },
  ])('returns 404 when the $target does not exist', async ({ target }) => {
    const book = await createBook(t.api);
    const member = await createMember(t.api);
    const body = target === 'book' ? { bookId: 999, memberId: member.id } : { bookId: book.id, memberId: 999 };

    const res = await t.api.post('/loans').send(body);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 when ids are missing or not integers', async () => {
    const res = await t.api.post('/loans').send({ bookId: '1' });
    expect(res.status).toBe(400);
    const fields = (res.body.error.details as { field: string }[]).map((d) => d.field).sort();
    expect(fields).toEqual(['bookId', 'memberId']);
  });
});

describe('POST /loans/:id/return', () => {
  it('returns on time with no fee and puts the copy back', async () => {
    const book = await createBook(t.api, { copies: 1 });
    const loan = await borrow(t.api, book.id, (await createMember(t.api)).id);
    t.clock.advanceDays(LOAN_POLICY.loanPeriodDays); // exactly on the due date

    const res = await t.api.post(`/loans/${loan.id}/return`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ lateDays: 0, lateFee: 0, returnedAt: '2026-03-15T09:00:00.000Z' });
    expect((await t.api.get(`/books/${book.id}`)).body.availableCopies).toBe(1);
  });

  it.each([
    { daysLate: 1, fee: 2_000 },
    { daysLate: 10, fee: 20_000 },
    { daysLate: 40, fee: LOAN_POLICY.maxLateFee },
  ])('charges Rp$fee when returned $daysLate day(s) late, and stores it', async ({ daysLate, fee }) => {
    const loan = await borrow(t.api, (await createBook(t.api)).id, (await createMember(t.api)).id);
    t.clock.advanceDays(LOAN_POLICY.loanPeriodDays + daysLate);

    const res = await t.api.post(`/loans/${loan.id}/return`).expect(200);

    expect(res.body).toMatchObject({ lateDays: daysLate, lateFee: fee });
    const { rows } = await t.db.query(`SELECT late_fee FROM loans WHERE id = $1`, [loan.id]);
    expect(rows).toEqual([{ late_fee: fee }]);
  });

  it('cannot return the same loan twice (stock is not increased again)', async () => {
    const book = await createBook(t.api, { copies: 1 });
    const loan = await borrow(t.api, book.id, (await createMember(t.api)).id);
    await t.api.post(`/loans/${loan.id}/return`).expect(200);

    const res = await t.api.post(`/loans/${loan.id}/return`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_RETURNED');
    expect((await t.api.get(`/books/${book.id}`)).body.availableCopies).toBe(1);
  });

  it('returns 404 for an unknown loan', async () => {
    await t.api.post('/loans/999/return').expect(404);
  });
});

describe('GET /members/:id/loans', () => {
  it("lists a member's loans, active and returned", async () => {
    const member = await createMember(t.api);
    const first = await borrow(t.api, (await createBook(t.api)).id, member.id);
    const second = await borrow(t.api, (await createBook(t.api)).id, member.id);
    await t.api.post(`/loans/${first.id}/return`).expect(200);

    const res = await t.api.get(`/members/${member.id}/loans`).expect(200);

    expect(res.body.map((l: { id: number; returnedAt: string | null }) => [l.id, l.returnedAt !== null])).toEqual([
      [first.id, true],
      [second.id, false],
    ]);
  });
});
