/**
 * Library loan rules. Everything here is a pure function (no database, no HTTP, no clock),
 * which is exactly what makes it cheap and fast to cover with unit tests.
 */

export const LOAN_POLICY = {
  maxActiveLoans: 3,
  loanPeriodDays: 14,
  lateFeePerDay: 2_000, // IDR
  maxLateFee: 50_000, // IDR
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface MemberLoanState {
  activeLoans: number;
  hasOverdueLoan: boolean;
}

export interface BookStock {
  availableCopies: number;
}

export type BorrowRejection = 'HAS_OVERDUE_LOAN' | 'LOAN_LIMIT_REACHED' | 'BOOK_UNAVAILABLE';

export type BorrowDecision = { allowed: true } | { allowed: false; reason: BorrowRejection };

/**
 * Decides whether a member may borrow a book. Member problems are reported before stock problems,
 * so the member always learns what they can fix themselves first.
 */
export function checkBorrowEligibility(member: MemberLoanState, book: BookStock): BorrowDecision {
  if (member.hasOverdueLoan) return { allowed: false, reason: 'HAS_OVERDUE_LOAN' };
  if (member.activeLoans >= LOAN_POLICY.maxActiveLoans) return { allowed: false, reason: 'LOAN_LIMIT_REACHED' };
  if (book.availableCopies <= 0) return { allowed: false, reason: 'BOOK_UNAVAILABLE' };
  return { allowed: true };
}

/** Due date = borrow time + loan period. Uses UTC so the result does not depend on the server's time zone. */
export function calculateDueDate(borrowedAt: Date): Date {
  return new Date(borrowedAt.getTime() + LOAN_POLICY.loanPeriodDays * MS_PER_DAY);
}

const startOfUtcDay = (date: Date): number => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

/**
 * Whole calendar days (UTC) between the due date and the return date.
 * Returning any time on the due date, or earlier, is not late.
 */
export function daysLate(dueAt: Date, returnedAt: Date): number {
  const diff = (startOfUtcDay(returnedAt) - startOfUtcDay(dueAt)) / MS_PER_DAY;
  return Math.max(0, diff);
}

/** Late fee in IDR: a fixed amount per late day, capped at a maximum. */
export function calculateLateFee(lateDays: number): number {
  if (!Number.isInteger(lateDays) || lateDays < 0) {
    throw new RangeError(`lateDays must be a non-negative integer, got ${lateDays}`);
  }
  return Math.min(lateDays * LOAN_POLICY.lateFeePerDay, LOAN_POLICY.maxLateFee);
}

/** True when a loan that has not been returned is past its due date. */
export function isOverdue(dueAt: Date, now: Date): boolean {
  return daysLate(dueAt, now) > 0;
}
