# NordicBank Frontend — Design Spec
_Date: 2026-05-06_

## Purpose

Build a React frontend for the NordicBank application. Primary use: Playwright E2E tests for the Software Quality exam. The UI must expose every backend user journey through clearly labelled, accessible HTML elements.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Bundler | Vite 5 + `@vitejs/plugin-react` |
| UI components | shadcn/ui (Radix UI + Tailwind CSS v3) |
| Routing | React Router v6 |
| Server state | TanStack React Query v5 |
| Forms | React Hook Form + Zod |
| HTTP | Native `fetch` via typed wrappers in `client/src/api/` |
| Auth | JWT stored in `localStorage`; injected as `Authorization: Bearer` header by base fetch helper |

---

## Visual Design

- **Theme:** Dark / modern — `slate-900` background, `slate-800` sidebar, `blue-500` accent
- **Component library:** shadcn/ui components (Button, Input, Card, Select, Table, Alert, Skeleton, Dialog, Badge, Tabs)
- **Layout:** Fixed left sidebar + main content outlet

---

## Directory Structure

```
client/
  src/
    pages/
      Login.tsx
      Register.tsx
      Dashboard.tsx
      Accounts.tsx
      kyc/
        KycSubmission.tsx
      transactions/
        Deposit.tsx
        Withdraw.tsx
        Transfer.tsx
        History.tsx
      LoanApplication.tsx
      CurrencyConvert.tsx
    components/
      layout/
        AppShell.tsx        # Protected layout: sidebar + <Outlet />
        Sidebar.tsx         # Nav links + logout
      ui/                   # shadcn/ui generated components
    api/
      auth.api.ts
      accounts.api.ts
      transactions.api.ts
      loans.api.ts
      currency.api.ts
      kyc.api.ts
    hooks/
      useAuth.ts
      useAccounts.ts
      useTransactions.ts
      useLoans.ts
      useCurrency.ts
      useKyc.ts
    lib/
      auth.ts               # getToken / setToken / clearToken
      fetch.ts              # base fetch: injects auth header, unwraps envelope
    types/                  # client-side types; shared domain types via @shared alias
  index.html
  vite.config.ts
  tsconfig.json
  components.json           # shadcn/ui config
  tailwind.config.ts
  postcss.config.js
```

---

## Routes

| Path | Component | Protected |
|---|---|---|
| `/login` | Login | No |
| `/register` | Register | No |
| `/` | Dashboard | Yes |
| `/accounts` | Accounts | Yes |
| `/kyc` | KycSubmission | Yes |
| `/transactions/deposit` | Deposit | Yes |
| `/transactions/withdraw` | Withdraw | Yes |
| `/transactions/transfer` | Transfer | Yes |
| `/transactions/history` | History | Yes |
| `/loans` | LoanApplication | Yes |
| `/currency` | CurrencyConvert | Yes |

Protected routes are wrapped in a `<ProtectedRoute>` component that redirects to `/login` if no valid JWT is present.

---

## Sidebar Navigation

```
NordicBank
──────────
Dashboard
Accounts
KYC
──────────
Transactions
  Deposit
  Withdraw
  Transfer
  History
──────────
Loan Application
Currency Convert
──────────
Logout
```

---

## Pages & Key UI Elements

### Login
- Email input (`getByLabel('Email')`)
- Password input (`getByLabel('Password')`)
- Submit button (`getByRole('button', { name: 'Sign in' })`)
- Link to Register

### Register
- Full name, email, password inputs
- Submit button (`getByRole('button', { name: 'Register' })`)

### Dashboard
- Account balance cards (one per account)
- Recent transactions list (last 5)

### Accounts
- Table of user accounts with type, balance, status
- "New Account" button opens a Dialog
- Account type select (CHECKING / SAVINGS / BUSINESS) in dialog
- Confirm create button

### KYC Submission
- Full name, date of birth, national ID number inputs
- Document type select (PASSPORT / NATIONAL_ID / DRIVERS_LICENSE)
- Document image URL input
- Submit button
- Status badge showing current KYC state

### Deposit
- Account select
- Amount input
- Submit button
- Success / error Alert showing amount or `error.code`

### Withdraw
- Account select
- Amount input
- Submit button
- Success / error Alert

### Transfer
- Source account select
- Destination account ID input
- Amount input
- Submit button
- Success / error Alert (surfaces `FRAUD_BLOCKED`, `DAILY_LIMIT_EXCEEDED`, etc.)

### History
- Transactions table: type, amount, status, date columns
- Status Badge (COMPLETED / REVIEW_FLAGGED / FRAUD_BLOCKED / PENDING_WEEKEND)

### Loan Application
- Inputs: requested amount, term (select: 12/24/36/48/60), annual income, monthly debt, credit score, employment status (select), applicant age
- Submit button
- Result panel:
  - Approved: APR, monthly payment, term, AI assessment card (risk level badge + summary text + watch points list)
  - Rejected: error code + message

### Currency Convert
- Source account select
- From / to currency selects (USD EUR GBP DKK SEK NOK CHF JPY CAD AUD)
- Amount input
- Fee breakdown display (calculated fee, net amount)
- Submit button
- Success / error Alert

---

## Error & Loading States

- **Loading:** shadcn `Skeleton` components while React Query fetches
- **API errors:** shadcn `Alert` (destructive variant) showing `error.code` from backend envelope
- **Form validation:** inline errors below each field via React Hook Form
- **Business rule rejections** (422 responses): surfaced as Alerts with the exact `error.code` (e.g. `FRAUD_BLOCKED`, `BELOW_MINIMUM_BALANCE`) — critical for E2E assertions

---

## Auth Flow

1. `POST /api/v1/auth/login` → store JWT in `localStorage`
2. `POST /api/v1/auth/register` → auto-login (store JWT)
3. All subsequent requests inject `Authorization: Bearer <token>` via `lib/fetch.ts`
4. 401 response → clear token, redirect to `/login`
5. `<ProtectedRoute>` checks token presence on render

---

## E2E Test Journeys Supported

| Journey | Pages exercised |
|---|---|
| account-lifecycle | Register → KYC → Accounts (create) → Deposit → Dashboard |
| loan-application | Login → Loan Application (submit) → see AI assessment |
| transfer | Login → Transfer → History (verify balances) |
| fraud-block | Login → Transfer (rapid) → FRAUD_BLOCKED alert visible |
| currency-convert | Login → Currency Convert → fee breakdown → success |

---

## What's Out of Scope

- Admin / staff UI
- Password reset flow
- Pagination on history table (simple list is sufficient for E2E)
- Dark/light theme toggle
