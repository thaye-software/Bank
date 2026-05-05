---
scope: "src/routes/**/*.ts, src/controllers/**/*.ts"
---

# HTTP Layer Conventions

---

## 1. Standard Response Envelope

All responses use a unified JSON envelope.

### Success
```json
{ "success": true, "data": { } }
```

### Success (paginated)
```json
{
  "success": true,
  "data": [ ],
  "meta": { "total": 150, "page": 1, "pageSize": 20 }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "BELOW_MINIMUM_BALANCE",
    "message": "Transaction rejected: balance would fall below the $100.00 minimum.",
    "details": { }
  }
}
```

- `code`: `SCREAMING_SNAKE_CASE`, matching an `AppError` code constant
- `message`: human-readable; never expose stack traces in production
- `details`: optional field-level validation failures

---

## 2. HTTP Status Code Mapping

| Situation | Status |
|---|---|
| Resource created | 201 |
| Success with body | 200 |
| Success, no body | 204 |
| Validation error (Zod) | 400 |
| Unauthenticated | 401 |
| Authorized but not permitted | 403 |
| Resource not found | 404 |
| Business rule rejection | 422 |
| External service unavailable | 502 |
| Unexpected server error | 500 |
| Rate limit exceeded | 429 |

Business rule rejections (minimum balance, daily limit, fraud block, KYC not verified, etc.) always use **422 Unprocessable Entity** — not 400. Reserve 400 for malformed request syntax.

---

## 3. Route Definitions

Routers register paths, HTTP methods, and middleware chains only — no logic inside the router file.

```typescript
// accounts.router.ts
router.post(
  '/',
  authenticate,
  validate(createAccountSchema),
  accountsController.create,
);
```

All routes are prefixed with `/api/v1/`. Future breaking changes increment to `/api/v2/`.

---

## 4. Controller Conventions

- Controllers are plain async functions: `(req, res, next) => Promise<void>`
- No business logic in controllers — orchestrate only: parse → call domain/service → format response
- Wrap all controllers in `asyncHandler` to eliminate repetitive try-catch:

```typescript
export const withdraw = asyncHandler(async (req, res) => {
  const result = await transactionService.withdraw(
    req.params.accountId,
    (req.body as WithdrawBody).amount,
    req.user.userId,
  );

  if (!result.ok) {
    throw new AppError(result.error.code, result.error.message, result.error.httpStatus);
  }

  res.status(200).json({ success: true, data: result.value });
});
```

---

## 5. Validation Middleware

- Zod schemas live in the same file as the router or a sibling `*.schema.ts` file
- `validate(schema)` middleware runs before the controller. Failures call `next(new ValidationError(...))` and the controller never runs
- Monetary amounts in request bodies are **strings** (to preserve precision), Zod-transformed to `number`:

```typescript
const withdrawSchema = z.object({
  body: z.object({
    amount: z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/, 'Amount must have at most 2 decimal places')
      .transform(Number)
      .refine((n) => n >= 0.01, 'Minimum withdrawal is $0.01'),
  }),
});
```

---

## 6. Authentication & Authorization

- JWT-based authentication. `authenticate` middleware verifies the token and attaches `req.user = { userId, role }`.
- Roles: `CUSTOMER`, `STAFF`, `ADMIN`.
- Authorization: `authorize('ADMIN')` middleware placed after `authenticate`.
- Always use `req.user.userId` to identify the acting user — never `req.body.userId`.

---

## 7. Rate Limiting

- Global: **100 requests per 15-minute window** per IP (express-rate-limit)
- Auth endpoints: **10 requests per 15-minute window** per IP
- Exceeded limit → 429 with `{ success: false, error: { code: "RATE_LIMIT_EXCEEDED" } }`
