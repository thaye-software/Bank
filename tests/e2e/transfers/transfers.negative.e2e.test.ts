import { test, expect } from '../fixtures';

// Alice's own BUSINESS account — using it as both source and destination
// triggers SELF_TRANSFER_NOT_ALLOWED (banking-rules §4).
const ALICE_BUSINESS_ID = '33333333-3333-3333-3333-333333333333';

test('shows SELF_TRANSFER_NOT_ALLOWED when source and destination are the same account', async ({ transferPage }) => {
  await transferPage.goto();
  await transferPage.transfer({
    from: 'BUSINESS',
    destinationId: ALICE_BUSINESS_ID,
    amount: '435',
  });

  const alert = transferPage.getAlert();
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('SELF_TRANSFER_NOT_ALLOWED');
});
