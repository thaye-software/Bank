import { describe, expect, it } from 'vitest';
import {
  calculateDti,
  evaluateLoanApplication,
  pmt,
  type LoanApplicationInput,
  type LoanApproval,
  type LoanRejection,
} from '../../../src/domain/loans/loan.eligibility';
import { ErrorCode } from '../../../src/shared/errors';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_INPUT: LoanApplicationInput = {
  applicantAge: 30,
  annualIncome: 60_000,
  monthlyDebt: 0,
  requestedAmount: 10_000,
  requestedTermMonths: 60,
  creditScore: 700,
  employmentStatus: 'EMPLOYED',
  kycStatus: 'VERIFIED',
  existingLoansCount: 0,
};

function evaluate(input: LoanApplicationInput) {
  const result = evaluateLoanApplication(input);
  expect(result.ok).toBe(true);
  return (result as { ok: true; value: LoanApproval | LoanRejection }).value;
}

function expectApproved(input: LoanApplicationInput): LoanApproval {
  const value = evaluate(input);
  expect(value.decision).toBe('APPROVED');
  return value as LoanApproval;
}

function expectRejectedWith(input: LoanApplicationInput, code: string): LoanRejection {
  const value = evaluate(input);
  expect(value.decision).toBe('REJECTED');
  const rejection = value as LoanRejection;
  expect(rejection.rejectionCode).toBe(code);
  return rejection;
}

// ===========================================================================
// Layer 1 — calculateDti() pure formula
// ===========================================================================

describe('calculateDti() — formula', () => {
  it('returns 0 when monthlyDebt = 0 and loan amount = 0', () => {
    expect(calculateDti(0, 60_000, 0.07, 60, 0)).toBe(0);
  });

  it('returns monthlyDebt / monthlyIncome when loan amount = 0', () => {
    expect(calculateDti(1_000, 60_000, 0.07, 60, 0)).toBeCloseTo(0.2, 10);
  });

  it('returns Infinity when annualIncome = 0 (divide-by-zero — note: R9 normally blocks this)', () => {
    expect(calculateDti(100, 0, 0.07, 60, 1_000)).toBe(Infinity);
  });

  it('matches manual (debt + pmt) / monthlyIncome calculation', () => {
    const apr = 0.07;
    const term = 60;
    const principal = 10_000;
    const monthlyPayment = pmt(apr, term, principal);
    const expected = (200 + monthlyPayment) / (60_000 / 12);
    expect(calculateDti(200, 60_000, apr, term, principal)).toBeCloseTo(expected, 12);
  });

  it('zero-rate branch — payment is principal / termMonths', () => {
    expect(calculateDti(0, 60_000, 0, 12, 12_000)).toBeCloseTo(0.2, 10);
  });
});

// ===========================================================================
// Layer 2 — DTI rule via evaluateLoanApplication()
// ===========================================================================

describe('DTI rule — high credit (creditScore 700, marginal rule cannot fire)', () => {
  const HIGH_CREDIT_INPUT: LoanApplicationInput = {
    ...BASE_INPUT,
    creditScore: 700,
    annualIncome: 60_000,
    monthlyDebt: 0,
    requestedTermMonths: 60,
  };

  describe('P1 — DTI ≤ 0.43 → APPROVED', () => {
    it.each<[string, number]>([
      ['EP mid: principal $50,000 → DTI ≈ 19.8%',     50_000],
      ['BV  just below 0.43: principal $108,579 → DTI ≈ 0.4300', 108_579],
    ])('%s', (_label, requestedAmount) => {
      expectApproved({ ...HIGH_CREDIT_INPUT, requestedAmount });
    });
  });

  describe('P2 — 0.43 < DTI ≤ 0.50 & creditScore ≥ 650 → APPROVED', () => {
    it.each<[string, number]>([
      ['BV just above 0.43: principal $108,605 → DTI ≈ 0.4301', 108_605],
      ['EP mid 0.45:        principal $113,629 → DTI ≈ 0.4500', 113_629],
      ['BV just below 0.50: principal $126,230 → DTI ≈ 0.4999', 126_230],
      ['BV largest integer ≤ 0.50: principal $126,254 → DTI ≈ 0.499996', 126_254],
    ])('%s', (_label, requestedAmount) => {
      expectApproved({ ...HIGH_CREDIT_INPUT, requestedAmount });
    });
  });

  describe('P4 — DTI > 0.50 → DTI_TOO_HIGH', () => {
    it.each<[string, number]>([
      ['BV smallest integer > 0.50: principal $126,255 → DTI ≈ 0.500000', 126_255],
      ['BV just above 0.50:         principal $126,280 → DTI ≈ 0.5001',   126_280],
      ['EP deep:            principal $131,305 → DTI ≈ 0.5200', 131_305],
      ['EP deeper:          principal $200,000 → DTI ≈ 0.7900', 200_000],
    ])('%s', (_label, requestedAmount) => {
      expectRejectedWith({ ...HIGH_CREDIT_INPUT, requestedAmount }, ErrorCode.DTI_TOO_HIGH);
    });
  });
});

describe('DTI rule — low credit (creditScore 620, marginal rule active)', () => {
  const LOW_CREDIT_INPUT: LoanApplicationInput = {
    ...BASE_INPUT,
    creditScore: 620,
    annualIncome: 48_000,
    monthlyDebt: 1_500,
    requestedTermMonths: 60,
  };

  describe('P1 — DTI ≤ 0.43 → APPROVED', () => {
    it.each<[string, number]>([
      ['EP mid 0.42:                principal $7,911  → DTI ≈ 0.4200', 7_911],
      ['BV just below 0.43:         principal $9,651  → DTI ≈ 0.4299', 9_651],
      ['BV at 0.43 exact (≤, not >): principal $9,669 → DTI ≈ 0.4300', 9_669],
    ])('%s', (_label, requestedAmount) => {
      expectApproved({ ...LOW_CREDIT_INPUT, requestedAmount });
    });
  });

  describe('P3 — 0.43 < DTI ≤ 0.50 & creditScore < 650 → DTI_MARGINAL_LOW_CREDIT', () => {
    it.each<[string, number]>([
      ['BV just above 0.43: principal $9,687  → DTI ≈ 0.4301', 9_687],
      ['EP mid 0.45:        principal $13,185 → DTI ≈ 0.4500', 13_185],
      ['BV just below 0.50: principal $21,957 → DTI ≈ 0.4999', 21_957],
      ['BV largest int ≤ 0.50: principal $21,975 → DTI ≈ 0.499999', 21_975],
    ])('%s', (_label, requestedAmount) => {
      expectRejectedWith(
        { ...LOW_CREDIT_INPUT, requestedAmount },
        ErrorCode.DTI_MARGINAL_LOW_CREDIT,
      );
    });
  });

  describe('P4 — DTI > 0.50 → DTI_TOO_HIGH (takes precedence over MARGINAL)', () => {
    it.each<[string, number]>([
      ['BV smallest int > 0.50: principal $21,976 → DTI ≈ 0.500005', 21_976],
      ['BV just above 0.50:     principal $21,993 → DTI ≈ 0.5001',   21_993],
      ['EP deep 0.52:           principal $25,491 → DTI ≈ 0.5200',   25_491],
      ['EP deeper:              principal $45,000 → DTI ≈ 0.7700',   45_000],
    ])('%s', (_label, requestedAmount) => {
      expectRejectedWith({ ...LOW_CREDIT_INPUT, requestedAmount }, ErrorCode.DTI_TOO_HIGH);
    });
  });
});

// ===========================================================================
// Layer 3 — Credit-score boundary at 650 (with DTI held in the marginal band)
// ===========================================================================

describe('DTI marginal rule — credit-score boundary at 650', () => {
  const SCENARIOS: ReadonlyArray<{
    label: string;
    creditScore: number;
    requestedAmount: number;
    expectedRejection: string | null; // null = APPROVED
  }> = [
    {
      label: 'BV credit 599 (below 500 floor — caught by R4, not DTI)',
      creditScore: 499,
      requestedAmount: 13_185,
      expectedRejection: ErrorCode.CREDIT_SCORE_TOO_LOW,
    },
    {
      label: 'BV credit 500 (minimum, < 650 → marginal rule active)',
      creditScore: 500,
      requestedAmount: 13_185, 
      expectedRejection: null, 
    },
    {
      label: 'BV credit 649 (just below 650 → marginal applies)',
      creditScore: 649,
      requestedAmount: 13_185,
      expectedRejection: ErrorCode.DTI_MARGINAL_LOW_CREDIT,
    },
    {
      label: 'BV credit 650 (exactly at boundary → marginal NO LONGER applies)',
      creditScore: 650,
      requestedAmount: 13_185,
      expectedRejection: null,
    },
    {
      label: 'BV credit 651 (just above → marginal does not apply)',
      creditScore: 651,
      requestedAmount: 13_185,
      expectedRejection: null,
    },
  ];

  
  const cleanCases = SCENARIOS.filter((s) => s.creditScore !== 500);

  it.each(cleanCases)('$label', ({ creditScore, requestedAmount, expectedRejection }) => {
    const input: LoanApplicationInput = {
      ...BASE_INPUT,
      creditScore,
      annualIncome: 48_000,
      monthlyDebt: 1_500,
      requestedAmount,
      requestedTermMonths: 60,
    };

    if (expectedRejection === null) {
      const apr = creditScore >= 750 ? 0.05
        : creditScore >= 700 ? 0.07
        : creditScore >= 650 ? 0.095
        : creditScore >= 600 ? 0.13
        : 0.18;
      const dti = calculateDti(1_500, 48_000, apr, 60, requestedAmount);
      expect(dti).toBeGreaterThan(0.43);
      expect(dti).toBeLessThanOrEqual(0.50);
      expectApproved(input);
    } else {
      expectRejectedWith(input, expectedRejection);
    }
  });
});

// ===========================================================================
// Layer 4 — Annual-income axis (denominator of DTI)
// ===========================================================================

describe('DTI rule — annual-income denominator behaviour', () => {
  it('annualIncome = 0 → R9 (INVALID_INCOME) fires before DTI is computed', () => {
    expectRejectedWith({ ...BASE_INPUT, annualIncome: 0 }, ErrorCode.INVALID_INCOME);
  });

  it('annualIncome = 1 (positive but minuscule) → DTI explodes → DTI_TOO_HIGH', () => {
    expectRejectedWith(
      { ...BASE_INPUT, annualIncome: 1, monthlyDebt: 0, requestedAmount: 1_000 },
      ErrorCode.DTI_TOO_HIGH,
    );
  });

  it('very high income drives DTI → 0 → APPROVED on the DTI axis', () => {
    expectApproved({
      ...BASE_INPUT,
      annualIncome: 10_000_000,
      monthlyDebt: 0,
      requestedAmount: 100_000,
    });
  });
});

// ===========================================================================
// Layer 5 — monthlyDebt axis (independent of loan payment)
// ===========================================================================

describe('DTI rule — monthlyDebt axis (loan payment held tiny)', () => {
  const SETUP: LoanApplicationInput = {
    ...BASE_INPUT,
    annualIncome: 60_000,    
    requestedAmount: 1_000,  
    requestedTermMonths: 60,
    creditScore: 700,        
  };

  describe('high credit (marginal rule cannot fire)', () => {
    it.each<[string, number]>([
      ['EP small md:                    monthlyDebt $0     → DTI ≈ 0.004', 0],
      ['BV just below 0.43:             monthlyDebt $2,130 → DTI ≈ 0.4300', 2_130],
      ['BV just above 0.43:             monthlyDebt $2,131 → DTI ≈ 0.4302', 2_131],
      ['EP mid:                         monthlyDebt $2,300 → DTI ≈ 0.4640', 2_300],
      ['BV just below 0.50:             monthlyDebt $2,480 → DTI ≈ 0.5000', 2_480],
    ])('%s → APPROVED', (_label, monthlyDebt) => {
      expectApproved({ ...SETUP, monthlyDebt });
    });

    it.each<[string, number]>([
      ['BV just above 0.50: monthlyDebt $2,481 → DTI ≈ 0.5002', 2_481],
      ['EP deep:            monthlyDebt $3,000 → DTI ≈ 0.604',  3_000],
    ])('%s → DTI_TOO_HIGH', (_label, monthlyDebt) => {
      expectRejectedWith({ ...SETUP, monthlyDebt }, ErrorCode.DTI_TOO_HIGH);
    });
  });

  describe('low credit (marginal rule active, creditScore 620)', () => {
    const LOW = { ...SETUP, creditScore: 620 };

    it.each<[string, number]>([
      ['BV just below 0.43 (P1): monthlyDebt $2,127 → DTI ≈ 0.4299', 2_127],
    ])('%s → APPROVED', (_label, monthlyDebt) => {
      expectApproved({ ...LOW, monthlyDebt });
    });

    it.each<[string, number]>([
      ['BV just above 0.43 (P3): monthlyDebt $2,128 → DTI ≈ 0.4302', 2_128],
      ['EP mid 0.46:             monthlyDebt $2,300 → DTI ≈ 0.4646', 2_300],
      ['BV just below 0.50 (P3): monthlyDebt $2,477 → DTI ≈ 0.5000', 2_477],
    ])('%s → DTI_MARGINAL_LOW_CREDIT', (_label, monthlyDebt) => {
      expectRejectedWith({ ...LOW, monthlyDebt }, ErrorCode.DTI_MARGINAL_LOW_CREDIT);
    });

    it.each<[string, number]>([
      ['BV just above 0.50 (P4): monthlyDebt $2,478 → DTI ≈ 0.5002', 2_478],
    ])('%s → DTI_TOO_HIGH', (_label, monthlyDebt) => {
      expectRejectedWith({ ...LOW, monthlyDebt }, ErrorCode.DTI_TOO_HIGH);
    });
  });
});

// ===========================================================================
// Layer 6 — Term-months axis (changes payment, therefore changes DTI)
// ===========================================================================

describe('DTI rule — term-months effect on DTI', () => {
  const INPUT = {
    ...BASE_INPUT,
    annualIncome: 60_000,
    monthlyDebt: 0,
    creditScore: 700,
    requestedAmount: 60_000, 
  };

  it('term 24 mo on $60k @7% → payment ≈ $2,686 → DTI ≈ 0.537 → DTI_TOO_HIGH', () => {
    expectRejectedWith({ ...INPUT, requestedTermMonths: 24 }, ErrorCode.DTI_TOO_HIGH);
  });

  it('term 60 mo on $60k @7% → payment ≈ $1,188 → DTI ≈ 0.238 → APPROVED', () => {
    expectApproved({ ...INPUT, requestedTermMonths: 60 });
  });
});

// ===========================================================================
// Layer 7 — Rule-precedence around DTI
// ===========================================================================

describe('DTI rule — precedence vs. other rules', () => {
  it('DTI_TOO_HIGH wins over DTI_MARGINAL_LOW_CREDIT when DTI > 0.50 and credit < 650', () => {
    const result = expectRejectedWith(
      {
        ...BASE_INPUT,
        creditScore: 600,             
        annualIncome: 48_000,
        monthlyDebt: 1_500,
        requestedAmount: 25_491,      
        requestedTermMonths: 60,
      },
      ErrorCode.DTI_TOO_HIGH,
    );
    expect(result.rejectionCode).not.toBe(ErrorCode.DTI_MARGINAL_LOW_CREDIT);
  });

  it('AMOUNT_EXCEEDS_CREDIT_LIMIT fires before DTI when amount is above tier cap', () => {
    expectRejectedWith(
      {
        ...BASE_INPUT,
        creditScore: 620,
        annualIncome: 48_000,
        monthlyDebt: 1_500,
        requestedAmount: 60_000,
        requestedTermMonths: 60,
      },
      ErrorCode.AMOUNT_EXCEEDS_CREDIT_LIMIT,
    );
  });
  
});