import { test, expect } from "@playwright/test";
import { TransferPage } from "../pages/transfer.page";

// Seeded fixture account IDs (see tests/e2e/setup/seed.setup.ts). Two of Alice's
// own accounts plus a counterparty owned by Bob — used as the destination so the
// transfer is a real cross-user transfer, not a self-transfer rejection.
const ALICE_BUSINESS_ID = "33333333-3333-3333-3333-333333333333";
const BOB_CHECKING_ID = "11111111-1111-1111-1111-111111111111";

test("Happy path for transferring money", async ({ page }) => {
  const transferPage = new TransferPage(page);
  const alert = transferPage.getAlert();

  await transferPage.goto();

  await transferPage.transfer({
    from: "SAVINGS",
    destinationId: ALICE_BUSINESS_ID,
    amount: "123",
  });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Transferred $123.00");

  await transferPage.transfer({
    from: "CHECKING",
    destinationId: ALICE_BUSINESS_ID,
    amount: "321",
  });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Transferred $321.00");

  await transferPage.transfer({
    from: "BUSINESS",
    destinationId: BOB_CHECKING_ID,
    amount: "213",
  });
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("Transferred $213.00");
});
