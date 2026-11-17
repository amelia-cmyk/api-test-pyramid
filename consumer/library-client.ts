/**
 * API client used by the "Library Mobile App": a separate application that consumes the Library API.
 * It lives in this repo only to demonstrate contract testing; normally it would be in its own repo.
 *
 * Notice it only reads the fields the app actually shows. That is what goes into the contract,
 * so the API team stays free to add fields or change anything the app does not use.
 */

export interface BookSummary {
  id: number;
  title: string;
  author: string;
  availableCopies: number;
}

export interface LoanSummary {
  id: number;
  dueAt: Date;
}

export type BorrowResult =
  | { ok: true; loan: LoanSummary }
  | { ok: false; reason: 'LOAN_LIMIT_REACHED' | 'HAS_OVERDUE_LOAN' | 'BOOK_UNAVAILABLE' };

export interface ReturnSummary {
  lateDays: number;
  lateFee: number;
}

interface ErrorBody {
  error: { code: string };
}

export class LibraryClient {
  constructor(private readonly baseUrl: string) {}

  /** Returns null when the book does not exist, so the app can show a "not found" screen. */
  async getBook(id: number): Promise<BookSummary | null> {
    const res = await fetch(`${this.baseUrl}/books/${id}`, { headers: { Accept: 'application/json' } });
    if (res.status === 404) return null;
    await this.ensureOk(res);
    return pickBook(await res.json());
  }

  async listAvailableBooks(): Promise<BookSummary[]> {
    const res = await fetch(`${this.baseUrl}/books?available=true`, { headers: { Accept: 'application/json' } });
    await this.ensureOk(res);
    return ((await res.json()) as unknown[]).map(pickBook);
  }

  /** A refused loan (409) is an expected outcome the app explains to the user, not an exception. */
  async borrow(bookId: number, memberId: number): Promise<BorrowResult> {
    const res = await fetch(`${this.baseUrl}/loans`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ bookId, memberId }),
    });
    if (res.status === 409) {
      const body = (await res.json()) as ErrorBody;
      return { ok: false, reason: body.error.code as Extract<BorrowResult, { ok: false }>['reason'] };
    }
    await this.ensureOk(res);
    const loan = (await res.json()) as { id: number; dueAt: string };
    return { ok: true, loan: { id: loan.id, dueAt: new Date(loan.dueAt) } };
  }

  async returnLoan(loanId: number): Promise<ReturnSummary> {
    const res = await fetch(`${this.baseUrl}/loans/${loanId}/return`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    await this.ensureOk(res);
    const body = (await res.json()) as ReturnSummary;
    return { lateDays: body.lateDays, lateFee: body.lateFee };
  }

  private async ensureOk(res: Response): Promise<void> {
    if (!res.ok) throw new Error(`Library API responded ${res.status}: ${await res.text()}`);
  }
}

function pickBook(raw: unknown): BookSummary {
  const book = raw as BookSummary;
  return { id: book.id, title: book.title, author: book.author, availableCopies: book.availableCopies };
}
