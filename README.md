# API Test Pyramid (TypeScript)

![CI](https://github.com/amelia-cmyk/api-test-pyramid/actions/workflows/ci.yml/badge.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)
![Vitest](https://img.shields.io/badge/Vitest-6E9F18?logo=vitest&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)

A small **Library REST API** (books, members, loans) that is tested at **every level of the test pyramid**.
The goal is to show a complete testing strategy, not only end-to-end tests: each kind of risk is caught by the
cheapest test that can catch it.

```
            ╱╲
           ╱  ╲         Performance (k6)          load, latency thresholds        🚧 planned
          ╱────╲
         ╱      ╲       Contract (Pact)           API consumer ⇄ provider         🚧 planned
        ╱────────╲
       ╱          ╲     Integration (Supertest)   HTTP + real PostgreSQL          🚧 planned
      ╱────────────╲
     ╱              ╲   Unit (Vitest)             business rules, 100% coverage   ✅ done
    ╱────────────────╲
```

## 📚 Business rules under test

| Rule                                                             | Test design technique                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------ |
| A member can have at most **3** active loans                     | Boundary value analysis (2, 3, 4)                            |
| A book can be borrowed only while copies are available           | Boundary value analysis (1, 0)                               |
| Members with an overdue loan cannot borrow                       | Decision table (which reason wins when several fail)         |
| Loan period is **14 days**, calculated in UTC                    | Month end, year end and leap-year dates                      |
| Late fee is **Rp2,000/day**, capped at **Rp50,000**              | Boundary value analysis (0, 1, 24, 25, 26 days)              |
| Late days count whole calendar days; the due date itself is free | Boundaries around midnight                                   |
| ISBN-13: 13 digits, 978/979 prefix, valid check digit            | Equivalence partitioning (each invalid case breaks one rule) |

The suite was also checked with **manual mutation testing**: deliberately introducing bugs (for example `>` instead
of `>=` on the loan limit, or removing the fee cap) makes the tests fail, so 100% coverage here means the rules are
really verified, not just executed.

## 🚀 Getting started

Only Node.js 22+ is needed. No Docker or database installation.

```bash
npm ci
npm test
```

| Command                 | Description                      |
| ----------------------- | -------------------------------- |
| `npm test`              | Run all tests                    |
| `npm run test:unit`     | Unit tests only                  |
| `npm run test:coverage` | Tests with a coverage report     |
| `npm run check`         | Type check + lint + format check |

## ⚙️ CI

GitHub Actions runs the layers as separate jobs, fastest first: **quality gates → unit tests (+ coverage summary)**.
More layers are added to the pipeline as they are built.
