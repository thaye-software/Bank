import Decimal from 'decimal.js';

export interface FraudContext {
  readonly recentDebitsLast5Min: number;
  readonly recentDebitsLastHour: number;
  readonly accountAgeInDays: number;
  readonly currentBalance: Decimal;
  readonly nowUtcHour: number;
}

export interface TriggeredSignal {
  readonly name: string;
  readonly points: number;
}

export interface FraudAssessment {
  readonly riskScore: number;
  readonly triggeredSignals: readonly TriggeredSignal[];
  readonly outcome: 'ALLOW' | 'REVIEW_FLAGGED' | 'FRAUD_BLOCKED';
}

const VELOCITY_3_IN_5MIN_THRESHOLD = 3;
const VELOCITY_10_IN_1HR_THRESHOLD = 10;
const LARGE_AMOUNT_THRESHOLD = new Decimal('3000');
const OFFHOURS_AMOUNT_THRESHOLD = new Decimal('1000');
const OFFHOURS_START = 0;
const OFFHOURS_END = 6;
const BALANCE_DRAIN_RATIO = new Decimal('0.9');
const NEW_ACCOUNT_DAYS_THRESHOLD = 30;
const NEW_ACCOUNT_AMOUNT_THRESHOLD = new Decimal('500');
const BLOCK_THRESHOLD = 100;
const REVIEW_THRESHOLD = 60;

export function assessFraud(amount: Decimal, ctx: FraudContext): FraudAssessment {
  const signals: TriggeredSignal[] = [];

  if (ctx.recentDebitsLast5Min >= VELOCITY_3_IN_5MIN_THRESHOLD) {
    signals.push({ name: 'VELOCITY_3_IN_5MIN', points: 40 });
  }
  if (ctx.recentDebitsLastHour >= VELOCITY_10_IN_1HR_THRESHOLD) {
    signals.push({ name: 'VELOCITY_10_IN_1HR', points: 30 });
  }
  if (amount.greaterThan(LARGE_AMOUNT_THRESHOLD)) {
    signals.push({ name: 'LARGE_AMOUNT_SINGLE', points: 35 });
  }
  if (amount.mod(1).equals(0)) {
    signals.push({ name: 'ROUND_AMOUNT', points: 10 });
  }
  if (
    amount.greaterThan(OFFHOURS_AMOUNT_THRESHOLD) &&
    ctx.nowUtcHour >= OFFHOURS_START &&
    ctx.nowUtcHour < OFFHOURS_END
  ) {
    signals.push({ name: 'OFFHOURS_LARGE', points: 25 });
  }
  if (
    ctx.currentBalance.greaterThan(0) &&
    amount.div(ctx.currentBalance).greaterThan(BALANCE_DRAIN_RATIO)
  ) {
    signals.push({ name: 'RAPID_BALANCE_DRAIN', points: 50 });
  }
  if (
    ctx.accountAgeInDays < NEW_ACCOUNT_DAYS_THRESHOLD &&
    amount.greaterThan(NEW_ACCOUNT_AMOUNT_THRESHOLD)
  ) {
    signals.push({ name: 'NEW_ACCOUNT_LARGE', points: 45 });
  }

  // Geographic anomaly — stub for v1, always 0 points
  const geographicPoints = assessGeographicAnomaly();
  if (geographicPoints > 0) {
    signals.push({ name: 'GEOGRAPHIC_ANOMALY', points: geographicPoints });
  }

  const riskScore = signals.reduce((sum, s) => sum + s.points, 0);

  let outcome: FraudAssessment['outcome'];
  if (riskScore >= BLOCK_THRESHOLD) {
    outcome = 'FRAUD_BLOCKED';
  } else if (riskScore >= REVIEW_THRESHOLD) {
    outcome = 'REVIEW_FLAGGED';
  } else {
    outcome = 'ALLOW';
  }

  return { riskScore, triggeredSignals: signals, outcome };
}

// Stub — always returns 0. Signature reserved for v2 implementation.
export function assessGeographicAnomaly(): number {
  return 0;
}
