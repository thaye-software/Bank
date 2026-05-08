# NordicBank

A full-stack monolithic banking application built for a Software Quality exam project. The codebase is intentionally rich in business rules — loan approval, fraud detection, interest tiers, KYC, currency conversion — so that every major testing technique can be demonstrated: unit (blackbox + whitebox/decision coverage), mocking rationale, integration (API + DB), negative testing, E2E (Playwright), stress/performance, and static analysis. 

**Stack:** TypeScript · Express · PostgreSQL · Prisma 7 · Vitest · Playwright · Claude API · currencyapi.com

---

## Getting started

**Prerequisites:** Docker Desktop + Node 20+

### Step 1 — Start Postgres in Docker

```bash
docker compose up -d
```

This starts only the Postgres container on `localhost:5432`. The database is
named `nordicbank`, user `nordicbank`, password `nordicbank`.

### Step 2 — Configure environment

```bash
cp .env.example .env
```

`.env.example` already has the correct `DATABASE_URL` for the Docker Postgres.
Fill in the remaining values:

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | Yes | Any string ≥ 32 characters |
| `ANTHROPIC_API_KEY` | No | Loan AI assessment — endpoint degrades gracefully without it |
| `CURRENCY_API_KEY` | No | Currency conversion — endpoint degrades gracefully without it |

### Step 3 — Push schema, generate client, seed

```bash
npm install
npx prisma db push       # creates all tables from schema.prisma
npx prisma generate      # generates the TypeScript client
npm run db:seed          # inserts Alice + staff user with test accounts
```

### Step 4 — Start the API

```bash
npm run dev:server
# API available at http://localhost:3000
```

### Inspect the database

```bash
npx prisma studio
# Opens a browser UI at http://localhost:5555 connected to your Docker Postgres
```

---

### Reset everything

```bash
docker compose down -v   # wipe the Postgres volume
docker compose up -d     # fresh Postgres
npx prisma db push && npm run db:seed
```

---

### Full containerised stack (optional)

If you want the API running inside Docker too (no local Node required):

```bash
docker compose --profile full up --build
# API at http://localhost:3000, Postgres at localhost:5432
```

Note: `npx prisma studio` won't see this database unless your local `.env`
`DATABASE_URL` matches `postgresql://nordicbank:nordicbank@localhost:5432/nordicbank`.

---

## Seed credentials

Both users have the password `password123`.

| Email | Role | Pre-created accounts |
|---|---|---|
| `alice@example.com` | CUSTOMER | Checking `11111111-…-1111` ($5,000) · Savings `22222222-…-2222` ($10,000) |
| `staff@nordicbank.com` | STAFF | — |

KYC is pre-set to `VERIFIED` for both users so all endpoints are reachable immediately.

When `ENABLE_KYC_AUTO_APPROVE=true` (default in Docker), any new KYC submission with a `nationalIdNumber` starting with `TEST-` is instantly approved.

---

## Testing endpoints

### 1. Login and grab a token

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"password123"}' | jq .
```

Copy the `token` from the response and export it:

```bash
export TOKEN="eyJ..."
```

### 2. Health check

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

### 3. List accounts

```bash
curl http://localhost:3000/api/v1/accounts \
  -H "Authorization: Bearer $TOKEN" | jq .
```

### 4. Deposit

```bash
curl -X POST http://localhost:3000/api/v1/transactions/deposit \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"11111111-1111-1111-1111-111111111111","amount":"250.00"}' | jq .
```

### 5. Withdraw

```bash
curl -X POST http://localhost:3000/api/v1/transactions/withdraw \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"accountId":"11111111-1111-1111-1111-111111111111","amount":"100.00"}' | jq .
```

### 6. Transfer between accounts

```bash
curl -X POST http://localhost:3000/api/v1/transactions/transfer \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sourceAccountId": "11111111-1111-1111-1111-111111111111",
    "destinationAccountId": "22222222-2222-2222-2222-222222222222",
    "amount": "500.00"
  }' | jq .
```

### 7. Apply for a loan

```bash
curl -X POST http://localhost:3000/api/v1/loans \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "11111111-1111-1111-1111-111111111111",
    "requestedAmount": "15000.00",
    "requestedTermMonths": 36,
    "annualIncome": "75000.00",
    "monthlyDebt": "500.00",
    "creditScore": 720,
    "employmentStatus": "EMPLOYED"
  }' | jq .
```

### 8. Currency conversion

```bash
curl -X POST http://localhost:3000/api/v1/currency/convert \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "11111111-1111-1111-1111-111111111111",
    "fromCurrency": "USD",
    "toCurrency": "EUR",
    "amount": "1000.00"
  }' | jq .
```

### 9. Submit KYC (new users)

```bash
curl -X POST http://localhost:3000/api/v1/kyc \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "Jane Doe",
    "dateOfBirth": "1990-05-15",
    "nationalIdNumber": "TEST-12345",
    "documentType": "PASSPORT",
    "documentImageUrl": "https://example.com/doc.jpg"
  }' | jq .
```

Using `TEST-` prefix auto-approves KYC when `ENABLE_KYC_AUTO_APPROVE=true`.

---

## Running the test suite

```bash
# Unit tests (domain logic — no DB required)
npm run test:unit

# Integration tests (requires TEST_DATABASE_URL in .env)
npm run test:integration

# All tests with coverage report
npm run test:coverage

# E2E browser tests (requires running server + seeded DB)
npm run test:e2e
```

---

## Static analysis

```bash
# TypeScript — zero errors enforced
npm run typecheck

# ESLint — zero warnings enforced
npm run lint
```

---

## Project layout

```
src/
  domain/          # Pure business logic — fully unit-testable, no I/O
  controllers/     # HTTP handlers — parse, call domain, format response
  repositories/    # All Prisma DB access
  middleware/      # Auth, validation, error handling
  config/          # Env vars (Zod-validated), logger, Anthropic client
  shared/          # Result<T,E> type, AppError hierarchy

tests/
  unit/            # Domain unit tests
  integration/     # API + DB integration tests (supertest + real Postgres)
  e2e/             # Playwright browser journeys
  stress/          # Load tests (autocannon / k6)
  helpers/         # Factories, DB helpers, test app builder

prisma/
  schema.prisma    # Database schema
  seed.ts          # Dev fixtures (idempotent)
```
