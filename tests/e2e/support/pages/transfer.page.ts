import type { Locator, Page } from "@playwright/test";
import type { AccountTypeRow } from "./accounts.page";

export interface TransferInput {
  readonly from: AccountTypeRow;
  readonly destinationId: string;
  readonly amount: string;
}

export class TransferPage {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto("/transactions/transfer");
  }

  async transfer(input: TransferInput): Promise<void> {
    await this.page.getByRole("combobox", { name: "From account" }).click();
    await this.page
      .getByRole("option", { name: new RegExp(`^${input.from} — `) })
      .click();
    await this.page
      .getByRole("textbox", { name: "Destination account ID" })
      .fill(input.destinationId);
    await this.page.getByRole("textbox", { name: "Amount" }).fill(input.amount);
    await this.page.getByRole("button", { name: "Transfer" }).click();
  }

  // Success and error alerts share role="alert" — the test asserts on text content
  // to distinguish them (e.g. "Transferred $123.00" vs. an error code like
  // "SELF_TRANSFER_NOT_ALLOWED").
  getAlert(): Locator {
    return this.page.getByRole("alert");
  }
}
