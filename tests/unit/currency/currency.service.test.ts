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

  it("should reject unsupported fromCurrency", async () => {
    const result = await calculateConversion({
      fromCurrency: "XYZ",
      toCurrency: "USD",
      amount: new Decimal(100),
      rollingDailyConversionUsd: new Decimal(1000),
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(ErrorCode.UNSUPPORTED_CURRENCY);
    }
  });

  it("should reject unsupported toCurrency", async () => {
    const result = await calculateConversion({
      fromCurrency: "USD",
      toCurrency: "XYZ",
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

  it("should reject conversion below minimum amount", async () => {
    const result = await calculateConversion({
      fromCurrency: "USD",
      toCurrency: "EUR",
      amount: new Decimal(0.99),
      rollingDailyConversionUsd: new Decimal(1000),
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_LOW);
    }
  });

  it("should accept conversion at minimum amount", async () => {
    const result = await calculateConversion({
      fromCurrency: "USD",
      toCurrency: "EUR",
      amount: new Decimal(1),
      rollingDailyConversionUsd: new Decimal(1000),
    });

    expect(result.ok).toBe(true);
  });

  it("should accept conversion just above minimum single amount", async () => {
    const result = await calculateConversion({
      fromCurrency: "USD",
      toCurrency: "EUR",
      amount: new Decimal(1.01),
      rollingDailyConversionUsd: new Decimal(1000),
    });

    expect(result.ok).toBe(true);
  });

  it("should accept conversion at just below maximum single amount", async () => {
    const result = await calculateConversion({
      fromCurrency: "USD",
      toCurrency: "EUR",
      amount: new Decimal(24999.99),
      rollingDailyConversionUsd: new Decimal(1000),
    });

    expect(result.ok).toBe(true);
  });

  it("should accept conversion at maximum single amount", async () => {
    const result = await calculateConversion({
      fromCurrency: "USD",
      toCurrency: "EUR",
      amount: new Decimal(25000),
      rollingDailyConversionUsd: new Decimal(1000),
    });

    expect(result.ok).toBe(true);
  });

  it("should reject conversion above maximum single amount", async () => {
    const result = await calculateConversion({
      fromCurrency: "USD",
      toCurrency: "EUR",
      amount: new Decimal(25000.01),
      rollingDailyConversionUsd: new Decimal(1000),
    });

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.code).toBe(ErrorCode.AMOUNT_TOO_HIGH);
    }
  });

  // Daily rolling limit boundary (max daily = $50,000)
  it("should accept conversion that keeps rolling total just under daily limit", async () => {
    // $24,999 + $25,000 existing = $49,999 (under $50,000)
    const result = await calculateConversion({
      fromCurrency: "USD",
      toCurrency: "EUR",
      amount: new Decimal(24999),
      rollingDailyConversionUsd: new Decimal(25000),
    });

    expect(result.ok).toBe(true);
  });

  it("should accept conversion that hits the daily limit exactly", async () => {
    // $25,000 + $25,000 existing = $50,000 (at limit)
    const result = await calculateConversion({
      fromCurrency: "USD",
      toCurrency: "EUR",
      amount: new Decimal(25000),
      rollingDailyConversionUsd: new Decimal(25000),
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



