import type { Clock } from '../clock.js';
import type { Database, Queryable } from '../db/database.js';
import {
  calculateDueDate,
  calculateLateFee,
  checkBorrowEligibility,
  daysLate,
  isOverdue,
} from '../domain/loan-policy.js';
import { conflict, notFound } from '../http/errors.js';
import type { CreateBookInput, CreateLoanInput, CreateMemberInput } from '../http/schemas.js';

export interface Book {
  id: number;
  title: string;
  author: string;
  isbn: string;
  totalCopies: number;
  availableCopies: number;
}

export interface Member {
  id: number;
  name: string;
  email: string;
  activeLoans: number;
}

export interface Loan {
  id: number;
  bookId: number;
  memberId: number;
  borrowedAt: string;
  dueAt: string;
  returnedAt: string | null;
  lateFee: number | null;
}

interface BookRow {
  id: number;
  title: string;
  author: string;
  isbn: string;
  total_copies: number;
  available_copies: number;
}

interface LoanRow {
  id: number;
  book_id: number;
  member_id: number;
  borrowed_at: Date;
  due_at: Date;
  returned_at: Date | null;
  late_fee: number | null;
}

const toBook = (row: BookRow): Book => ({
  id: row.id,
  title: row.title,
  author: row.author,
  isbn: row.isbn,
  totalCopies: row.total_copies,
  availableCopies: row.available_copies,
});

const toLoan = (row: LoanRow): Loan => ({
  id: row.id,
  bookId: row.book_id,
  memberId: row.member_id,
  borrowedAt: row.borrowed_at.toISOString(),
  dueAt: row.due_at.toISOString(),
  returnedAt: row.returned_at?.toISOString() ?? null,
  lateFee: row.late_fee,
});

/**
 * Library use cases. The rules themselves live in `domain/` (and are unit tested there);
 * this layer loads the data the rules need, applies them, and saves the result atomically.
 */
export class LibraryService {
  constructor(
    private readonly db: Database,
    private readonly clock: Clock,
  ) {}

  // ---------- Books ----------

  async createBook(input: CreateBookInput): Promise<Book> {
    const { rows } = await this.db.query<BookRow>(
      `INSERT INTO books (title, author, isbn, total_copies, available_copies)
       VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (isbn) DO NOTHING
       RETURNING *`,
      [input.title, input.author, input.isbn, input.copies],
    );
    const row = rows[0];
    if (!row) throw conflict('DUPLICATE_ISBN', `A book with ISBN ${input.isbn} already exists`);
    return toBook(row);
  }

  async listBooks(filter: { availableOnly: boolean }): Promise<Book[]> {
    const { rows } = await this.db.query<BookRow>(
      `SELECT * FROM books WHERE ($1::boolean IS FALSE OR available_copies > 0) ORDER BY id`,
      [filter.availableOnly],
    );
    return rows.map(toBook);
  }

  async getBook(id: number): Promise<Book> {
    const { rows } = await this.db.query<BookRow>(`SELECT * FROM books WHERE id = $1`, [id]);
    const row = rows[0];
    if (!row) throw notFound('Book', id);
    return toBook(row);
  }

  // ---------- Members ----------

  async createMember(input: CreateMemberInput): Promise<Member> {
    const { rows } = await this.db.query<{ id: number; name: string; email: string }>(
      `INSERT INTO members (name, email) VALUES ($1, $2)
       ON CONFLICT ((lower(email))) DO NOTHING
       RETURNING *`,
      [input.name, input.email],
    );
    const row = rows[0];
    if (!row) throw conflict('DUPLICATE_EMAIL', `A member with email ${input.email} already exists`);
    return { ...row, activeLoans: 0 };
  }

  async getMember(id: number): Promise<Member> {
    const { rows } = await this.db.query<{ id: number; name: string; email: string; active_loans: number }>(
      `SELECT m.id, m.name, m.email,
              (SELECT count(*)::int FROM loans l WHERE l.member_id = m.id AND l.returned_at IS NULL) AS active_loans
       FROM members m WHERE m.id = $1`,
      [id],
    );
    const row = rows[0];
    if (!row) throw notFound('Member', id);
    return { id: row.id, name: row.name, email: row.email, activeLoans: row.active_loans };
  }

  async listMemberLoans(memberId: number): Promise<Loan[]> {
    await this.getMember(memberId); // 404 for an unknown member instead of an empty list
    const { rows } = await this.db.query<LoanRow>(`SELECT * FROM loans WHERE member_id = $1 ORDER BY id`, [memberId]);
    return rows.map(toLoan);
  }

  // ---------- Loans ----------

  /** Borrowing reads stock and loan history, then writes two tables, so it runs in one transaction. */
  async borrow(input: CreateLoanInput): Promise<Loan> {
    const now = this.clock.now();

    return this.db.transaction(async (tx) => {
      const book = await this.lockBook(tx, input.bookId);
      const activeDueDates = await this.activeLoanDueDates(tx, input.memberId);

      const decision = checkBorrowEligibility(
        { activeLoans: activeDueDates.length, hasOverdueLoan: activeDueDates.some((due) => isOverdue(due, now)) },
        { availableCopies: book.available_copies },
      );
      if (!decision.allowed) throw conflict(decision.reason, borrowRejectionMessages[decision.reason]);

      await tx.query(`UPDATE books SET available_copies = available_copies - 1 WHERE id = $1`, [book.id]);
      const { rows } = await tx.query<LoanRow>(
        `INSERT INTO loans (book_id, member_id, borrowed_at, due_at) VALUES ($1, $2, $3, $4) RETURNING *`,
        [book.id, input.memberId, now, calculateDueDate(now)],
      );
      return toLoan(rows[0]!);
    });
  }

  async returnLoan(loanId: number): Promise<Loan & { lateDays: number }> {
    const now = this.clock.now();

    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query<LoanRow>(`SELECT * FROM loans WHERE id = $1 FOR UPDATE`, [loanId]);
      const loan = rows[0];
      if (!loan) throw notFound('Loan', loanId);
      if (loan.returned_at) throw conflict('ALREADY_RETURNED', `Loan ${loanId} was already returned`);

      const lateDays = daysLate(loan.due_at, now);
      const { rows: updated } = await tx.query<LoanRow>(
        `UPDATE loans SET returned_at = $2, late_fee = $3 WHERE id = $1 RETURNING *`,
        [loanId, now, calculateLateFee(lateDays)],
      );
      await tx.query(`UPDATE books SET available_copies = available_copies + 1 WHERE id = $1`, [loan.book_id]);
      return { ...toLoan(updated[0]!), lateDays };
    });
  }

  /** Row lock: a second borrow of the same book waits here until the first one commits. */
  private async lockBook(tx: Queryable, bookId: number): Promise<BookRow> {
    const { rows } = await tx.query<BookRow>(`SELECT * FROM books WHERE id = $1 FOR UPDATE`, [bookId]);
    if (!rows[0]) throw notFound('Book', bookId);
    return rows[0];
  }

  private async activeLoanDueDates(tx: Queryable, memberId: number): Promise<Date[]> {
    const { rows: members } = await tx.query(`SELECT 1 FROM members WHERE id = $1`, [memberId]);
    if (members.length === 0) throw notFound('Member', memberId);

    const { rows } = await tx.query<{ due_at: Date }>(
      `SELECT due_at FROM loans WHERE member_id = $1 AND returned_at IS NULL`,
      [memberId],
    );
    return rows.map((row) => row.due_at);
  }
}

const borrowRejectionMessages = {
  HAS_OVERDUE_LOAN: 'The member has an overdue loan and must return it first',
  LOAN_LIMIT_REACHED: 'The member already has the maximum number of active loans',
  BOOK_UNAVAILABLE: 'No copies of this book are available right now',
} as const;
