---
scope: "src/**/*.ts"
---

# Banking Domain Business Rules

These rules define the authoritative business logic for NordicBank. Every rule stated here must be implemented and must be independently testable. Numbers and thresholds are exact — do not change them without updating tests accordingly.

---

## 1. Account Types

Three account types: `CHECKING`, `SAVINGS`, `BUSINESS`.

### 1.1 Minimum Balances

| Account Type | Minimum Balance |
|---|---|
| CHECKING | $0.00 (no minimum) |
| SAVINGS | $100.00 |
| BUSINESS | $1,000.00 |

- Minimum balance is evaluated on the **post-transaction** balance.
- If a withdrawal or transfer would breach the minimum, reject with `BELOW_MINIMUM_BALANCE`.

### 1.2 Overdraft (CHECKING only)

- Overdraft protection is an optional boolean flag per account.
- When enabled: account may go negative up to **-$500.00**.
- Each overdraft event incurs a flat **$35.00** fee, charged immediately as a separate transaction.
- If balance is already at or below -$500.00, reject with `OVERDRAFT_LIMIT_REACHED`.
- `SAVINGS` and `BUSINESS` accounts have no overdraft — any breach is rejected outright.

### 1.3 Account Status State Machine

Valid statuses: `PENDING_KYC` → `ACTIVE` → `FROZEN` | `CLOSED`

- Accounts are created in `PENDING_KYC`.
- Transition to `ACTIVE` only when the owner's KYC status becomes `VERIFIED`.
- Only `ACTIVE` accounts may initiate or receive transactions.
- `FROZEN` accounts may receive deposits but may NOT initiate withdrawals or transfers.
- `CLOSED` accounts cannot be involved in any transaction and cannot be re-opened.

---

## 2. Deposits

- Minimum: **$0.01** | Maximum single deposit: **$1,000,000.00**
- Deposits > **$10,000.00** are auto-flagged for AML review (`flagReason: "LARGE_CASH_DEPOSIT"`). The deposit still succeeds; a `ComplianceFlag` record is created.
- Deposits are applied immediately.

---

## 3. Withdrawals

- Minimum: **$0.01** | Maximum single withdrawal: **$10,000.00**
- Daily rolling-24h withdrawal limits:
  - CHECKING / SAVINGS: **$5,000.00**
  - BUSINESS: **$20,000.00**
- Rolling window: sum all withdrawals from `(now - 24h)` to `now` (UTC). If sum + requested > limit → `DAILY_LIMIT_EXCEEDED`.
- `SAVINGS` accounts are blocked from withdrawals between **00:00 and 06:00 UTC** → `SAVINGS_OFFHOURS_RESTRICTION`.

---

## 4. Internal Transfers (between NordicBank accounts)

- Minimum: **$0.01** | Maximum single transfer: **$50,000.00**
- Daily outgoing transfer limits (rolling 24h):
  - CHECKING / SAVINGS: **$10,000.00**
  - BUSINESS: **$100,000.00**
- Transfer to the same account → `SELF_TRANSFER_NOT_ALLOWED`.
- Either account not `ACTIVE` → rejected.
- **Weekend queuing**: transfers initiated on Saturday or Sunday (UTC) are assigned status `PENDING_WEEKEND` and executed at **09:00 UTC Monday**. The source account balance is reserved (soft-locked) immediately to prevent double-spending.
- Debit and credit must succeed **atomically** (Prisma transaction).

---

## 5. Interest Calculation

Applied on the **first calendar day of each month** by a scheduled job.

### 5.1 SAVINGS — Tiered APY (compounded monthly)

| Balance | APY |
|---|---|
| $0.01 – $999.99 | 1.50% |
| $1,000.00 – $9,999.99 | 2.25% |
| $10,000.00 – $49,999.99 | 3.00% |
| $50,000.00+ | 4.00% |

Formula: `monthlyRate = (1 + APY)^(1/12) - 1`; interest = `balance × monthlyRate` rounded HALF_UP to 2 decimal places.  
If result < $0.01, no transaction is recorded.

### 5.2 CHECKING
No interest.

### 5.3 BUSINESS
Flat **0.50% APY**, compounded monthly using the same formula as SAVINGS.

---

## 6. Loan Application and Approval

The primary whitebox testing target — 26+ distinct decision branches, each individually testable.

### 6.1 Inputs
```
applicantAge        : number
annualIncome        : number       // USD gross
monthlyDebt         : number       // existing monthly obligations
requestedAmount     : number
requestedTermMonths : number       // must be one of: 12, 24, 36, 48, 60
creditScore         : number       // 300–850
employmentStatus    : 'EMPLOYED' | 'SELF_EMPLOYED' | 'UNEMPLOYED' | 'RETIRED'
kycStatus           : KycStatus
existingLoansCount  : number       // active NordicBank loans
```

### 6.2 Hard Rejection Rules (evaluated in order, return first failure)

| # | Condition | Error Code |
|---|---|---|
| R1 | `applicantAge < 18` | `APPLICANT_UNDERAGE` |
| R2 | `kycStatus !== 'VERIFIED'` | `KYC_NOT_VERIFIED` |
| R3 | `employmentStatus === 'UNEMPLOYED'` | `UNEMPLOYED_APPLICANT` |
| R4 | `creditScore < 500` | `CREDIT_SCORE_TOO_LOW` |
| R5 | `requestedAmount < 500` | `LOAN_AMOUNT_TOO_LOW` |
| R6 | `requestedAmount > 500,000` | `LOAN_AMOUNT_TOO_HIGH` |
| R7 | `requestedTermMonths` not in `[12,24,36,48,60]` | `INVALID_LOAN_TERM` |
| R8 | `existingLoansCount >= 3` | `TOO_MANY_ACTIVE_LOANS` |
| R9 | `annualIncome <= 0` | `INVALID_INCOME` |

### 6.3 Interest Rate by Credit Score

| Credit Score | Base APR |
|---|---|
| 750 – 850 | 5.00% |
| 700 – 749 | 7.00% |
| 650 – 699 | 9.50% |
| 600 – 649 | 13.00% |
| 500 – 599 | 18.00% |

Employment modifier: `SELF_EMPLOYED` +1.50%, `RETIRED` +0.50%, `EMPLOYED` +0.00%.  
Final APR = base + modifier, capped at **25.00%**.

### 6.4 Maximum Loan Amount by Credit Score

| Credit Score | Max Amount |
|---|---|
| 750 – 850 | $500,000 |
| 700 – 749 | $250,000 |
| 650 – 699 | $100,000 |
| 600 – 649 | $50,000 |
| 500 – 599 | $20,000 |

If `requestedAmount > maxForScore` → `AMOUNT_EXCEEDS_CREDIT_LIMIT`.

### 6.5 Debt-to-Income Check

```
proposedMonthlyPayment = PMT(monthlyRate, termMonths, requestedAmount)  // standard amortisation
DTI = (monthlyDebt + proposedMonthlyPayment) / (annualIncome / 12)
```

- `DTI > 0.50` → `DTI_TOO_HIGH`
- `DTI > 0.43` AND `creditScore < 650` → `DTI_MARGINAL_LOW_CREDIT`

### 6.6 Decision

If all checks pass: `APPROVED` with `{ approvedAmount, apr, termMonths, monthlyPayment }`.  
All decisions (approved and rejected) are persisted to `loan_applications`.

### 6.7 Loan Assessment Agent (AI narrative)

After a rule-based `APPROVED` decision, `loan.assessment.agent.ts` calls the Claude API to produce a natural-language risk summary displayed in the loan officer UI. The rule-based decision is **not affected** by the agent output — it is purely informational.

**Input:** applicant profile (age, income, credit score, employment status, DTI, requested amount, term).

**Expected output shape:**
```json
{
  "riskLevel": "LOW" | "MODERATE" | "HIGH",
  "summary": "<2-3 sentence narrative>",
  "watchPoints": ["<string>"]
}
```

**Constraints:**
- Only called on `APPROVED` outcomes. Rejected applications never invoke Claude.
- If the Claude API call fails, the loan approval still succeeds — return approval with `assessment: null` and log at `warn`.
- Use prompt caching: the system prompt is static — mark it with `cache_control: { type: "ephemeral" }`.
- Model: `claude-haiku-4-5-20251001` (fast, low-cost for structured output).
- `ANTHROPIC_API_KEY` must be present and Zod-validated at startup.

---

## 7. Currency Conversion

### 7.1 Supported Currencies
USD, EUR, GBP, DKK, SEK, NOK, CHF, JPY, CAD, AUD.  
Any other currency → `UNSUPPORTED_CURRENCY`.

### 7.2 Exchange Rate Source
`GET https://api.currencyapi.com/v3/latest` using `CURRENCY_API_KEY` env variable.

### 7.3 Rate Caching
- In-memory cache with **60-minute TTL**.
- Fresh cache hit → use without calling external API.
- External API failure + **stale** (expired) cache → use stale rate, include `{ stale: true, cachedAt }` in response.
- External API failure + **no cache** → `EXCHANGE_RATE_UNAVAILABLE`.

### 7.4 Conversion Fee Schedule

| Amount (USD equiv.) | Fee |
|---|---|
| $0.01 – $999.99 | 2.50% |
| $1,000.00 – $9,999.99 | 1.75% |
| $10,000.00+ | 1.00% |

- Fee is on the **source amount before conversion**.
- Minimum fee: **$0.50** (if calculated fee < $0.50, charge $0.50).
- Fee is debited separately as a `FEE` transaction. Conversion uses the post-fee amount.

### 7.5 Conversion Limits
- Min: **$1.00** | Max single: **$25,000.00** | Daily (rolling 24h): **$50,000.00** (all in USD equiv.)

---

## 8. Fraud Detection

Evaluated on every debit transaction. Scores are additive. Signals are recorded as `FraudSignal` records.

| Signal | Points | Condition |
|---|---|---|
| `VELOCITY_3_IN_5MIN` | 40 | ≥3 debit transactions from this account in last 5 minutes |
| `VELOCITY_10_IN_1HR` | 30 | ≥10 debit transactions in last hour |
| `LARGE_AMOUNT_SINGLE` | 35 | Transaction amount > $3,000 |
| `ROUND_AMOUNT` | 10 | Amount has no cents (e.g. $500.00, $1,000.00) |
| `OFFHOURS_LARGE` | 25 | Amount > $1,000 AND current UTC hour is 00–05 |
| `RAPID_BALANCE_DRAIN` | 50 | Transaction would reduce balance by more than 90% |
| `NEW_ACCOUNT_LARGE` | 45 | Account age < 30 days AND amount > $500 |
| `GEOGRAPHIC_ANOMALY` | 0 | **Stub only in v1** — always returns 0, signature must exist |

**Outcome by total score:**
- `< 60`: allow, record any triggered signals
- `60 – 99`: allow, mark transaction `REVIEW_FLAGGED`
- `≥ 100`: **block** transaction, status `FRAUD_BLOCKED`

---

## 9. KYC (Know Your Customer)

### 9.1 State Machine
`NOT_STARTED` → `PENDING_REVIEW` → `VERIFIED` | `REJECTED`

- `REJECTED` may be re-submitted → transitions back to `PENDING_REVIEW`.
- `VERIFIED` cannot be re-submitted.

### 9.2 Submission Requirements
- `fullName`: non-empty string
- `dateOfBirth`: ISO 8601 date; applicant must be **≥18 years old** at submission time, else `APPLICANT_UNDERAGE`
- `nationalIdNumber`: non-empty string (format not validated in v1)
- `documentType`: `'PASSPORT'` | `'NATIONAL_ID'` | `'DRIVERS_LICENSE'`
- `documentImageUrl`: valid URL string

### 9.3 Test Auto-Approval
When `ENABLE_KYC_AUTO_APPROVE=true` (never in production — startup check enforces this):  
If `nationalIdNumber` starts with `TEST-`, KYC is automatically set to `VERIFIED`.

### 9.4 Account Activation on KYC Verified
When KYC transitions to `VERIFIED`, **atomically** transition all `PENDING_KYC` accounts owned by that user to `ACTIVE`.
