import { z } from 'zod';
import { isValidIsbn13, normalizeIsbn } from '../domain/isbn.js';

/** Request validation. Anything that fails here is rejected with 400 before touching the database. */

const text = z.string().trim().min(1).max(200);

export const createBookSchema = z.object({
  title: text,
  author: text,
  isbn: z.string().refine(isValidIsbn13, 'Must be a valid ISBN-13').transform(normalizeIsbn),
  copies: z.int().min(1).max(1000),
});

export const createMemberSchema = z.object({
  name: text,
  email: z.email().max(200),
});

export const createLoanSchema = z.object({
  bookId: z.int().positive(),
  memberId: z.int().positive(),
});

export const idParamSchema = z.coerce.number().int().positive().max(2_147_483_647);

export const listBooksQuerySchema = z.object({
  available: z.enum(['true', 'false']).optional(),
});

export type CreateBookInput = z.infer<typeof createBookSchema>;
export type CreateMemberInput = z.infer<typeof createMemberSchema>;
export type CreateLoanInput = z.infer<typeof createLoanSchema>;
