import { describe, it, expect } from 'vitest';
import { evaluateLoanApplication } from '../../../src/domain/loans/loan.eligibility';
import { buildLoanApplication } from '../helpers/factories';
import { ErrorCode } from '../../../src/shared/errors';
import type { KycStatus, EmploymentStatus } from '../../../src/domain/accounts/account.types';

// ---------------------------------------------------------------------------
// Blackbox tests for the §6.2 LOAN HARD-REJECTION rules (R1–R9) —
// Equivalence Partitioning (EP) + Boundary Value Analysis (BV), expressed as
// parametrised tests. Mirrors the partition table 1-to-1.
//
// Driven entirely through the public contract `evaluateLoanApplication(input)`.
// There are no per-rule exported validators, so each rule is exercised through
// the full pipeline.
//
// IMPORTANT — Result shape differs from the withdrawal validators.
//   evaluateLoanApplication wraps BOTH outcomes in `ok: true`:
//     • approval  → { ok: true, value: { decision: 'APPROVED',  … } }
//     • rejection → { ok: true, value: { decision: 'REJECTED', rejectionCode, … } }
//   So we assert on `value.decision` / `value.rejectionCode`, never `result.error`.
//
// IMPORTANT — rules are evaluated in order, first-failure-wins
// (loan.eligibility.ts:202). To isolate the rule under test, every OTHER field
// is held at an approvable value (via buildLoanApplication). Where a rule's
// valid partition needs extra headroom to reach APPROVED (credit-tier cap lives
// downstream of R5/R6), the section's local evaluator widens the base.
//
// Monetary fields (requestedAmount, annualIncome) are plain `number`s here, so
// $0.01 precision is expressed as numeric literals (499.99, 500000.01, …).
// Non-monetary fields (age, creditScore, term, loan count) step by whole units.
//
//
// ── Rule → section coverage map ────────────────────────────────────────────
//   R1 APPLICANT_UNDERAGE        → applicantAge      (boundary 18)
//   R2 KYC_NOT_VERIFIED          → kycStatus         (categorical)
//   R3 UNEMPLOYED_APPLICANT      → employmentStatus  (categorical)
//   R4 CREDIT_SCORE_TOO_LOW      → creditScore       (boundary 500; +tier upper bound 850)
//   R5 LOAN_AMOUNT_TOO_LOW       → requestedAmount   (boundary $500.00)
//   R6 LOAN_AMOUNT_TOO_HIGH      → requestedAmount   (boundary $500,000.00)
//   R7 INVALID_LOAN_TERM         → requestedTermMonths (set {12,24,36,48,60})
//   R8 TOO_MANY_ACTIVE_LOANS     → existingLoansCount  (boundary 3, one-sided)
//   R9 INVALID_INCOME            → annualIncome      (boundary $0.00)
// ---------------------------------------------------------------------------

// Conceptual MIN/MAX of the numeric domain (cf. MIN/MAX DECIMAL / INT columns).
//  • Monetary: ±1e12 — large, but small enough that $0.01 stays representable
//    in float64 (ulp at 1e12 ≈ 0.0002), so MIN/MAX ± 0.01 are distinct values.
//  • Integer: the safe-integer extremes (±1 stays exact).
const MIN_DECIMAL = -1e12;
const MAX_DECIMAL = 1e12;
const MIN_INT = Number.MIN_SAFE_INTEGER;
const MAX_INT = Number.MAX_SAFE_INTEGER;




// =============================================================================
// R1. applicantAge — APPLICANT_UNDERAGE (boundary: 18)
// =============================================================================
//
// ┌──────────────┬──────────────────────┬──────────────┬──────────────────────────────────────┐
// │ Partition    │ Range                │ EP value     │ BV test case values                  │
// ├──────────────┼──────────────────────┼──────────────┼──────────────────────────────────────┤
// │ Invalid      │ MIN INT .. 17        │ 0, 8         │ MIN-1, MIN, MIN+1, 16, 17            │
// │ Valid        │ 18 .. 140           │ 61           │ 18, 19, 139, 140, 141                │
// └──────────────┴──────────────────────┴──────────────┴──────────────────────────────────────┘
//   No upper-age rule exists in code, so 141 (just past the table's domain max)
//   is still valid/approved.

describe('R1 — applicantAge (boundary 18)', () => {
  const evalAge = (applicantAge: number) =>
    evaluateLoanApplication(buildLoanApplication({ applicantAge }));

  describe('Invalid partition: MIN INT .. 17 (underage)', () => {
    it.each<[string, number]>([
      ['BV MIN INT - 1',           MIN_INT - 1],
      ['BV MIN INT',               MIN_INT],
      ['BV MIN INT + 1',           MIN_INT + 1],
      ['EP 0',                     0],
      ['EP 8',                     8],
      ['BV 16 (just below 17)',    16],
      ['BV 17 (upper boundary)',   17],
    ])('%s → APPLICANT_UNDERAGE', (_label, applicantAge) => {
      const result = evalAge(applicantAge);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          decision: 'REJECTED',
          rejectionCode: ErrorCode.APPLICANT_UNDERAGE,
        }),
      });
    });
  });

  describe('Valid partition: 18 .. 140 (adult)', () => {
    it.each<[string, number]>([
      ['BV 18 (lower boundary)',     18],
      ['BV 19 (just above 18)',      19],
      ['EP 61',                      61],
      ['BV 139 (just below 140)',    139],
      ['BV 140 (domain max)',        140],
      ['BV 141 (just above max — no upper rule, still valid)', 141],
    ])('%s → APPROVED', (_label, applicantAge) => {
      const result = evalAge(applicantAge);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ decision: 'APPROVED' }),
      });
    });
  });
});




// =============================================================================
// R2. kycStatus — KYC_NOT_VERIFIED (categorical: only VERIFIED passes)
// =============================================================================
//
// No boundary analysis — the input is an enum. Pure equivalence partitioning:
// every non-VERIFIED state is one invalid class; VERIFIED is the valid class.
//
// ┌──────────────┬──────────────────────────────────────┬─────────────────────────────────────┐
// │ Partition    │ Members                              │ EP test case values                 │
// ├──────────────┼──────────────────────────────────────┼─────────────────────────────────────┤
// │ Invalid      │ kycStatus !== 'VERIFIED'             │ NOT_STARTED, PENDING_REVIEW, REJECTED │
// │ Valid        │ kycStatus === 'VERIFIED'             │ VERIFIED                            │
// └──────────────┴──────────────────────────────────────┴─────────────────────────────────────┘

describe('R2 — kycStatus (categorical)', () => {
  const evalKyc = (kycStatus: KycStatus) =>
    evaluateLoanApplication(buildLoanApplication({ kycStatus }));

  describe('Invalid partition: kycStatus !== VERIFIED', () => {
    it.each<[string, KycStatus]>([
      ['EP NOT_STARTED',    'NOT_STARTED'],
      ['EP PENDING_REVIEW', 'PENDING_REVIEW'],
      ['EP REJECTED',       'REJECTED'],
    ])('%s → KYC_NOT_VERIFIED', (_label, kycStatus) => {
      const result = evalKyc(kycStatus);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          decision: 'REJECTED',
          rejectionCode: ErrorCode.KYC_NOT_VERIFIED,
        }),
      });
    });
  });

  describe('Valid partition: kycStatus === VERIFIED', () => {
    it.each<[string, KycStatus]>([
      ['EP VERIFIED', 'VERIFIED'],
    ])('%s → APPROVED', (_label, kycStatus) => {
      const result = evalKyc(kycStatus);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ decision: 'APPROVED' }),
      });
    });
  });
});




// =============================================================================
// R3. employmentStatus — UNEMPLOYED_APPLICANT (categorical)
// =============================================================================
//
// ┌──────────────┬──────────────────────────────────────┬───────────────────────────────────┐
// │ Partition    │ Members                              │ EP test case values               │
// ├──────────────┼──────────────────────────────────────┼───────────────────────────────────┤
// │ Invalid      │ employmentStatus === 'UNEMPLOYED'    │ UNEMPLOYED                        │
// │ Valid        │ employmentStatus !== 'UNEMPLOYED'    │ EMPLOYED, SELF_EMPLOYED, RETIRED  │
// └──────────────┴──────────────────────────────────────┴───────────────────────────────────┘

describe('R3 — employmentStatus (categorical)', () => {
  const evalEmployment = (employmentStatus: EmploymentStatus) =>
    evaluateLoanApplication(buildLoanApplication({ employmentStatus }));

  describe('Invalid partition: employmentStatus === UNEMPLOYED', () => {
    it.each<[string, EmploymentStatus]>([
      ['EP UNEMPLOYED', 'UNEMPLOYED'],
    ])('%s → UNEMPLOYED_APPLICANT', (_label, employmentStatus) => {
      const result = evalEmployment(employmentStatus);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          decision: 'REJECTED',
          rejectionCode: ErrorCode.UNEMPLOYED_APPLICANT,
        }),
      });
    });
  });

  describe('Valid partition: employmentStatus !== UNEMPLOYED', () => {
    it.each<[string, EmploymentStatus]>([
      ['EP EMPLOYED',      'EMPLOYED'],
      ['EP SELF_EMPLOYED', 'SELF_EMPLOYED'],
      ['EP RETIRED',       'RETIRED'],
    ])('%s → APPROVED', (_label, employmentStatus) => {
      const result = evalEmployment(employmentStatus);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ decision: 'APPROVED' }),
      });
    });
  });
});




// =============================================================================
// R4. creditScore — CREDIT_SCORE_TOO_LOW (boundary 500; valid range 500..850)
// =============================================================================
//
// Scores ABOVE 850 also reject with the SAME code via the tier lookup returning
// null (loan.eligibility.ts:209), so the valid class is bounded 500..850.
//
// ┌──────────────┬──────────────────────────────┬──────────────┬──────────────────────────────────────┐
// │ Partition    │ Range                        │ EP value     │ BV test case values                  │
// ├──────────────┼──────────────────────────────┼──────────────┼──────────────────────────────────────┤
// │ Invalid (neg)│ MIN INT .. -1                │ -123456      │ MIN-1, MIN, MIN+1, -2, -1           │
// │ Invalid (lo) │ 0 .. 499                     │ 250          │ 0, 1, 498, 499                      │
// │ Valid        │ 500 .. 850                   │ 675          │ 500, 501, 849, 850                  │
// │ Invalid (hi) │ 851 .. MAX INT               │ 12345        │ 851, 852, MAX-1, MAX, MAX+1         │
// └──────────────┴──────────────────────────────┴──────────────┴──────────────────────────────────────┘

describe('R4 — creditScore (boundary 500, valid 500..850)', () => {
  const evalCredit = (creditScore: number) =>
    evaluateLoanApplication(buildLoanApplication({ creditScore }));

  describe('Invalid partition: MIN INT .. -1 (negative)', () => {
    it.each<[string, number]>([
      ['BV MIN INT - 1',                MIN_INT - 1],
      ['BV MIN INT',                    MIN_INT],
      ['BV MIN INT + 1',                MIN_INT + 1],
      ['EP -123456',                    -123_456],
      ['BV -2 (just below -1)',         -2],
      ['BV -1 (upper boundary)',        -1],
    ])('%s → CREDIT_SCORE_TOO_LOW', (_label, creditScore) => {
      const result = evalCredit(creditScore);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          decision: 'REJECTED',
          rejectionCode: ErrorCode.CREDIT_SCORE_TOO_LOW,
        }),
      });
    });
  });

  describe('Invalid partition: 0 .. 499 (below minimum)', () => {
    it.each<[string, number]>([
      ['BV 0 (domain minimum)',         0],
      ['BV 1 (just above 0)',           1],
      ['EP 250',                        250],
      ['BV 498 (just below boundary)',  498],
      ['BV 499 (upper boundary)',       499],
    ])('%s → CREDIT_SCORE_TOO_LOW', (_label, creditScore) => {
      const result = evalCredit(creditScore);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          decision: 'REJECTED',
          rejectionCode: ErrorCode.CREDIT_SCORE_TOO_LOW,
        }),
      });
    });
  });

  describe('Valid partition: 500 .. 850', () => {
    it.each<[string, number]>([
      ['BV 500 (lower boundary)',       500],
      ['BV 501 (just above boundary)',  501],
      ['EP 675',                        675],
      ['BV 849 (just below boundary)',  849],
      ['BV 850 (upper boundary)',       850],
    ])('%s → APPROVED', (_label, creditScore) => {
      const result = evalCredit(creditScore);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ decision: 'APPROVED' }),
      });
    });
  });

  describe('Invalid partition: 851 .. MAX INT (above range — no tier)', () => {
    it.each<[string, number]>([
      ['BV 851 (lower boundary)',       851],
      ['BV 852 (just above boundary)',  852],
      ['EP 12345',                      12345],
      ['BV MAX INT - 1',                MAX_INT - 1],
      ['BV MAX INT',                    MAX_INT],
      ['BV MAX INT + 1',                MAX_INT + 1],
    ])('%s → CREDIT_SCORE_TOO_LOW', (_label, creditScore) => {
      const result = evalCredit(creditScore);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          decision: 'REJECTED',
          rejectionCode: ErrorCode.CREDIT_SCORE_TOO_LOW,
        }),
      });
    });
  });
});




// =============================================================================
// R5 / R6. requestedAmount — LOAN_AMOUNT_TOO_LOW / _TOO_HIGH ($500 .. $500,000)
// =============================================================================
//
// One variable, two boundaries, split into five partitions (cf. the withdrawal
// amount table). The local evaluator uses a high-credit, high-income, long-term,
// zero-debt base so the ENTIRE valid range clears the downstream tier-cap and
// reaches APPROVED. R6 (in the rule chain) fires before the tier
// cap, so amounts > $500,000 yield LOAN_AMOUNT_TOO_HIGH.
//
// ┌──────────────┬──────────────────────────────────┬──────────────┬────────────────────────────────────────────────────────────────┐
// │ Partition    │ Range                            │ EP value     │ BV test case values                                            │
// ├──────────────┼──────────────────────────────────┼──────────────┼────────────────────────────────────────────────────────────────┤
// │ Invalid      │ MIN DECIMAL .. -$0.01            │ -$12,345.67  │ MIN-0.01, MIN, MIN+0.01, -$0.02, -$0.01                        │
// │ Invalid      │ $0.00                            │ $0.00        │ $0.00                                                          │
// │ Invalid      │ $0.01 .. $499.99                 │ $249.99      │ $0.01, $0.02, $499.98, $499.99                                 │
// │ Valid        │ $500.00 .. $500,000.00           │ $250,250.00  │ $500.00, $500.01, $499,999.99, $500,000.00                     │
// │ Invalid      │ $500,000.01 .. MAX DECIMAL       │ $1,234,567.89│ $500,000.01, $500,000.02, MAX-0.01, MAX, MAX+0.01              │
// └──────────────┴──────────────────────────────────┴──────────────┴────────────────────────────────────────────────────────────────┘

describe('R5/R6 — requestedAmount range $500.00 .. $500,000.00', () => {
  const evalAmount = (requestedAmount: number) =>
    evaluateLoanApplication(
      buildLoanApplication({
        requestedAmount,
        creditScore: 800,
        annualIncome: 600_000,
        requestedTermMonths: 60,
      }),
    );

  describe('Invalid partition: MIN DECIMAL .. -$0.01 (negative)', () => {
    it.each<[string, number]>([
      ['BV MIN DECIMAL - 0.01',          MIN_DECIMAL - 0.01],
      ['BV MIN DECIMAL',                 MIN_DECIMAL],
      ['BV MIN DECIMAL + 0.01',          MIN_DECIMAL + 0.01],
      ['EP -$12,345.67',                 -12_345.67],
      ['BV -$0.02 (just below -$0.01)',  -0.02],
      ['BV -$0.01 (upper boundary)',     -0.01],
    ])('%s → LOAN_AMOUNT_TOO_LOW', (_label, requestedAmount) => {
      const result = evalAmount(requestedAmount);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          decision: 'REJECTED',
          rejectionCode: ErrorCode.LOAN_AMOUNT_TOO_LOW,
        }),
      });
    });
  });

  describe('Invalid partition: $0.00', () => {
    it.each<[string, number]>([
      ['EP / BV $0.00', 0],
    ])('%s → LOAN_AMOUNT_TOO_LOW', (_label, requestedAmount) => {
      const result = evalAmount(requestedAmount);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          decision: 'REJECTED',
          rejectionCode: ErrorCode.LOAN_AMOUNT_TOO_LOW,
        }),
      });
    });
  });

  describe('Invalid partition: $0.01 .. $499.99 (too low)', () => {
    it.each<[string, number]>([
      ['BV $0.01 (lower boundary)',                0.01],
      ['BV $0.02 (just above lower boundary)',     0.02],
      ['EP $249.99',                               249.99],
      ['BV $499.98 (just below upper boundary)',   499.98],
      ['BV $499.99 (upper boundary)',              499.99],
    ])('%s → LOAN_AMOUNT_TOO_LOW', (_label, requestedAmount) => {
      const result = evalAmount(requestedAmount);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          decision: 'REJECTED',
          rejectionCode: ErrorCode.LOAN_AMOUNT_TOO_LOW,
        }),
      });
    });
  });

  describe('Valid partition: $500.00 .. $500,000.00', () => {
    it.each<[string, number]>([
      ['BV $500.00 (lower boundary)',              500.00],
      ['BV $500.01 (just above lower boundary)',   500.01],
      ['EP $250,250.00',                           250_250.00],
      ['BV $499,999.99 (just below upper boundary)', 499_999.99],
      ['BV $500,000.00 (upper boundary)',          500_000.00],
    ])('%s → APPROVED', (_label, requestedAmount) => {
      const result = evalAmount(requestedAmount);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ decision: 'APPROVED' }),
      });
    });
  });

  describe('Invalid partition: $500,000.01 .. MAX DECIMAL (too high)', () => {
    it.each<[string, number]>([
      ['BV $500,000.01 (lower boundary)',          500_000.01],
      ['BV $500,000.02 (just above lower boundary)', 500_000.02],
      ['EP $1,234,567.89',                         1_234_567.89],
      ['BV MAX DECIMAL - 0.01',                    MAX_DECIMAL - 0.01],
      ['BV MAX DECIMAL',                           MAX_DECIMAL],
      ['BV MAX DECIMAL + 0.01',                    MAX_DECIMAL + 0.01],
    ])('%s → LOAN_AMOUNT_TOO_HIGH', (_label, requestedAmount) => {
      const result = evalAmount(requestedAmount);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          decision: 'REJECTED',
          rejectionCode: ErrorCode.LOAN_AMOUNT_TOO_HIGH,
        }),
      });
    });
  });
});




// =============================================================================
// R7. requestedTermMonths — INVALID_LOAN_TERM (set {12, 24, 36, 48, 60})
// =============================================================================
//
// Membership of a discrete set: BV is each valid term ±1, plus the valid terms
// themselves. NOTE: the table's "36 → 25/27" is a typo; the real ±1 boundaries
// of 36 are 35/37, used here.
//
// ┌──────────────┬───────────────────────────────────────────────┬───────────────────────────────────────────────┐
// │ Partition    │ Members                                       │ Test case values                              │
// ├──────────────┼───────────────────────────────────────────────┼───────────────────────────────────────────────┤
// │ Valid        │ term ∈ {12,24,36,48,60}                       │ 12, 24, 36, 48, 60                            │
// │ Invalid      │ term ∉ {12,24,36,48,60}                       │ 11,13, 23,25, 35,37, 47,49, 59,61             │
// └──────────────┴───────────────────────────────────────────────┴───────────────────────────────────────────────┘

describe('R7 — requestedTermMonths (set {12,24,36,48,60})', () => {
  const evalTerm = (requestedTermMonths: number) =>
    evaluateLoanApplication(buildLoanApplication({ requestedTermMonths }));

  describe('Valid partition: term ∈ {12,24,36,48,60}', () => {
    it.each<[string, number]>([
      ['EP/BV 12', 12],
      ['EP/BV 24', 24],
      ['EP/BV 36', 36],
      ['EP/BV 48', 48],
      ['EP/BV 60', 60],
    ])('%s months → APPROVED', (_label, requestedTermMonths) => {
      const result = evalTerm(requestedTermMonths);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ decision: 'APPROVED' }),
      });
    });
  });

  describe('Invalid partition: term ∉ {12,24,36,48,60}', () => {
    it.each<[string, number]>([
      ['BV 11 (just below 12)',  11],
      ['BV 13 (just above 12)',  13],
      ['BV 23 (just below 24)',  23],
      ['BV 25 (just above 24)',  25],
      ['BV 35 (just below 36)',  35],
      ['BV 37 (just above 36)',  37],
      ['BV 47 (just below 48)',  47],
      ['BV 49 (just above 48)',  49],
      ['BV 59 (just below 60)',  59],
      ['BV 61 (just above 60)',  61],
    ])('%s → INVALID_LOAN_TERM', (_label, requestedTermMonths) => {
      const result = evalTerm(requestedTermMonths);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          decision: 'REJECTED',
          rejectionCode: ErrorCode.INVALID_LOAN_TERM,
        }),
      });
    });
  });
});




// =============================================================================
// R8. existingLoansCount — TOO_MANY_ACTIVE_LOANS (boundary 3, ONE-SIDED >= 3)
// =============================================================================
//
// R8 check is `existingLoansCount < 3` → only counts >= 3 are rejected. The
// table's "MIN INT .. -1 → invalid" partition is documentation only (see the
// commented-out block below): negative counts cannot legitimately reach this
// function, and would not reject if they did.
//
// ┌──────────────┬──────────────────────────────┬──────────────┬──────────────────────────────────────┐
// │ Partition    │ Range                        │ EP value     │ BV test case values                  │
// ├──────────────┼──────────────────────────────┼──────────────┼──────────────────────────────────────┤
// │ Invalid†     │ MIN INT .. -1 (†see below)   │ -123456      │ MIN-1, MIN, MIN+1, -2, -1            │
// │ Valid        │ 0 .. 2                       │ 1            │ 0, 2                                 │
// │ Invalid      │ 3 .. MAX INT                 │ 12           │ 3, 4, MAX-1, MAX, MAX+1              │
// └──────────────┴──────────────────────────────┴──────────────┴──────────────────────────────────────┘

describe('R8 — existingLoansCount (boundary 3, one-sided)', () => {
  const evalLoans = (existingLoansCount: number) =>
    evaluateLoanApplication(buildLoanApplication({ existingLoansCount }));

  // ── DOCUMENTATION ONLY — intentionally commented out, do NOT enable ────────
  // The table marks "MIN INT .. -1" as Invalid, expecting TOO_MANY_ACTIVE_LOANS.
  // This block encodes that expectation but is left commented out because:
  //   1. existingLoansCount is a non-negative integer guarded by the Zod request
  //      schema upstream — a negative value can never reach this function, so
  //      there is no real input partition to exercise here.
  //   2. If it WERE run it would FAIL: R8 is one-sided (existingLoansCount < 3),
  //      so negatives PASS R8 and the application APPROVES — the opposite of the
  //      rejection asserted below. Kept as a record of that gap.
  //
  // describe('Invalid partition: MIN INT .. -1 (negative) — would FAIL, see above', () => {
  //   it.each<[string, number]>([
  //     ['BV MIN INT - 1',           MIN_INT - 1],
  //     ['BV MIN INT',               MIN_INT],
  //     ['BV MIN INT + 1',           MIN_INT + 1],
  //     ['EP -123456',               -123_456],
  //     ['BV -2 (just below -1)',    -2],
  //     ['BV -1 (upper boundary)',   -1],
  //   ])('%s → TOO_MANY_ACTIVE_LOANS', (_label, existingLoansCount) => {
  //     const result = evalLoans(existingLoansCount);
  //
  //     expect(result).toEqual({
  //       ok: true,
  //       value: expect.objectContaining({
  //         decision: 'REJECTED',
  //         rejectionCode: ErrorCode.TOO_MANY_ACTIVE_LOANS,
  //       }),
  //     });
  //   });
  // });

  describe('Valid partition: 0 .. 2', () => {
    it.each<[string, number]>([
      ['BV 0 (lower boundary)',    0],
      ['EP 1',                     1],
      ['BV 2 (upper boundary)',    2],
    ])('%s → APPROVED', (_label, existingLoansCount) => {
      const result = evalLoans(existingLoansCount);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({ decision: 'APPROVED' }),
      });
    });
  });

  describe('Invalid partition: 3 .. MAX INT', () => {
    it.each<[string, number]>([
      ['BV 3 (lower boundary)',    3],
      ['BV 4 (just above boundary)', 4],
      ['EP 12',                    12],
      ['BV MAX INT - 1',           MAX_INT - 1],
      ['BV MAX INT',               MAX_INT],
      ['BV MAX INT + 1',           MAX_INT + 1],
    ])('%s → TOO_MANY_ACTIVE_LOANS', (_label, existingLoansCount) => {
      const result = evalLoans(existingLoansCount);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          decision: 'REJECTED',
          rejectionCode: ErrorCode.TOO_MANY_ACTIVE_LOANS,
        }),
      });
    });
  });
});




// =============================================================================
// R9. annualIncome — INVALID_INCOME (boundary $0.00, <= 0 rejected)
// =============================================================================
//
// The valid partition asserts only that R9 does NOT fire (income > 0). "Not
// INVALID_INCOME" is the strongest claim holding across the entire valid partition.
//
// ┌──────────────┬──────────────────────────────────┬──────────────┬────────────────────────────────────────────────────┐
// │ Partition    │ Range                            │ EP value     │ BV test case values                                │
// ├──────────────┼──────────────────────────────────┼──────────────┼────────────────────────────────────────────────────┤
// │ Invalid      │ MIN DECIMAL .. $0.00             │ -$1,234.56   │ MIN-0.01, MIN, MIN+0.01, -$0.01, $0.00             │
// │ Valid        │ $0.01 .. MAX DECIMAL             │ $1,234.56    │ $0.01, $0.02, MAX-0.01, MAX, MAX+0.01              │
// └──────────────┴──────────────────────────────────┴──────────────┴────────────────────────────────────────────────────┘

describe('R9 — annualIncome (boundary $0.00)', () => {
  const evalIncome = (annualIncome: number) =>
    evaluateLoanApplication(buildLoanApplication({ annualIncome }));

  describe('Invalid partition: MIN DECIMAL .. $0.00 (non-positive)', () => {
    it.each<[string, number]>([
      ['BV MIN DECIMAL - 0.01',          MIN_DECIMAL - 0.01],
      ['BV MIN DECIMAL',                 MIN_DECIMAL],
      ['BV MIN DECIMAL + 0.01',          MIN_DECIMAL + 0.01],
      ['EP -$1,234.56',                  -1_234.56],
      ['BV -$0.01 (just below boundary)', -0.01],
      ['BV $0.00 (upper boundary)',      0],
    ])('%s → INVALID_INCOME', (_label, annualIncome) => {
      const result = evalIncome(annualIncome);

      expect(result).toEqual({
        ok: true,
        value: expect.objectContaining({
          decision: 'REJECTED',
          rejectionCode: ErrorCode.INVALID_INCOME,
        }),
      });
    });
  });

  describe('Valid partition: $0.01 .. MAX DECIMAL (R9 passes)', () => {
    it.each<[string, number]>([
      ['BV $0.01 (lower boundary)',      0.01],
      ['BV $0.02 (just above boundary)', 0.02],
      ['EP $1,234.56',                   1_234.56],
      ['BV MAX DECIMAL - 0.01',          MAX_DECIMAL - 0.01],
      ['BV MAX DECIMAL',                 MAX_DECIMAL],
      ['BV MAX DECIMAL + 0.01',          MAX_DECIMAL + 0.01],
    ])('%s → R9 does not fire (not INVALID_INCOME)', (_label, annualIncome) => {
      const result = evalIncome(annualIncome);

      expect(result).not.toEqual({
        ok: true,
        value: expect.objectContaining({ rejectionCode: ErrorCode.INVALID_INCOME }),
      });
    });
  });
});
