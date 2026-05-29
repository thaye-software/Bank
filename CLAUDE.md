# CLAUDE.md — NordicBank

## Project Purpose

NordicBank is a full-stack monolithic application — a TypeScript/Express.js backend with a React + Vite frontend — that simulates a retail and small-business banking platform. It is the subject of a Software Quality exam project whose explicit goal is to demonstrate every major software testing technique against a rich, realistic domain. The codebase intentionally contains complex branching logic (loan approval, fraud detection, interest tiers), external API integration (currencyapi.com), and stateful database operations so that every technique — unit, blackbox, whitebox, mocking rationale, integration, API, database, E2E, stress, and static — can be meaningfully applied and examined.

## Quick Commands

```bash
npm install                   # Install all dependencies (root + client)

# Development
npm run dev                   # Backend + frontend concurrently (hot-reload)
npm run dev:server            # Express backend only
npm run dev:client            # Vite frontend only

# Build
npm run build                 # Compile backend (tsc) + build frontend (vite build)
npm run build:server          # Backend only
npm run build:client          # Frontend only
npm start                     # Start compiled production server (serves built client)

# Linting & type-checking
npm run lint                  # ESLint over src/** and client/src/**
npm run lint:fix              # Auto-fix ESLint violations
npm run typecheck             # tsc --noEmit on both tsconfigs (zero errors allowed)

# Testing
npm run test                  # All Vitest unit + integration tests
npm run test:unit             # *.unit.test.ts only
npm run test:integration      # *.integration.test.ts (needs TEST_DATABASE_URL)
npm run test:e2e              # Playwright browser E2E suite (needs running server)
npm run test:stress           # k6 / autocannon load tests
npm run test:coverage         # Vitest with v8 coverage report
```

## Directory Layout

```
src/                                   # Express backend
  domain/                              # Pure business logic — no I/O, fully unit-testable
    accounts/
      account.types.ts                 # Enums and type definitions
      account.rules.ts                 # Minimum balances, overdraft policy
      interest.calculator.ts           # Tiered compound interest
    transactions/
      transaction.validator.ts         # Amount, limit, and rolling-window checks
      fraud.detector.ts                # Additive risk scoring (7 signals)
    loans/
      loan.eligibility.ts              # Rule-based approval — 26+ decision branches
    currency/
      currency.service.ts              # Wraps currencyapi.com, applies fees
      rate.cache.ts                    # In-memory TTL cache
    kyc/
      kyc.validator.ts                 # KYC submission rules and state transitions
  routes/                              # Thin Express routers — no logic
  controllers/                         # HTTP handlers: parse → domain → format response
  repositories/                        # All Prisma DB access, one file per aggregate
  prisma/
    schema.prisma
    migrations/
    seed.ts
  middleware/
    auth.middleware.ts
    error.middleware.ts
    validate.middleware.ts             # Zod request validation
  config/
    env.ts                             # Zod-validated environment variables
    logger.ts                          # Pino logger singleton
  shared/
    errors.ts                          # Typed AppError hierarchy
    result.ts                          # Result<T, E> — domain functions never throw

client/                                # React + Vite frontend
  src/
    pages/
      Dashboard.tsx                    # Account overview and recent transactions
      Accounts.tsx                     # Account management
      Transactions.tsx                 # Transaction history and initiate transfer
      LoanApplication.tsx              # Loan form + decision display
      CurrencyConvert.tsx              # Currency conversion UI
      Login.tsx
    components/                        # Shared UI components
    api/                               # Typed fetch wrappers for the Express API
    hooks/                             # Custom React hooks
    types/                             # Shared TypeScript types (client-side)
  index.html
  vite.config.ts
  tsconfig.json

tests/
  unit/
  integration/
  e2e/                                 # Playwright browser tests (full UI journeys)
  stress/
  helpers/
    factories.ts                       # Faker-based test data factories
    db.helpers.ts                      # Truncation, seeders, Prisma test client
    server.helpers.ts                  # Supertest app builder

playwright.config.ts
vitest.config.ts
vitest.integration.config.ts
tsconfig.json                          # Backend tsconfig
.eslintrc.json
.env.example
```

## Key Conventions

### TypeScript
- `strict: true` is non-negotiable — zero tolerance for type errors in CI.
- No `any`. Use `unknown` and narrow explicitly. `@typescript-eslint/no-explicit-any` is `error`.
- Prefer discriminated unions over boolean flags for state machines (`AccountStatus`, `LoanDecision`).
- Domain functions return `Result<T, AppError>` — never throw. Only the error middleware throws.
- Use `readonly` on all domain value objects.
- Shared types used by both frontend and backend live in `src/shared/types/` and are imported by the client via path alias.

### Naming
- Files: `kebab-case.ts` / `kebab-case.tsx` | Classes/Interfaces: `PascalCase` | Functions/variables: `camelCase`
- Constants/Enum members: `UPPER_SNAKE_CASE`
- React components: `PascalCase.tsx`
- Test files: `<subject>.unit.test.ts` / `<subject>.integration.test.ts` / `<subject>.e2e.ts`

### Error Handling
- Every `AppError` has: `code: string`, `message: string`, `httpStatus: number`, optional `details`.
- Domain functions never throw — they return `Result<T, AppError>`.
- Controllers unwrap `Result` and call `next(error)` on failure.
- External API errors (currencyapi.com) are wrapped in `ExternalServiceError extends AppError`.

### Validation
- All request bodies validated with Zod schemas before reaching controllers.
- No raw `req.body` access in controllers — always use the typed, parsed body.
- Monetary amounts in bodies are **strings**, Zod-transformed to number, validated for 2 decimal places.

### Logging
- Use the shared `logger` (pino) — never `console.log` in backend production code.
- `info` for normal operations, `warn` for business-rule rejections, `error` for unexpected failures.

## What NOT To Do

- No `// @ts-ignore` or `// @ts-expect-error` — fix the type instead.
- No `catch (e: any)` — narrow the error type.
- No direct `process.env` access — use `src/config/env.ts`.
- No DB access in controllers — always go through a repository.
- No domain logic in repositories — repositories do CRUD only.
- No mocking the database in integration tests.
- No `.only` or `.skip` in committed test files.
- No `setTimeout`/`setInterval` in tests — use Vitest fake timers.
- No inline styles in React components — use CSS modules or Tailwind classes only.

## Test Philosophy

### When to mock
- **External HTTP APIs** (currencyapi.com): always mock in unit and integration tests. Use `msw` to intercept at the network level so the actual call path is exercised without hitting real services.
- **Database in unit tests**: mock repositories with `vi.fn()` so domain logic is tested without Postgres.
- **Time** (`Date.now`, `new Date()`): mock with `vi.useFakeTimers()` when rules depend on current time (fraud velocity, interest periods, rate cache TTL).

### When NOT to mock
- **Database in integration tests**: must use a real Postgres test database. Catches constraint violations, migration regressions, and lock behaviour that mocks cannot simulate.
- **Express middleware stack**: API integration tests spin up the full app via supertest — auth, validation, and error handling all exercised together.
- **Domain logic in controller tests**: mocking the domain layer only tests HTTP plumbing. Use full integration tests instead.

### Coverage targets
- `src/domain/**`: 90% statement, 85% branch
- `src/repositories/**`: covered by integration tests
- `src/controllers/**`: covered by API integration tests
- `client/src/**`: covered by E2E tests (Playwright) + component unit tests (Vitest + Testing Library)
- Overall: 85% statement, 80% branch
