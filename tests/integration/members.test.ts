import { describe, expect, it } from 'vitest';
import { aMember, createMember } from './support/builders.js';
import { useTestApp } from './support/test-app.js';

const t = useTestApp();

describe('POST /members', () => {
  it('creates a member with no active loans', async () => {
    const payload = aMember();

    const res = await t.api.post('/members').send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(Number), name: payload.name, email: payload.email, activeLoans: 0 });
  });

  it('treats emails case-insensitively when checking duplicates', async () => {
    await createMember(t.api, { email: 'rina@example.com' });

    const res = await t.api.post('/members').send(aMember({ email: 'RINA@Example.com' }));

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_EMAIL');
  });

  it.each(['not-an-email', 'rina@', '@example.com', ''])('rejects invalid email "%s"', async (email) => {
    const res = await t.api.post('/members').send(aMember({ email }));
    expect(res.status).toBe(400);
    expect(res.body.error.details).toContainEqual(expect.objectContaining({ field: 'email' }));
  });
});

describe('GET /members/:id', () => {
  it('returns the member', async () => {
    const member = await createMember(t.api);
    const res = await t.api.get(`/members/${member.id}`).expect(200);
    expect(res.body).toEqual(member);
  });

  it('returns 404 for an unknown member', async () => {
    await t.api.get('/members/999').expect(404);
  });

  it('returns 404 for the loans of an unknown member', async () => {
    await t.api.get('/members/999/loans').expect(404);
  });
});
