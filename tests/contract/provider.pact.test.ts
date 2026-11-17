import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Verifier } from '@pact-foundation/pact';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { createDatabase, type Database } from '../../src/db/database.js';
import { LOAN_POLICY } from '../../src/domain/loan-policy.js';
import { createApp } from '../../src/http/app.js';
import { FakeClock } from '../integration/support/test-app.js';
import { PACT_FILE, PROVIDER, STATES } from './pact-config.js';

/**
 * PROVIDER side: replays every interaction in the contract against the REAL API (real routes, validation,
 * services and PostgreSQL). Before each interaction, a state handler puts the database in the required state.
 */
const NOW = '2026-03-01T09:00:00.000Z';
let db: Database;
let clock: FakeClock;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  db = await createDatabase();
  clock = new FakeClock(NOW);
  server = createApp({ db, clock }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await db.close();
});

// ---------- State helpers: insert data directly, ids start at 1 after every reset ----------
async function reset() {
  await db.exec('TRUNCATE loans, members, books RESTART IDENTITY CASCADE');
  clock.set(NOW);
}

let isbnSeq = 0;
function isbn(): string {
  const body = `979${String(++isbnSeq).padStart(9, '0')}`;
  const sum = [...body].reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
  return body + String((10 - (sum % 10)) % 10);
}

async function insertBook(copies: number, available = copies) {
  await db.query(
    `INSERT INTO books (title, author, isbn, total_copies, available_copies) VALUES ($1, $2, $3, $4, $5)`,
    ['Clean Code', 'Robert C. Martin', isbn(), copies, available],
  );
}

async function insertMember() {
  await db.query(`INSERT INTO members (name, email) VALUES ('Siti Rahma', $1)`, [`siti${++isbnSeq}@example.com`]);
}

async function insertActiveLoan(bookId: number, memberId: number, borrowedAt: string, dueAt: string) {
  await db.query(`INSERT INTO loans (book_id, member_id, borrowed_at, due_at) VALUES ($1, $2, $3, $4)`, [
    bookId,
    memberId,
    borrowedAt,
    dueAt,
  ]);
  await db.query(`UPDATE books SET available_copies = available_copies - 1 WHERE id = $1`, [bookId]);
}

const stateHandlers: Record<string, () => Promise<void>> = {
  [STATES.bookExists]: async () => {
    await reset();
    await insertBook(2);
  },
  [STATES.noBooks]: reset,
  [STATES.availableBooksExist]: async () => {
    await reset();
    await insertBook(2);
    await insertBook(1, 0);
  },
  [STATES.memberCanBorrow]: async () => {
    await reset();
    await insertBook(2);
    await insertMember();
  },
  [STATES.memberAtLoanLimit]: async () => {
    await reset();
    await insertBook(1); // book 1: the one the member asks for
    await insertMember();
    for (let i = 0; i < LOAN_POLICY.maxActiveLoans; i++) {
      await insertBook(1);
      await insertActiveLoan(i + 2, 1, NOW, '2026-03-15T09:00:00Z');
    }
  },
  [STATES.loanReturnedLate]: async () => {
    await reset();
    await insertBook(1);
    await insertMember();
    await insertActiveLoan(1, 1, NOW, '2026-03-15T09:00:00Z');
    clock.set('2026-03-18T10:00:00.000Z'); // 3 days after the due date
  },
};

describe('Library API honours the Library Mobile App contract', () => {
  it('verifies every interaction in the pact file', async () => {
    if (!existsSync(PACT_FILE)) {
      throw new Error(`No contract at ${PACT_FILE}. Run the consumer contract tests first (npm run test:contract).`);
    }

    await new Verifier({
      provider: PROVIDER,
      providerBaseUrl: baseUrl,
      pactUrls: [PACT_FILE],
      stateHandlers,
      providerVersion: process.env.GITHUB_SHA ?? 'local',
      logLevel: 'warn',
    }).verifyProvider();
  });
});
