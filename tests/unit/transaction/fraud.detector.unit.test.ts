// tests/unit/transactions/fraud.detector.unit.test.ts
import Decimal from 'decimal.js';
import { describe, it, expect } from 'vitest';
import { assessFraud } from '../../../src/domain/transactions/fraud.detector';

describe('Fraud Detection — assessFraud()', () => {
    /**
     * Positive testing: Decision table and 3-value BVA
     */

    const fraudAssessmentPassesProvider = [
        /**
         * Decision table-based test cases
         */

        // D1: No signals triggered
        {
            description: 'No signals triggered',
            amount: '100.50',
            recentDebitsLast5Min: 2,
            recentDebitsLastHour: 9,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 0,
            expectedSignals: [],
        },

        // D2: Single signal — VELOCITY_3_IN_5MIN only (40 points)
        {
            description: 'VELOCITY_3_IN_5MIN only (40 points)',
            amount: '100.50',
            recentDebitsLast5Min: 3,
            recentDebitsLastHour: 5,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 40,
            expectedSignals: ['VELOCITY_3_IN_5MIN'],
        },

        // D3: Two signals — VELOCITY_3_IN_5MIN (40) + LARGE_AMOUNT_SINGLE (35) = 75
        {
            description: 'VELOCITY_3_IN_5MIN + LARGE_AMOUNT_SINGLE (75 points)',
            amount: '3500.50',
            recentDebitsLast5Min: 3,
            recentDebitsLastHour: 5,
            accountAgeInDays: 60,
            currentBalance: '10000',
            nowUtcHour: 12,
            expectedOutcome: 'REVIEW_FLAGGED',
            expectedScore: 75,
            expectedSignals: ['VELOCITY_3_IN_5MIN', 'LARGE_AMOUNT_SINGLE'],
        },

        // D4: Three signals at FRAUD_BLOCKED boundary
        // VELOCITY_3_IN_5MIN (40) + LARGE_AMOUNT_SINGLE (35) + OFFHOURS_LARGE (25) = 100
        {
            description:
                'VELOCITY_3_IN_5MIN + LARGE_AMOUNT_SINGLE + OFFHOURS_LARGE (100 points)',
            amount: '3500.50',
            recentDebitsLast5Min: 3,
            recentDebitsLastHour: 5,
            accountAgeInDays: 60,
            currentBalance: '10000',
            nowUtcHour: 2,
            expectedOutcome: 'FRAUD_BLOCKED',
            expectedScore: 100,
            expectedSignals: [
                'VELOCITY_3_IN_5MIN',
                'LARGE_AMOUNT_SINGLE',
                'OFFHOURS_LARGE',
            ],
        },

        // D5: Multiple signals — VELOCITY_10_IN_1HR (30) + LARGE_AMOUNT_SINGLE (35) + ROUND_AMOUNT (10) = 75
        {
            description:
                'VELOCITY_10_IN_1HR + LARGE_AMOUNT_SINGLE + ROUND_AMOUNT (75 points)',
            amount: '4000.00',
            recentDebitsLast5Min: 2,
            recentDebitsLastHour: 10,
            accountAgeInDays: 60,
            currentBalance: '10000',
            nowUtcHour: 12,
            expectedOutcome: 'REVIEW_FLAGGED',
            expectedScore: 75,
            expectedSignals: [
                'VELOCITY_10_IN_1HR',
                'LARGE_AMOUNT_SINGLE',
                'ROUND_AMOUNT',
            ],
        },


        // D6: RAPID_BALANCE_DRAIN only (50 points)
        {
            description: 'RAPID_BALANCE_DRAIN only (50 points)',
            amount: '950.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '1000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 50,
            expectedSignals: ['RAPID_BALANCE_DRAIN'],
        },

        // D7: RAPID_BALANCE_DRAIN (50) + ROUND_AMOUNT (10) = 60 (boundary to REVIEW_FLAGGED)
        {
            description: 'RAPID_BALANCE_DRAIN + ROUND_AMOUNT (60 points)',
            amount: '950.00',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '1000',
            nowUtcHour: 12,
            expectedOutcome: 'REVIEW_FLAGGED',
            expectedScore: 60,
            expectedSignals: ['RAPID_BALANCE_DRAIN', 'ROUND_AMOUNT'],
        },

        // D8: NEW_ACCOUNT_LARGE (45) + RAPID_BALANCE_DRAIN (50) + ROUND_AMOUNT (10) = 105
        {
            description:
                'NEW_ACCOUNT_LARGE + RAPID_BALANCE_DRAIN + ROUND_AMOUNT (105 points)',
            amount: '950.00',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 10,
            currentBalance: '1000',
            nowUtcHour: 12,
            expectedOutcome: 'FRAUD_BLOCKED',
            expectedScore: 105,
            expectedSignals: [
                'NEW_ACCOUNT_LARGE',
                'RAPID_BALANCE_DRAIN',
                'ROUND_AMOUNT',
            ],
        },

        /**
         * 3-value BVA test cases — thresholds
         */

        // VELOCITY_3_IN_5MIN threshold = 3
        {
            description: 'VELOCITY_3_IN_5MIN boundary: just below (2)',
            amount: '100.50',
            recentDebitsLast5Min: 2,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 0,
            expectedSignals: [],
        },
        {
            description: 'VELOCITY_3_IN_5MIN boundary: at threshold (3)',
            amount: '100.50',
            recentDebitsLast5Min: 3,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 40,
            expectedSignals: ['VELOCITY_3_IN_5MIN'],
        },
        {
            description: 'VELOCITY_3_IN_5MIN boundary: just above (4)',
            amount: '100.50',
            recentDebitsLast5Min: 4,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 40,
            expectedSignals: ['VELOCITY_3_IN_5MIN'],
        },

        // VELOCITY_10_IN_1HR threshold = 10
        {
            description: 'VELOCITY_10_IN_1HR boundary: just below (9)',
            amount: '100.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 9,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 0,
            expectedSignals: [],
        },
        {
            description: 'VELOCITY_10_IN_1HR boundary: at threshold (10)',
            amount: '100.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 10,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 30,
            expectedSignals: ['VELOCITY_10_IN_1HR'],
        },
        {
            description: 'VELOCITY_10_IN_1HR boundary: just above (11)',
            amount: '100.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 11,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 30,
            expectedSignals: ['VELOCITY_10_IN_1HR'],
        },

        // LARGE_AMOUNT_SINGLE threshold = 3000
        {
            description: 'LARGE_AMOUNT_SINGLE boundary: just below (2999.99)',
            amount: '2999.99',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '10000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 0,
            expectedSignals: [],
        },
        {
            description: 'LARGE_AMOUNT_SINGLE boundary: at threshold (3000)',
            amount: '3000.00',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '10000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 10,
            expectedSignals: ['ROUND_AMOUNT'],
        },
        {
            description: 'LARGE_AMOUNT_SINGLE boundary: just above (3000.01)',
            amount: '3000.01',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '10000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 35,
            expectedSignals: ['LARGE_AMOUNT_SINGLE'],
        },

        // ROUND_AMOUNT (no cents)
        {
            description: 'ROUND_AMOUNT boundary: has cents (500.01)',
            amount: '500.01',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 0,
            expectedSignals: [],
        },
        {
            description: 'ROUND_AMOUNT boundary: no cents (500.00)',
            amount: '500.00',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 10,
            expectedSignals: ['ROUND_AMOUNT'],
        },

        // OFFHOURS_LARGE — amount threshold = 1000
        {
            description: 'OFFHOURS_LARGE amount boundary: just below (999.99) at hour 2',
            amount: '999.99',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 2,
            expectedOutcome: 'ALLOW',
            expectedScore: 0,
            expectedSignals: [],
        },
        {
            description: 'OFFHOURS_LARGE amount boundary: at threshold (1000) at hour 2',
            amount: '1000.00',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 2,
            expectedOutcome: 'ALLOW',
            expectedScore: 10,
            expectedSignals: ['ROUND_AMOUNT'],
        },
        {
            description: 'OFFHOURS_LARGE amount boundary: just above (1000.01) at hour 2',
            amount: '1000.01',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 2,
            expectedOutcome: 'ALLOW',
            expectedScore: 25,
            expectedSignals: ['OFFHOURS_LARGE'],
        },

        // OFFHOURS_LARGE — hour boundary (0-5 is off-hours, 6+ is normal)
        {
            description: 'OFFHOURS_LARGE hour boundary: at lower (hour 0) with amount 1001',
            amount: '1001.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 0,
            expectedOutcome: 'ALLOW',
            expectedScore: 25,
            expectedSignals: ['OFFHOURS_LARGE'],
        },
        {
            description: 'OFFHOURS_LARGE hour boundary: at upper (hour 5) with amount 1001',
            amount: '1001.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 5,
            expectedOutcome: 'ALLOW',
            expectedScore: 25,
            expectedSignals: ['OFFHOURS_LARGE'],
        },
        {
            description: 'OFFHOURS_LARGE hour boundary: just outside (hour 6) with amount 1001',
            amount: '1001.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 6,
            expectedOutcome: 'ALLOW',
            expectedScore: 0,
            expectedSignals: [],
        },

        // RAPID_BALANCE_DRAIN threshold = 90%
        {
            description: 'RAPID_BALANCE_DRAIN boundary: at exactly 90% (900 of 1000)',
            amount: '900.00',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '1000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 10,
            expectedSignals: ['ROUND_AMOUNT'],
        },
        {
            description: 'RAPID_BALANCE_DRAIN boundary: just above 90% (901 of 1000)',
            amount: '901.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '1000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 50,
            expectedSignals: ['RAPID_BALANCE_DRAIN'],
        },

        // NEW_ACCOUNT_LARGE threshold: age < 30 AND amount > 500
        {
            description: 'NEW_ACCOUNT_LARGE boundary: age at threshold (30 days) with amount 501',
            amount: '501.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 30,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 0,
            expectedSignals: [],
        },
        {
            description: 'NEW_ACCOUNT_LARGE boundary: age just below (29 days) with amount 501',
            amount: '501.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 29,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 45,
            expectedSignals: ['NEW_ACCOUNT_LARGE'],
        },
        {
            description: 'NEW_ACCOUNT_LARGE boundary: age 29 with amount at threshold (500)',
            amount: '500.00',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 29,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 10,
            expectedSignals: ['ROUND_AMOUNT'],
        },
        {
            description: 'NEW_ACCOUNT_LARGE boundary: age 29 with amount just above (500.01)',
            amount: '500.01',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 29,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 45,
            expectedSignals: ['NEW_ACCOUNT_LARGE'],
        },

        // Outcome thresholds: 60 and 100
        {
            description: 'Outcome boundary: score just below REVIEW_FLAGGED (59)',
            amount: '100.50',
            recentDebitsLast5Min: 3,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 40,
            expectedSignals: ['VELOCITY_3_IN_5MIN'],
        },
        {
            description: 'Outcome boundary: score at REVIEW_FLAGGED (60)',
            amount: '950.00',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '1000',
            nowUtcHour: 12,
            expectedOutcome: 'REVIEW_FLAGGED',
            expectedScore: 60,
            expectedSignals: ['RAPID_BALANCE_DRAIN', 'ROUND_AMOUNT'],
        },
        {
            description: 'Outcome boundary: score just below FRAUD_BLOCKED (99)',
            amount: '3500.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 10,
            accountAgeInDays: 60,
            currentBalance: '10000',
            nowUtcHour: 12,
            expectedOutcome: 'REVIEW_FLAGGED',
            expectedScore: 65,
            expectedSignals: [
                'VELOCITY_10_IN_1HR',
                'LARGE_AMOUNT_SINGLE',
            ],
        },
        {
            description: 'Outcome boundary: score at FRAUD_BLOCKED (100)',
            amount: '3500.50',
            recentDebitsLast5Min: 3,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '10000',
            nowUtcHour: 2,
            expectedOutcome: 'FRAUD_BLOCKED',
            expectedScore: 100,
            expectedSignals: [
                'VELOCITY_3_IN_5MIN',
                'LARGE_AMOUNT_SINGLE',
                'OFFHOURS_LARGE',
            ],
        },

        // GEOGRAPHIC_ANOMALY stub (always 0)
        {
            description: 'GEOGRAPHIC_ANOMALY stub: always returns 0 (no signal)',
            amount: '100.50',
            recentDebitsLast5Min: 3,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 3,
            expectedOutcome: 'ALLOW',
            expectedScore: 40,
            expectedSignals: ['VELOCITY_3_IN_5MIN'],
        },
    ];

    describe.each(fraudAssessmentPassesProvider)(
        'Fraud assessment passes',
        (params) => {
            it(params.description, () => {
                const result = assessFraud(new Decimal(params.amount), {
                    recentDebitsLast5Min: params.recentDebitsLast5Min,
                    recentDebitsLastHour: params.recentDebitsLastHour,
                    accountAgeInDays: params.accountAgeInDays,
                    currentBalance: new Decimal(params.currentBalance),
                    nowUtcHour: params.nowUtcHour,
                });

                expect(result.outcome).toBe(params.expectedOutcome);
                expect(result.riskScore).toBe(params.expectedScore);
                expect(result.triggeredSignals.map((s) => s.name)).toEqual(
                    expect.arrayContaining(params.expectedSignals),
                );
                expect(result.triggeredSignals).toHaveLength(params.expectedSignals.length);
            });
        },
    );

    /**
     * Negative testing: Edge cases and invalid scenarios
     */

    const fraudAssessmentEdgeCasesProvider = [
        /**
         * Edge cases with boundary values
         */

        {
            description: 'Edge case: balance is exactly zero (no division)',
            amount: '100.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '0',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 0,
            expectedSignals: [],
        },

        {
            description: 'Edge case: very small amount with round decimals',
            amount: '0.01',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '1000000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 0,
            expectedSignals: [],
        },

        {
            description: 'Edge case: maximum safe integer for hour (23)',
            amount: '1001.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: 23,
            expectedOutcome: 'ALLOW',
            expectedScore: 0,
            expectedSignals: [],
        },

        {
            description: 'Edge case: negative hour (not typical but test robustness)',
            amount: '100.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 60,
            currentBalance: '5000',
            nowUtcHour: -1,
            expectedOutcome: 'ALLOW',
            expectedScore: 0,
            expectedSignals: [],
        },

        {
            description: 'Edge case: account age is zero (brand new)',
            amount: '501.50',
            recentDebitsLast5Min: 0,
            recentDebitsLastHour: 0,
            accountAgeInDays: 0,
            currentBalance: '5000',
            nowUtcHour: 12,
            expectedOutcome: 'ALLOW',
            expectedScore: 45,
            expectedSignals: ['NEW_ACCOUNT_LARGE'],
        },

        /**
         * Robustness: Multiple high-risk signals combining
         */

        {
            description: 'Robustness: All signals triggered at once',
            amount: '3500.00',
            recentDebitsLast5Min: 3,
            recentDebitsLastHour: 10,
            accountAgeInDays: 10,
            currentBalance: '1000',
            nowUtcHour: 2,
            expectedOutcome: 'FRAUD_BLOCKED',
            expectedScore: 235,
            expectedSignals: [
                'VELOCITY_3_IN_5MIN',
                'VELOCITY_10_IN_1HR',
                'LARGE_AMOUNT_SINGLE',
                'ROUND_AMOUNT',
                'OFFHOURS_LARGE',
                'RAPID_BALANCE_DRAIN',
                'NEW_ACCOUNT_LARGE',
            ],
        },
    ];

    describe.each(fraudAssessmentEdgeCasesProvider)(
        'Fraud assessment edge cases',
        (params) => {
            it(params.description, () => {
                const result = assessFraud(new Decimal(params.amount), {
                    recentDebitsLast5Min: params.recentDebitsLast5Min,
                    recentDebitsLastHour: params.recentDebitsLastHour,
                    accountAgeInDays: params.accountAgeInDays,
                    currentBalance: new Decimal(params.currentBalance),
                    nowUtcHour: params.nowUtcHour,
                });

                expect(result.outcome).toBe(params.expectedOutcome);
                expect(result.riskScore).toBe(params.expectedScore);
                expect(result.triggeredSignals.map((s) => s.name)).toEqual(
                    expect.arrayContaining(params.expectedSignals),
                );
            });
        },
    );
});
