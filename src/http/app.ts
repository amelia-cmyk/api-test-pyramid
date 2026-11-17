import express, { type ErrorRequestHandler } from 'express';
import type { z } from 'zod';
import { systemClock, type Clock } from '../clock.js';
import type { Database } from '../db/database.js';
import { LibraryService } from '../services/library-service.js';
import { ApiError } from './errors.js';
import {
  createBookSchema,
  createLoanSchema,
  createMemberSchema,
  idParamSchema,
  listBooksQuerySchema,
} from './schemas.js';

/** Parses input with a Zod schema, or throws a 400 that lists every invalid field. */
function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
  throw new ApiError(400, 'VALIDATION_ERROR', 'The request is invalid', details);
}

const parseId = (value: unknown) => parse(idParamSchema, value);

/**
 * Builds the Express app. The database and clock are passed in (dependency injection),
 * so tests can give it a fresh in-memory database and a fake clock.
 */
export function createApp({ db, clock = systemClock }: { db: Database; clock?: Clock }) {
  const library = new LibraryService(db, clock);
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // ---------- Books ----------
  app.post('/books', async (req, res) => {
    const book = await library.createBook(parse(createBookSchema, req.body));
    res.status(201).location(`/books/${book.id}`).json(book);
  });

  app.get('/books', async (req, res) => {
    const query = parse(listBooksQuerySchema, req.query);
    res.json(await library.listBooks({ availableOnly: query.available === 'true' }));
  });

  app.get('/books/:id', async (req, res) => {
    res.json(await library.getBook(parseId(req.params.id)));
  });

  // ---------- Members ----------
  app.post('/members', async (req, res) => {
    const member = await library.createMember(parse(createMemberSchema, req.body));
    res.status(201).location(`/members/${member.id}`).json(member);
  });

  app.get('/members/:id', async (req, res) => {
    res.json(await library.getMember(parseId(req.params.id)));
  });

  app.get('/members/:id/loans', async (req, res) => {
    res.json(await library.listMemberLoans(parseId(req.params.id)));
  });

  // ---------- Loans ----------
  app.post('/loans', async (req, res) => {
    const loan = await library.borrow(parse(createLoanSchema, req.body));
    res.status(201).location(`/loans/${loan.id}`).json(loan);
  });

  app.post('/loans/:id/return', async (req, res) => {
    res.json(await library.returnLoan(parseId(req.params.id)));
  });

  // ---------- Fallbacks ----------
  app.use((req, _res, next) => {
    next(new ApiError(404, 'ROUTE_NOT_FOUND', `${req.method} ${req.path} does not exist`));
  });

  const errorHandler: ErrorRequestHandler = (err: unknown, _req, res, _next) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
      return;
    }
    // express.json() throws this when the body is not valid JSON
    if (err instanceof SyntaxError && 'type' in err && err.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'INVALID_JSON', message: 'The request body is not valid JSON' } });
      return;
    }
    console.error(err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
  };
  app.use(errorHandler);

  return app;
}
