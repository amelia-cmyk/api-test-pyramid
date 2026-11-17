import request from 'supertest';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import type { Clock } from '../../../src/clock.js';
import { createDatabase, type Database } from '../../../src/db/database.js';
import { createApp } from '../../../src/http/app.js';

/** A clock the test controls: time only moves when the test says so. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(iso: string) {
    this.current = new Date(iso);
  }

  now(): Date {
    return new Date(this.current);
  }

  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 24 * 60 * 60 * 1000);
  }

  set(iso: string): void {
    this.current = new Date(iso);
  }
}

export const START_TIME = '2026-03-01T09:00:00.000Z';

/**
 * Gives a test file the real app wired to a real (in-memory) PostgreSQL database.
 * - One database per file: files run in parallel without sharing data.
 * - Tables are emptied before every test: each test starts from a known state, in any order.
 */
export function useTestApp() {
  const ctx = {} as { db: Database; clock: FakeClock; api: ReturnType<typeof request> };

  beforeAll(async () => {
    ctx.db = await createDatabase();
  });

  beforeEach(async () => {
    await ctx.db.exec('TRUNCATE loans, members, books RESTART IDENTITY CASCADE');
    ctx.clock = new FakeClock(START_TIME);
    ctx.api = request(createApp({ db: ctx.db, clock: ctx.clock }));
  });

  afterAll(async () => {
    await ctx.db.close();
  });

  return ctx;
}
