import { describe, expect, it } from 'vitest';
import { aBook, createBook } from './support/builders.js';
import { useTestApp } from './support/test-app.js';

const t = useTestApp();

describe('POST /books', () => {
  it('creates a book and stores it in the database', async () => {
    const payload = aBook({ isbn: '978-0-306-40615-7', copies: 3 });

    const res = await t.api.post('/books').send(payload);

    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/books/${res.body.id}`);
    expect(res.body).toEqual({
      id: expect.any(Number),
      title: payload.title,
      author: payload.author,
      isbn: '9780306406157', // hyphens removed before saving
      totalCopies: 3,
      availableCopies: 3,
    });

    // Verify the side effect at the source, not only the response
    const { rows } = await t.db.query(`SELECT isbn, available_copies FROM books WHERE id = $1`, [res.body.id]);
    expect(rows).toEqual([{ isbn: '9780306406157', available_copies: 3 }]);
  });

  it('rejects a duplicate ISBN with 409, even when typed with hyphens', async () => {
    await createBook(t.api, { isbn: '9780306406157' });

    const res = await t.api.post('/books').send(aBook({ isbn: '978-0-306-40615-7' }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_ISBN');
  });

  it('returns 400 listing every invalid field', async () => {
    const res = await t.api.post('/books').send({ title: '', isbn: '9780306406158', copies: 0 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = (res.body.error.details as { field: string }[]).map((d) => d.field).sort();
    expect(fields).toEqual(['author', 'copies', 'isbn', 'title']);
  });

  // Boundary values for copies (allowed range 1..1000)
  it.each([
    { copies: 0, status: 400 },
    { copies: 1, status: 201 },
    { copies: 1000, status: 201 },
    { copies: 1001, status: 400 },
    { copies: 2.5, status: 400 },
  ])('BVA: copies = $copies -> $status', async ({ copies, status }) => {
    const res = await t.api.post('/books').send(aBook({ copies }));
    expect(res.status).toBe(status);
  });

  it('returns 400 for a body that is not valid JSON', async () => {
    const res = await t.api.post('/books').set('Content-Type', 'application/json').send('{"title": ');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('GET /books', () => {
  it('lists books in creation order', async () => {
    const first = await createBook(t.api, { title: 'First' });
    const second = await createBook(t.api, { title: 'Second' });

    const res = await t.api.get('/books').expect(200);

    expect(res.body.map((b: { id: number }) => b.id)).toEqual([first.id, second.id]);
  });

  it('filters to books with available copies', async () => {
    const available = await createBook(t.api, { copies: 1 });
    const borrowed = await createBook(t.api, { copies: 1 });
    await t.db.query(`UPDATE books SET available_copies = 0 WHERE id = $1`, [borrowed.id]);

    const res = await t.api.get('/books?available=true').expect(200);

    expect(res.body.map((b: { id: number }) => b.id)).toEqual([available.id]);
  });

  it('rejects an unknown filter value', async () => {
    await t.api.get('/books?available=maybe').expect(400);
  });
});

describe('GET /books/:id', () => {
  it('returns the book', async () => {
    const book = await createBook(t.api);
    const res = await t.api.get(`/books/${book.id}`).expect(200);
    expect(res.body).toEqual(book);
  });

  it.each([
    { id: '999', status: 404, code: 'NOT_FOUND' },
    { id: 'abc', status: 400, code: 'VALIDATION_ERROR' },
    { id: '0', status: 400, code: 'VALIDATION_ERROR' },
  ])('GET /books/$id -> $status', async ({ id, status, code }) => {
    const res = await t.api.get(`/books/${id}`);
    expect(res.status).toBe(status);
    expect(res.body.error.code).toBe(code);
  });
});

describe('unknown routes', () => {
  it('return a JSON 404', async () => {
    const res = await t.api.delete('/books');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });
});
