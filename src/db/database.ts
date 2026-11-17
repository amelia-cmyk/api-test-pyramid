import { PGlite } from '@electric-sql/pglite';

/** The part of a database connection (or open transaction) that the services use. */
export interface Queryable {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Database extends Queryable {
  exec(sql: string): Promise<unknown>;
  transaction<T>(callback: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Data rules are also enforced by the database itself (CHECK, UNIQUE, FOREIGN KEY), so bad data cannot
 * get in even if application code has a bug. Integration tests are where these constraints get exercised.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS books (
    id               INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title            TEXT NOT NULL,
    author           TEXT NOT NULL,
    isbn             CHAR(13) NOT NULL UNIQUE,
    total_copies     INT NOT NULL CHECK (total_copies > 0),
    available_copies INT NOT NULL CHECK (available_copies BETWEEN 0 AND total_copies)
  );

  CREATE TABLE IF NOT EXISTS members (
    id    INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name  TEXT NOT NULL,
    email TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS members_email_unique ON members (lower(email));

  CREATE TABLE IF NOT EXISTS loans (
    id          INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    book_id     INT NOT NULL REFERENCES books (id),
    member_id   INT NOT NULL REFERENCES members (id),
    borrowed_at TIMESTAMPTZ NOT NULL,
    due_at      TIMESTAMPTZ NOT NULL,
    returned_at TIMESTAMPTZ,
    late_fee    INT CHECK (late_fee >= 0)
  );
  CREATE INDEX IF NOT EXISTS loans_active_by_member ON loans (member_id) WHERE returned_at IS NULL;
`;

/**
 * Opens a real PostgreSQL database (PGlite: Postgres compiled to WebAssembly, running inside Node.js).
 * Without `dataDir` it lives in memory, which gives every test file its own fast, isolated database.
 */
export async function createDatabase(dataDir?: string): Promise<Database> {
  const db = await PGlite.create(dataDir);
  await db.exec(SCHEMA);
  return db;
}
