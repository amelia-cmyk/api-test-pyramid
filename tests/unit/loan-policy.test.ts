import { describe, expect, it } from 'vitest';
import {
  LOAN_POLICY,
  calculateDueDate,
  calculateLateFee,
  checkBorrowEligibility,
  daysLate,
  isOverdue,
} from '../../src/domain/loan-policy.js';

const utc = (iso: string) => new Date(`${iso}Z`);

describe('checkBorrowEligibility', () => {
  const okMember = { activeLoans: 0, hasOverdueLoan: false };
  const inStock = { availableCopies: 1 };

  it('allows a member in good standing to borrow a book in stock', () => {
    expect(checkBorrowEligibility(okMember, inStock)).toEqual({ allowed: true });
  });

  // Boundary value analysis around the loan limit (max = 3)
  it.each([
    { activeLoans: 2, expected: { allowed: true } },
    { activeLoans: 3, expected: { allowed: false, reason: 'LOAN_LIMIT_REACHED' } },
    { activeLoans: 4, expected: { allowed: false, reason: 'LOAN_LIMIT_REACHED' } },
  ])('BVA: member with $activeLoans active loans -> $expected.allowed', ({ activeLoans, expected }) => {
    expect(checkBorrowEligibility({ ...okMember, activeLoans }, inStock)).toEqual(expected);
  });

  // Boundary value analysis around stock (min = 1 copy)
  it.each([
    { availableCopies: 1, allowed: true },
    { availableCopies: 0, allowed: false },
  ])('BVA: book with $availableCopies available copies -> allowed: $allowed', ({ availableCopies, allowed }) => {
    expect(checkBorrowEligibility(okMember, { availableCopies }).allowed).toBe(allowed);
  });

  // Decision table: when several rules fail at once, the most actionable reason wins
  it.each([
    { member: { activeLoans: 3, hasOverdueLoan: true }, copies: 0, reason: 'HAS_OVERDUE_LOAN' },
    { member: { activeLoans: 3, hasOverdueLoan: false }, copies: 0, reason: 'LOAN_LIMIT_REACHED' },
    { member: { activeLoans: 0, hasOverdueLoan: true }, copies: 5, reason: 'HAS_OVERDUE_LOAN' },
    { member: { activeLoans: 0, hasOverdueLoan: false }, copies: 0, reason: 'BOOK_UNAVAILABLE' },
  ])('decision table: reports $reason first', ({ member, copies, reason }) => {
    expect(checkBorrowEligibility(member, { availableCopies: copies })).toEqual({ allowed: false, reason });
  });
});

describe('calculateDueDate', () => {
  it(`is ${LOAN_POLICY.loanPeriodDays} days after the borrow time`, () => {
    expect(calculateDueDate(utc('2026-03-01T10:30:00'))).toEqual(utc('2026-03-15T10:30:00'));
  });

  it.each([
    { borrowed: '2026-01-25T09:00:00', due: '2026-02-08T09:00:00', case: 'across a month end' },
    { borrowed: '2026-12-25T09:00:00', due: '2027-01-08T09:00:00', case: 'across a year end' },
    { borrowed: '2028-02-20T09:00:00', due: '2028-03-05T09:00:00', case: 'across Feb 29 in a leap year' },
  ])('handles dates $case', ({ borrowed, due }) => {
    expect(calculateDueDate(utc(borrowed))).toEqual(utc(due));
  });
});

describe('daysLate', () => {
  const due = utc('2026-03-15T10:30:00');

  it.each([
    { returned: '2026-03-10T08:00:00', expected: 0, case: 'returned early' },
    { returned: '2026-03-15T23:59:59', expected: 0, case: 'returned late in the evening of the due date' },
    { returned: '2026-03-16T00:00:00', expected: 1, case: 'returned just after midnight' },
    { returned: '2026-03-25T12:00:00', expected: 10, case: 'returned 10 days late' },
  ])('$case -> $expected day(s)', ({ returned, expected }) => {
    expect(daysLate(due, utc(returned))).toBe(expected);
  });
});

describe('calculateLateFee', () => {
  // Boundary value analysis: 2,000/day, capped at 50,000 (the cap is reached at exactly 25 days)
  it.each([
    { days: 0, fee: 0 },
    { days: 1, fee: 2_000 },
    { days: 24, fee: 48_000 },
    { days: 25, fee: 50_000 },
    { days: 26, fee: 50_000 },
    { days: 365, fee: 50_000 },
  ])('BVA: $days late day(s) -> Rp$fee', ({ days, fee }) => {
    expect(calculateLateFee(days)).toBe(fee);
  });

  // Equivalence partitioning: invalid inputs are rejected instead of producing a wrong fee
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid input %s', (days) => {
    expect(() => calculateLateFee(days)).toThrow(RangeError);
  });
});

describe('isOverdue', () => {
  const due = utc('2026-03-15T10:30:00');

  it('is not overdue on the due date', () => {
    expect(isOverdue(due, utc('2026-03-15T20:00:00'))).toBe(false);
  });

  it('is overdue from the next day', () => {
    expect(isOverdue(due, utc('2026-03-16T00:00:01'))).toBe(true);
  });
});
