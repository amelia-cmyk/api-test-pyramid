# API Test Pyramid (TypeScript)

![CI](https://github.com/amelia-cmyk/api-test-pyramid/actions/workflows/ci.yml/badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![Pact](https://img.shields.io/badge/Pact-contract%20testing-1F6FEB)
![k6](https://img.shields.io/badge/k6-performance-7D64FF?logo=k6&logoColor=white)

A small **Library REST API** (books, members, loans) that is tested at **every level of the test pyramid**.
The goal is to show a complete testing strategy, not only end-to-end tests: each kind of risk is caught by the
cheapest test that can catch it.

```
            ╱╲
           ╱  ╲         Performance (k6)          load, latency thresholds         ✅ 20 virtual users
          ╱────╲
         ╱      ╲       Contract (Pact)           API consumer ⇄ provider          ✅ 6 interactions
        ╱────────╲
       ╱          ╲     Integration (Supertest)   HTTP + real PostgreSQL           ✅ 43 tests
      ╱────────────╲
     ╱              ╲   Unit (Vitest)             business rules                   ✅ 41 tests
    ╱────────────────╲
```

**Coverage:** 100% of lines and branches, enforced in CI (the build fails below 95% overall, or below 100% for
business rules).

## 🧭 Which layer tests what

| Layer           | Catches                                                                                   | Example                                           |
| --------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Unit**        | Wrong business rules                                                                      | Late fee is not capped at Rp50,000                |
| **Integration** | Wrong HTTP status codes, validation, SQL, transactions, database constraints, concurrency | Two members borrow the last copy at the same time |
| **Contract**    | API changes that break a client application, even when all API tests still pass           | `availableCopies` renamed to `stock`              |
| **Performance** | Slow endpoints and errors that only appear when many users act at the same time           | Borrowing slows down past its latency budget      |

## 📚 Business rules (unit tests)

| Rule                                                             | Test design technique                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| A member can have at most **3** active loans                     | Boundary value analysis (2, 3, 4)                            |
| A book can be borrowed only while copies are available           | Boundary value analysis (1, 0)                               |
| Members with an overdue loan cannot borrow                       | Decision table (which reason wins when several fail)         |
| Loan period is **14 days**, calculated in UTC                    | Month end, year end and leap-year dates                      |
| Late fee is **Rp2,000/day**, capped at **Rp50,000**              | Boundary value analysis (0, 1, 24, 25, 26 days)              |
| Late days count whole calendar days; the due date itself is free | Boundaries around midnight                                   |
| ISBN-13: 13 digits, 978/979 prefix, valid check digit            | Equivalence partitioning (each invalid case breaks one rule) |

## 🔌 API behaviour (integration tests)

Every test sends real HTTP requests (Supertest) to the app, which talks to a **real PostgreSQL database**
([PGlite](https://pglite.dev): Postgres compiled to WebAssembly, running inside Node.js).

- **Isolation:** each test file gets its own in-memory database, and tables are emptied before every test,
  so tests can run in parallel and in any order.
- **Controlled time:** the app reads the time from an injected clock. Tests use a fake clock and move it forward
  ("15 days later") to test overdue loans and late fees without waiting.
- **Checks beyond the response:** important tests also query the database directly, for example to prove that a
  rejected request left **no half-written data** behind.

| Area     | Scenarios                                                                                                                                                      |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Books    | Create (201 + `Location`), duplicate ISBN with or without hyphens (409), every invalid field listed (400), copies boundaries, invalid JSON, list & filter, 404 |
| Members  | Create, duplicate email regardless of letter case (409), invalid emails (400), 404                                                                             |
| Loans    | Borrow (due date, stock decreases), loan limit, no stock, **two simultaneous requests for the last copy**, overdue member blocked until return, unknown ids    |
| Returns  | On time (no fee), late fees stored in the database (1, 10, 40 days), returning twice (409, stock unchanged)                                                    |
| Failures | Unexpected errors answer 500 **without leaking internal details**, while the real cause is logged                                                              |

### Endpoints

| Method | Path                 | Description                         |
| ------ | -------------------- | ----------------------------------- |
| GET    | `/health`            | Health check                        |
| POST   | `/books`             | Add a book                          |
| GET    | `/books`             | List books (`?available=true`)      |
| GET    | `/books/:id`         | Get a book                          |
| POST   | `/members`           | Register a member                   |
| GET    | `/members/:id`       | Get a member and their active loans |
| GET    | `/members/:id/loans` | A member's loan history             |
| POST   | `/loans`             | Borrow a book                       |
| POST   | `/loans/:id/return`  | Return a book (calculates late fee) |

Errors always have the same shape: `{ "error": { "code": "LOAN_LIMIT_REACHED", "message": "...", "details": [...] } }`.

## 🤝 Contract tests (Pact)

A separate application, the **Library Mobile App** ([`consumer/library-client.ts`](consumer/library-client.ts)),
uses this API. It lives in this repo only for the demo; normally it would be its own repo and team.

1. **Consumer test** ([`tests/contract/consumer.pact.test.ts`](tests/contract/consumer.pact.test.ts)): the app's real
   client runs against a Pact mock server. Each interaction states what the app sends and the **minimum it needs back**,
   using type matchers ("any integer") rather than exact data. The result is a contract file, `pacts/*.json`.
2. **Provider verification** ([`tests/contract/provider.pact.test.ts`](tests/contract/provider.pact.test.ts)): every
   interaction is replayed against the **real API and database**. Provider-state handlers put the database in the
   situation each interaction expects (for example "member 1 has reached the loan limit").

| Interaction              | Provider state                                | Response               |
| ------------------------ | --------------------------------------------- | ---------------------- |
| Get a book               | book 1 exists with 2 available copies         | 200                    |
| Get a missing book       | no books exist                                | 404                    |
| List available books     | some books are available, some fully borrowed | 200                    |
| Borrow a book            | member 1 can borrow book 1                    | 201                    |
| Borrow at the loan limit | member 1 has reached the loan limit           | 409 + exact error code |
| Return a late book       | loan 1 is returned 3 days after its due date  | 200 + late fee         |

### What the contract allows and what it blocks

Simulated API changes, checked against the contract:

| API change                             | Result                | Why                                    |
| -------------------------------------- | --------------------- | -------------------------------------- |
| Rename `availableCopies` to `stock`    | ❌ Verification fails | The app reads `availableCopies`        |
| Send `lateFee` as the string `"6000"`  | ❌ Verification fails | The contract expects an integer        |
| Rename error code `LOAN_LIMIT_REACHED` | ❌ Verification fails | The app shows a message per exact code |
| Add a new field `publishedYear`        | ✅ Passes             | Extra fields never break a consumer    |
| Remove `isbn` from book responses      | ✅ Passes             | The app never uses it                  |

The API team learns about a breaking change **before** it is deployed, and stays free to make every other change.

> In a real multi-repo setup, the consumer would publish the contract to a **Pact Broker** and the provider pipeline
> would run `can-i-deploy` before releasing. Here the contract is passed as a file between two CI steps to keep the
> project self-contained.

## ⚡ Performance tests (k6)

[`perf/library-load.js`](perf/library-load.js) simulates many members using the library at the same time. Each
virtual user repeats a realistic journey, with short "think time" between steps:

**browse available books → open a book → register → borrow it → return it**

| Setting | Load profile (CI)                                           | Smoke profile                     |
| ------- | ----------------------------------------------------------- | --------------------------------- |
| Users   | Ramp 0 → 20 virtual users (15 s), hold 45 s, ramp down 10 s | 1 virtual user for 10 s           |
| Use     | Gate every change in CI                                     | Quick check that the script works |

**Thresholds** are the pass/fail criteria. If any is crossed, k6 exits with an error and the build fails:

| Metric                      | Threshold                  |
| --------------------------- | -------------------------- |
| Failed requests             | < 1%                       |
| Response checks passing     | > 99%                      |
| All requests                | p95 < 400 ms, p99 < 800 ms |
| `GET /books?available=true` | p95 < 300 ms               |
| `GET /books/:id`            | p95 < 200 ms               |
| `POST /members`             | p95 < 300 ms               |
| `POST /loans`               | p95 < 400 ms               |
| `POST /loans/:id/return`    | p95 < 400 ms               |

Every request is tagged with its endpoint, so a slowdown is reported for the endpoint that caused it, not hidden in
an overall average. Each CI run writes a per-endpoint table (median, p95, p99, budget, result) to the run summary
and uploads the full k6 results.

> The API runs with an in-memory PostgreSQL (PGlite) on a shared CI machine, so the absolute numbers describe this
> setup, not a production deployment. What matters is the **method**: a repeatable load profile, per-endpoint latency
> budgets, and a build that fails when a change makes the API slower or less reliable.

## ✅ Are the tests any good?

High coverage only proves code was _executed_. To check that the tests really _verify_ behaviour, bugs were
deliberately introduced (manual mutation testing) and every one made the suite fail, for example:

| Injected bug                                 | Caught by        |
| -------------------------------------------- | ---------------- |
| Loan limit uses `>` instead of `>=`          | Unit (BVA)       |
| Late fee cap removed                         | Unit (BVA)       |
| Borrowing does not reduce stock              | Integration (10) |
| Late fee calculated but never saved          | Integration (3)  |
| Same loan can be returned twice              | Integration      |
| Duplicate-email index becomes case-sensitive | Integration      |
| Error code renamed (would break the app)     | Contract         |

## 🗂️ Project structure

```
src/
├── domain/      Business rules as pure functions (no database, HTTP or clock)
├── services/    Use cases: load data, apply the rules, save atomically in a transaction
├── http/        Express routes, request validation (Zod), error → HTTP status mapping
├── db/          PostgreSQL schema with CHECK / UNIQUE / FOREIGN KEY constraints
└── clock.ts     Injectable clock
consumer/       The "Library Mobile App" API client (contract consumer)
perf/           k6 performance test
tests/
├── unit/
├── integration/
│   └── support/ Test app setup, fake clock, test data builders
└── contract/    Pact consumer test + provider verification
```

## 🚀 Getting started

Only Node.js 22+ is needed. No Docker or database installation.

```bash
npm ci
npm test         # all tests
npm start        # API on http://localhost:3000 (in-memory database)
```

| Command                     | Description                               |
| --------------------------- | ----------------------------------------- |
| `npm test`                  | Run all tests                             |
| `npm run test:unit`         | Unit tests only                           |
| `npm run test:integration`  | Integration tests only                    |
| `npm run test:coverage`     | Unit + integration with coverage report   |
| `npm run test:contract`     | Consumer contract, then provider verify   |
| `npm run test:perf`         | k6 load test (needs k6 and a running API) |
| `npm run test:perf:smoke`   | k6 smoke test, 1 virtual user             |
| `npm start` / `npm run dev` | Start the API (dev = restart on change)   |
| `npm run check`             | Type check + lint + format check          |

Set `DATA_DIR=./data` to keep the database on disk between restarts.

## ⚙️ CI

GitHub Actions runs the layers as separate jobs, fastest first, and stops at the first failing layer:

**quality gates → unit tests → integration tests → contract tests → performance tests**

Each job writes a coverage table to the run summary and uploads the HTML coverage report and JUnit results.
