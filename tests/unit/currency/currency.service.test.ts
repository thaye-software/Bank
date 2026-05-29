import Decimal from "decimal.js";
import { isErr } from "../../../src/shared/result";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCode } from "../../../src/shared/errors";
import {
  SUPPORTED_CURRENCIES,
  calculateConversion,
  fetchRates,
} from "../../../src/domain/currency/currency.service";
import { clearCache, setCachedRates } from "../../../src/domain/currency/rate.cache";

const MOCK_RATES = Object.fromEntries(
  [...SUPPORTED_CURRENCIES].map((c) => [c, { value: c === "USD" ? 1 : 0.9 }]),
);

function mockFetchSuccess() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: MOCK_RATES }),
    }),
  );
}

function mockFetchFailure() {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
}

describe("7.1 Supported Currencies", () => {
  const supportedCurrencies = [...SUPPORTED_CURRENCIES];

  beforeEach(() => {
    clearCache();
    mockFetchSuccess();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearCache();
  });

  it.each<[string, string, string]>([
    ["unsupported fromCurrency", "XYZ", "USD"],
    ["unsupported toCurrency",   "USD", "XYZ"],
  ])("should reject %s", async (_label, fromCurrency, toCurrency) => {
    const result = await calculateConversion({
      fromCurrency,
      toCurrency,
      amount: new Decimal(100),
      rollingDailyConversionUsd: new Decimal(1000),
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(ErrorCode.UNSUPPORTED_CURRENCY);
    }
  });

  it.each(supportedCurrencies)(
    "should accept supported fromCurrency %s",
    async (fromCurrency) => {
      const result = await calculateConversion({
        fromCurrency,
        toCurrency: "USD",
        amount: new Decimal(100),
        rollingDailyConversionUsd: new Decimal(1000),
      });

      expect(result.ok).toBe(true);
    },
  );

  it.each(supportedCurrencies)(
    "should accept supported toCurrency %s",
    async (toCurrency) => {
      const result = await calculateConversion({
        fromCurrency: "USD",
        toCurrency,
        amount: new Decimal(100),
        rollingDailyConversionUsd: new Decimal(1000),
      });

      expect(result.ok).toBe(true);
    },
  );
});

describe("7.3 Rate Caching", () => {
  beforeEach(() => {
    clearCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearCache();
  });

  it("should call the external API when there is no cached rate", async () => {
    // Arrange
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: MOCK_RATES }),
    });
    vi.stubGlobal("fetch", mockFetch);

    // Act
    await fetchRates(new Date());

    // Assert
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("should not call the external API when a fresh cache entry exists", async () => {
    // Arrange — seed the cache, then call 30 min later (within 60-min TTL)
    const seedTime = new Date("2026-01-01T10:00:00Z");
    setCachedRates({ USD: 1, EUR: 0.9 }, seedTime);

    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    // Act
    const result = await fetchRates(new Date("2026-01-01T10:30:00Z"));

    // Assert
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.stale).toBe(false);
  });

  it("should call the external API when the cache is stale (past 60-min TTL)", async () => {
    // Arrange — seed the cache, then call 61 min later (past TTL)
    const seedTime = new Date("2026-01-01T10:00:00Z");
    setCachedRates({ USD: 1, EUR: 0.9 }, seedTime);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: MOCK_RATES }),
    });
    vi.stubGlobal("fetch", mockFetch);

    // Act
    await fetchRates(new Date("2026-01-01T11:01:00Z"));

    // Assert
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("should return stale rates when the API fails and the cache is expired", async () => {
    // Arrange — seed the cache, let it expire, then break the API
    const seedTime = new Date("2026-01-01T10:00:00Z");
    setCachedRates({ USD: 1, EUR: 0.9 }, seedTime);
    mockFetchFailure();

    // Act — call 61 min later
    const result = await fetchRates(new Date("2026-01-01T11:01:00Z"));

    // Assert
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.stale).toBe(true);
      expect(result.value.cachedAt).toEqual(seedTime);
    }
  });

  it("should return EXCHANGE_RATE_UNAVAILABLE when the API fails and there is no cache", async () => {
    // Arrange
    mockFetchFailure();

    // Act
    const result = await fetchRates(new Date());

    // Assert — ExternalServiceError always uses code 'EXTERNAL_SERVICE_ERROR'
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe("EXTERNAL_SERVICE_ERROR");
    }
  });
});

describe("7.4 Conversion Fee Schedule", () => {
  beforeEach(() => {
    clearCache();
    mockFetchSuccess();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearCache();
  });

  it.each([
    ["1.00", "0.50"],      // minimum fee floor
    ["10.00", "0.50"],     // EP value in 1.00–19.99
    ["19.99", "0.50"],     // upper edge of first partition
    ["20.00", "0.50"],     // lower edge of 2.50% tier, still min fee
    ["20.01", "0.50"],     // just above boundary, still min fee
    ["500.00", "12.50"],   // EP value in 20.00–999.99
    ["999.98", "25.00"],   // just below upper edge, rounds to 25.00
    ["999.99", "25.00"],   // upper edge of 2.50% tier
    ["1000.00", "17.50"],  // lower edge of 1.75% tier
    ["1000.01", "17.50"],  // just above boundary
    ["5000.00", "87.50"],  // EP value in 1,000.00–9,999.99
    ["9999.98", "175.00"], // just below upper edge, rounds to 175.00
    ["9999.99", "175.00"], // upper edge of 1.75% tier
    ["10000.00", "100.00"],// lower edge of 1.00% tier
    ["10000.01", "100.00"],// just above boundary
    ["15000.00", "150.00"],// EP value in 10,000.00–25,000.00
    ["24999.99", "250.00"],// just below max, rounds to 250.00
    ["25000.00", "250.00"],// max allowed conversion amount
  ])("should apply correct fee for conversion amount %s", async (amount, expectedFee) => {
    const result = await calculateConversion({
      fromCurrency: "USD",
      toCurrency: "EUR",
      amount: new Decimal(amount),
      rollingDailyConversionUsd: new Decimal(0),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.fee.toFixed(2)).toBe(expectedFee);
  });
});

describe("7.5 Conversion Limits", () => {
  beforeEach(() => {
    clearCache();
    mockFetchSuccess();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearCache();
  });

  describe("single-amount valid partition: $1.00 .. $25,000.00", () => {
    it.each<[string, Decimal]>([
      ["BV $1.00 (lower boundary — minimum)",         new Decimal(1)],
      ["BV $1.01 (just above lower boundary)",        new Decimal(1.01)],
      ["BV $24,999.99 (just below upper boundary)",   new Decimal(24999.99)],
      ["BV $25,000.00 (upper boundary — maximum)",    new Decimal(25000)],
    ])("should accept %s", async (_label, amount) => {
      const result = await calculateConversion({
        fromCurrency: "USD",
        toCurrency: "EUR",
        amount,
        rollingDailyConversionUsd: new Decimal(1000),
      });

      expect(result.ok).toBe(true);
    });
  });

  describe("single-amount invalid partitions", () => {
    it.each<[string, Decimal, ErrorCode]>([
      ["BV $0.99 (just below minimum)",         new Decimal(0.99),     ErrorCode.AMOUNT_TOO_LOW],
      ["BV $25,000.01 (just above maximum)",    new Decimal(25000.01), ErrorCode.AMOUNT_TOO_HIGH],
    ])("should reject %s", async (_label, amount, expectedCode) => {
      const result = await calculateConversion({
        fromCurrency: "USD",
        toCurrency: "EUR",
        amount,
        rollingDailyConversionUsd: new Decimal(1000),
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(expectedCode);
      }
    });
  });

  // Daily rolling limit boundary (max daily = $50,000)
  describe("daily rolling limit ($50,000)", () => {
    it.each<[string, Decimal, Decimal]>([
      ["just under: $24,999 + $25,000 rolling = $49,999", new Decimal(24999), new Decimal(25000)],
      ["exactly at: $25,000 + $25,000 rolling = $50,000", new Decimal(25000), new Decimal(25000)],
    ])("should accept conversion %s", async (_label, amount, rollingDailyConversionUsd) => {
      const result = await calculateConversion({
        fromCurrency: "USD",
        toCurrency: "EUR",
        amount,
        rollingDailyConversionUsd,
      });

      expect(result.ok).toBe(true);
    });

    it("should reject conversion that would exceed the daily limit", async () => {
      // $1 + $50,000.01 existing = over $50,000
      const result = await calculateConversion({
        fromCurrency: "USD",
        toCurrency: "EUR",
        amount: new Decimal(1),
        rollingDailyConversionUsd: new Decimal("50000.01"),
      });

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.code).toBe(ErrorCode.DAILY_LIMIT_EXCEEDED);
      }
    });
  });


});
