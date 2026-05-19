import { test, expect } from '../fixtures';

// Negative E2E for the loan application flow. The exhaustive rule-by-rule
// rejection matrix (R1–R9 + DTI + amount-vs-tier) lives at the unit layer in
// loan.eligibility.ts — this test exists to prove that when the backend
// returns a REJECTED decision, the user-facing UI surfaces it.
//
// Trigger: creditScore 400 — below MIN_CREDIT_SCORE (500), so R4 fires and
// the backend persists a REJECTED record with rejectionCode CREDIT_SCORE_TOO_LOW.
//
// NB: the LoanApplication component currently reads data.errorCode but the
// backend returns data.rejectionCode (see client/src/pages/LoanApplication.tsx),
// so the destructive alert shows the fallback "Application rejected" string
// rather than the specific code. Asserting on the REJECTED badge + alert
// visibility keeps the test resilient to that field-name bug being fixed.
test('shows REJECTED when credit score is below the 500 minimum', async ({ loanApplicationPage }) => {
  await loanApplicationPage.goto();

  await loanApplicationPage.apply({
    account: 'BUSINESS',
    requestedAmount: '10000',
    termMonths: 12,
    annualIncome: '100000',
    monthlyDebt: '0',
    age: '21',
    creditScore: '400',
  });

  const result = loanApplicationPage.getResultCard();
  await expect(result).toBeVisible();
  await expect(result).toContainText('REJECTED');

  // The destructive alert is rendered inside the result card on REJECTED.
  const alert = loanApplicationPage.getRejectionAlert();
  await expect(alert).toBeVisible();

  // The APPROVED-only fields must NOT appear on a rejection.
  await expect(result).not.toContainText('Approved amount');
  await expect(result).not.toContainText('Monthly payment');
});
