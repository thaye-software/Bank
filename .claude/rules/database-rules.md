---
scope: "src/repositories/**/*.ts, src/prisma/**/*.ts"
---

# Database and Prisma Conventions

---

## 1. Repository Pattern

- One repository class per database table
- Prisma client is dependency-injected (never instantiated inside a repository)
- No business logic in repositories — CRUD only
- Repositories return **domain types**, not raw Prisma types; map inside the repository

```typescript
export class AccountRepository {
  constructor(private readonly db: PrismaClient) {}

  async findById(id: string): Promise<Account | null> {
    const row = await this.db.account.findUnique({ where: { id } });
    return row ? toDomainAccount(row) : null;
  }
}
```

---

## 2. PrismaClient Instantiation

- Exactly ONE `PrismaClient` singleton: `src/prisma/client.ts`
- Integration tests use a separate client pointing to `TEST_DATABASE_URL`, created in `tests/helpers/db.helpers.ts` and passed via DI
- Never call `new PrismaClient()` outside of those two locations

---

## 3. Atomic Transactions

Any operation touching multiple tables must use `prisma.$transaction()`:

```typescript
await this.db.$transaction(async (tx) => {
  await tx.account.update({ where: { id: sourceId }, data: { balance: { decrement: amount } } });
  await tx.account.update({ where: { id: destId },   data: { balance: { increment: amount } } });
  await tx.transaction.create({ data: transferRecord });
});
```

Operations that must be atomic:
- Transfer debit + credit
- Withdrawal + fraud signal creation
- KYC verified + account activation for all user accounts
- Loan decision record + application status update
- Conversion + fee debit

---

## 4. Pessimistic Locking for Balance Operations

When reading a balance and then writing (to prevent race conditions under load):

```typescript
const [account] = await this.db.$queryRaw<Account[]>`
  SELECT * FROM accounts WHERE id = ${id} FOR UPDATE
`;
```

This is required on the withdrawal, transfer, and conversion flows. Stress test results will reveal lock contention if throughput is high — document in `tests/stress/RESULTS.md`.

---

## 5. Soft Deletes

- Accounts and users have `deletedAt DateTime?` — never hard-delete
- Prisma middleware in `src/prisma/middleware.ts` automatically appends `WHERE deletedAt IS NULL` to all `find*` queries
- Repositories do not need to handle this explicitly

---

## 6. Migrations

- Every schema change requires a migration: `npx prisma migrate dev --name <description>`
- Review all migrations for backward-compatibility before applying to production
- `prisma/seed.ts` creates standard dev fixtures using `upsert` (idempotent)

---

## 7. schema.prisma Naming Conventions

- Model names: `PascalCase` singular (`Account`, `Transaction`)
- Field names: `camelCase`
- Table names: `snake_case` plural via `@@map("accounts")`
- Enum values: `UPPER_SNAKE_CASE`
- Foreign keys: `<relation>Id` (`userId`, `accountId`)
- Every model has `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt`

---

## 8. Required Indexes

Declare in `schema.prisma` (performance-critical for rolling-window queries):

| Table | Index | Reason |
|---|---|---|
| `accounts` | `userId` | Frequent owner lookup |
| `transactions` | `accountId` | All queries filter by account |
| `transactions` | `createdAt` | Rolling time-window queries |
| `transactions` | `(accountId, createdAt)` | Composite — fraud velocity check |
| `loan_applications` | `userId` | Application lookup by user |
| `fraud_signals` | `transactionId` | Signals lookup per transaction |

---

## 9. Test Database Rules

- `TEST_DATABASE_URL` must point to a **separate database** (not a schema prefix) — truncation must never touch production data
- Schema is kept in sync via `prisma migrate deploy` in the test setup script
- `beforeEach` in every integration suite: truncate all tables
- `afterAll`: disconnect the Prisma client
- Never rely on implicit row ordering — always use `orderBy` when order matters

---

## 10. Slow Query Logging

In non-production environments, the Prisma client emits `query` events. Queries taking longer than **100ms** are logged at `warn` level with the full query string. Use this to identify missing indexes during stress testing.
