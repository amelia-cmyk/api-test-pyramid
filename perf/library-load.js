/**
 * k6 performance test: many virtual users run a realistic member journey at the same time.
 *
 *   k6 run perf/library-load.js                    # load profile (ramps up to 20 users)
 *   k6 run -e PROFILE=smoke perf/library-load.js   # 1 user, quick sanity check
 *   k6 run -e BASE_URL=http://host:port ...        # target another server
 *
 * The thresholds are the pass/fail criteria: if any is crossed, k6 exits non-zero and CI fails.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const PROFILE = __ENV.PROFILE || 'load';
const BOOKS_TO_SEED = 20;

const profiles = {
  smoke: { executor: 'constant-vus', vus: 1, duration: '10s' },
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '15s', target: 20 }, // ramp up
      { duration: '45s', target: 20 }, // steady load
      { duration: '10s', target: 0 }, // ramp down
    ],
    gracefulRampDown: '5s',
  },
};

/**
 * Latency budgets per endpoint (95th percentile, in ms), calibrated on the CI runner.
 * Baseline p95 on 2026-11-17 (20 VUs): list_books 2.5, get_book 1.6, register_member 1.9, borrow 3.6, return_loan 2.7.
 * Budgets are ~10-20x the baseline: tight enough to catch a real slowdown (an extra query per row, a missing
 * index, a slow dependency), loose enough not to fail because a shared CI machine had a noisy moment.
 * Writes get more room than reads because they run in a transaction.
 */
const LATENCY_BUDGET_P95 = {
  list_books: 40,
  get_book: 30,
  register_member: 30,
  borrow: 50,
  return_loan: 50,
};

export const options = {
  scenarios: { member_journey: profiles[PROFILE] },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    http_req_failed: ['rate<0.01'], // fewer than 1% failed requests
    checks: ['rate>0.99'], // more than 99% of response checks pass
    http_req_duration: ['p(95)<50', 'p(99)<100'],
    ...Object.fromEntries(
      Object.entries(LATENCY_BUDGET_P95).map(([endpoint, ms]) => [
        `http_req_duration{endpoint:${endpoint}}`,
        [`p(95)<${ms}`],
      ]),
    ),
  },
};

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function isbn13(n) {
  const body = `978${String(n).padStart(9, '0')}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(body[i]) * (i % 2 === 0 ? 1 : 3);
  return body + String((10 - (sum % 10)) % 10);
}

/** Runs once before the test: creates books with plenty of copies so stock never runs out. */
export function setup() {
  const health = http.get(`${BASE_URL}/health`);
  if (health.status !== 200) throw new Error(`API is not reachable at ${BASE_URL} (status ${health.status})`);

  const bookIds = [];
  for (let i = 1; i <= BOOKS_TO_SEED; i++) {
    const res = http.post(
      `${BASE_URL}/books`,
      JSON.stringify({ title: `Load Test Book ${i}`, author: 'k6', isbn: isbn13(900000 + i), copies: 1000 }),
      { headers: JSON_HEADERS, tags: { endpoint: 'setup' } },
    );
    if (res.status !== 201) throw new Error(`Seeding book ${i} failed with ${res.status}: ${res.body}`);
    bookIds.push(res.json('id'));
  }
  return { bookIds };
}

/** "Think time" between steps, like a real user reading the screen. */
const think = () => sleep(0.3 + Math.random() * 0.4);

/** One iteration = one member journey. Every VU repeats it until the scenario ends. */
export default function memberJourney({ bookIds }) {
  const list = http.get(`${BASE_URL}/books?available=true`, { tags: { endpoint: 'list_books' } });
  check(list, { 'list books: 200': (r) => r.status === 200 });
  think();

  const bookId = bookIds[Math.floor(Math.random() * bookIds.length)];
  const book = http.get(`${BASE_URL}/books/${bookId}`, { tags: { endpoint: 'get_book' } });
  check(book, { 'get book: 200': (r) => r.status === 200 });
  think();

  const email = `vu${__VU}-it${__ITER}-${Date.now()}@perf.test`;
  const member = http.post(`${BASE_URL}/members`, JSON.stringify({ name: `Load User ${__VU}`, email }), {
    headers: JSON_HEADERS,
    tags: { endpoint: 'register_member' },
  });
  if (!check(member, { 'register member: 201': (r) => r.status === 201 })) return;
  think();

  const loan = http.post(`${BASE_URL}/loans`, JSON.stringify({ bookId, memberId: member.json('id') }), {
    headers: JSON_HEADERS,
    tags: { endpoint: 'borrow' },
  });
  if (!check(loan, { 'borrow: 201': (r) => r.status === 201 })) return;
  think();

  const returned = http.post(`${BASE_URL}/loans/${loan.json('id')}/return`, null, {
    tags: { endpoint: 'return_loan' },
  });
  check(returned, {
    'return: 200': (r) => r.status === 200,
    'return: no late fee': (r) => r.status === 200 && r.json('lateFee') === 0,
  });
}

// ---------- Report: a readable table in the console and in the GitHub Actions run summary ----------
const fmt = (v) => (v === undefined ? '-' : `${v.toFixed(1)} ms`);

export function handleSummary(data) {
  const m = data.metrics;
  const rows = Object.keys(LATENCY_BUDGET_P95).map((endpoint) => {
    const metric = m[`http_req_duration{endpoint:${endpoint}}`];
    const v = metric ? metric.values : {};
    const ok = metric ? Object.values(metric.thresholds || {}).every((t) => t.ok) : false;
    return `| ${endpoint} | ${fmt(v.med)} | ${fmt(v['p(95)'])} | ${fmt(v['p(99)'])} | < ${LATENCY_BUDGET_P95[endpoint]} ms | ${ok ? '✅' : '❌'} |`;
  });

  const allOk = Object.values(m).every((metric) => Object.values(metric.thresholds || {}).every((t) => t.ok));
  const reqs = m.http_reqs ? m.http_reqs.values : { count: 0, rate: 0 };
  const failed = m.http_req_failed ? m.http_req_failed.values.rate * 100 : 0;
  const checksRate = m.checks ? m.checks.values.rate * 100 : 0;
  const maxVus = m.vus_max ? m.vus_max.values.max : 0;
  const iterations = m.iterations ? m.iterations.values.count : 0;

  const md = [
    `### ${allOk ? '✅' : '❌'} Performance test (${PROFILE} profile)`,
    '',
    `**${reqs.count} requests** (${reqs.rate.toFixed(1)}/s) from up to **${maxVus} virtual users**, ` +
      `${iterations} complete member journeys. Failed requests: **${failed.toFixed(2)}%**, checks passed: **${checksRate.toFixed(2)}%**.`,
    '',
    '| Endpoint | Median | p95 | p99 | p95 budget | Result |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');

  return {
    stdout: `\n${md}\n\n`,
    'k6-summary.md': md,
    'k6-summary.json': JSON.stringify(data, null, 2),
  };
}
