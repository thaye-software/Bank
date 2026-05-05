---
scope: "client/**/*.tsx, client/**/*.ts"
---

# Frontend Conventions (React + Vite)

---

## 1. Project Structure

```
client/
  src/
    pages/           # One file per route — thin, delegate to hooks + components
    components/      # Shared UI components
      ui/            # Primitive components (Button, Input, Badge, Modal)
      layout/        # Shell, Sidebar, Header
    api/             # Typed fetch wrappers — one file per backend resource
    hooks/           # Custom React hooks (useAccount, useTransactions, etc.)
    types/           # Client-side TypeScript types
    utils/           # Pure helper functions (formatting, currency display)
  index.html
  vite.config.ts
  tsconfig.json
```

---

## 2. Component Conventions

- **Pages** are route-level components. They own data fetching (via hooks) and layout. No business logic.
- **Components** are presentational — they receive props and render. No direct API calls.
- Every component file exports exactly one component, named identically to the file: `AccountCard.tsx` exports `AccountCard`.
- Props interfaces are defined in the same file as the component, named `<ComponentName>Props`.
- No `React.FC` — use plain function declarations with typed props:

```tsx
interface AccountCardProps {
  account: Account;
  onSelect: (id: string) => void;
}

export function AccountCard({ account, onSelect }: AccountCardProps) { ... }
```

---

## 3. API Layer (`client/src/api/`)

- One file per backend resource: `accounts.api.ts`, `transactions.api.ts`, `loans.api.ts`, etc.
- All functions are async and return typed responses. Errors throw a typed `ApiError`.
- Never use `fetch` directly in pages or components — always go through `client/src/api/`.
- Base URL comes from `import.meta.env.VITE_API_URL` (validated at startup).

```typescript
// loans.api.ts
export async function submitLoanApplication(
  payload: LoanApplicationRequest
): Promise<LoanApplicationResponse> {
  const res = await apiFetch('/api/v1/loans', { method: 'POST', body: payload });
  return res.json();
}
```

---

## 4. State Management

- No global state library (no Redux, no Zustand) — use React Query (`@tanstack/react-query`) for server state.
- Local UI state (modal open, selected tab) uses `useState`.
- All data fetching goes through React Query hooks defined in `client/src/hooks/`.
- Query keys follow the pattern: `['resource', id]` or `['resource', 'list', filters]`.

---

## 5. Styling

- Use **Tailwind CSS** utility classes only. No inline styles. No CSS-in-JS.
- Component-specific layout that cannot be expressed cleanly in Tailwind goes in a co-located `.module.css` file.
- No global CSS overrides — use Tailwind's `@layer` directives if base styles need adjusting.

---

## 6. Form Handling

- Use **React Hook Form** + **Zod** for all forms.
- The Zod schema for a form mirrors the backend request schema (import the shared type if possible).
- Display field-level validation errors inline beneath each input.
- Disable the submit button while the mutation is pending.

```tsx
const schema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/).transform(Number),
});
```

---

## 7. Error and Loading States

- Every data-fetching hook must handle three states explicitly: loading, error, success.
- Loading: show a skeleton or spinner component — never an empty div.
- Error: show a user-readable message with the error code from the API response.
- Never swallow errors silently — always surface them in the UI.

---

## 8. TypeScript

- The same `strict: true` rules as the backend apply.
- Shared domain types (Account, Transaction, LoanDecision, etc.) are imported from `src/shared/types/` via the `@shared` path alias — do not redefine them in the client.
- No `as any` casts. Use type guards to narrow API responses.

---

## 9. Testing (Frontend)

### Component unit tests (Vitest + Testing Library)
- Test files: `client/src/components/<Name>.test.tsx`
- Render the component with `@testing-library/react`, assert on visible text and ARIA roles.
- Mock API hooks with `vi.fn()` — component tests do not hit the network.
- Do not test implementation details (internal state, class names) — test what the user sees.

### E2E tests (Playwright — browser-based)
- Playwright tests in `tests/e2e/` drive the **real browser** against the full running application.
- Use `page.getByRole()` and `page.getByLabel()` locators — never CSS selectors or test IDs.
- Each E2E file covers one complete user journey through the UI:
  - `account-lifecycle.e2e.ts`: register → KYC → open account → deposit → check dashboard balance
  - `loan-application.e2e.ts`: fill loan form → submit → see AI assessment narrative in UI
  - `transfer.e2e.ts`: initiate transfer → confirm → verify both account balances updated
  - `fraud-block.e2e.ts`: rapid transfers via UI → transaction blocked message appears
  - `currency-convert.e2e.ts`: convert currencies → fee breakdown shown → balances updated
- Playwright runs against `TEST_BASE_URL` (default `http://localhost:5173` in dev, `http://localhost:3000` in CI).
- Seed the database to a known state before each E2E test file using the `globalSetup` script.
