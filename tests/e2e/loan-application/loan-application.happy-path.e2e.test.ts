import { test, expect } from '../fixtures';

// Happy path: a clean application that hits every rule's "accept" branch and
// lands on the tier-1 credit-score band (750–850).
//
// Expected APR (banking-rules §6.3 + §6.4):
//   creditScore 850 → baseRate 5.00% (750–850 tier)
//   employmentStatus EMPLOYED → +0.00%
//   final APR = 5.00%
// Expected approved amount: $10,000.00 (well under the $500,000 tier-1 ceiling).
test('Happy path for loan application — APPROVED with score 850, EMPLOYED, $10k / 12 months', async ({ loanApplicationPage }) => {
  await loanApplicationPage.goto();

  await loanApplicationPage.apply({
    account: 'BUSINESS',
    requestedAmount: '10000',
    termMonths: 12,
    annualIncome: '100000',
    monthlyDebt: '0',
    age: '21',
    creditScore: '850',
  });

  const result = loanApplicationPage.getResultCard();
  await expect(result).toBeVisible();
  await expect(result).toContainText('APPROVED');
  await expect(result).toContainText('$10000.00');
  await expect(result).toContainText('5.00%');
  await expect(result).toContainText('months');
});
