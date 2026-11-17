import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../src/db/database.js';
import { createApp } from '../../src/http/app.js';
import { useTestApp } from './support/test-app.js';

const t = useTestApp();

describe('GET /health', () => {
  it('reports that the service is up', async () => {
    await t.api.get('/health').expect(200, { status: 'ok' });
  });
});

describe('unexpected failures', () => {
  it('answer 500 with a generic message and do not leak internal details', async () => {
    const internal = 'connection to database at 10.0.0.5 lost';
    const brokenDb = {
      query: () => Promise.reject(new Error(internal)),
      transaction: () => Promise.reject(new Error(internal)),
      exec: () => Promise.resolve(),
      close: () => Promise.resolve(),
    } satisfies Database;
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await request(createApp({ db: brokenDb })).get('/books');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
    expect(JSON.stringify(res.body)).not.toContain('10.0.0.5');
    expect(logged).toHaveBeenCalledOnce(); // the real cause still reaches the server logs
    logged.mockRestore();
  });
});
