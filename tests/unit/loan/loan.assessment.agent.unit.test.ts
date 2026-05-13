import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  buildUserPrompt,
  parseAssessmentResponse,
  runLoanAssessment,
} from '../../../src/domain/loans/loan.assessment.agent';
import { buildLoanApplication } from '../../helpers/factories';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MockClient = Pick<Anthropic, 'messages'>;

function mockClient(text: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text' as const, text }],
      }),
    },
  };
}

function mockClientError(error: Error) {
  return {
    messages: {
      create: vi.fn().mockRejectedValue(error),
    },
  };
}

function mockClientNoText() {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({ content: [] }),
    },
  };
}

const VALID_JSON = JSON.stringify({
  riskLevel: 'LOW',
  summary: 'Strong credit profile with stable employment history.',
  watchPoints: [],
});

// ---------------------------------------------------------------------------
// buildUserPrompt
// ---------------------------------------------------------------------------

describe('buildUserPrompt', () => {
  it('should return a JSON string containing all required applicant fields', () => {
    const input = buildLoanApplication({
      creditScore: 720,
      annualIncome: 60_000,
      monthlyDebt: 500,
      requestedAmount: 15_000,
      requestedTermMonths: 36,
      applicantAge: 30,
      employmentStatus: 'EMPLOYED',
    });

    const prompt = buildUserPrompt(input);
    const parsed = JSON.parse(prompt) as Record<string, unknown>;

    expect(parsed['creditScore']).toBe(720);
    expect(parsed['employmentStatus']).toBe('EMPLOYED');
    expect(parsed['annualIncome']).toBe(60_000);
    expect(parsed['requestedAmount']).toBe(15_000);
    expect(parsed['requestedTermMonths']).toBe(36);
    expect(parsed['applicantAge']).toBe(30);
    expect(parsed['existingMonthlyDebt']).toBe(500);
  });

  it('should compute monthlyIncome as annualIncome / 12 rounded to 2 decimal places', () => {
    const input = buildLoanApplication({ annualIncome: 60_000 });

    const parsed = JSON.parse(buildUserPrompt(input)) as Record<string, unknown>;

    // 60_000 / 12 = 5_000.00
    expect(parsed['monthlyIncome']).toBe('5000.00');
  });

  it('should compute debtToIncomeRatio as a percentage string', () => {
    // monthlyDebt 500 / monthlyIncome (60_000/12 = 5_000) = 10.0%
    const input = buildLoanApplication({ annualIncome: 60_000, monthlyDebt: 500 });

    const parsed = JSON.parse(buildUserPrompt(input)) as Record<string, unknown>;

    expect(parsed['debtToIncomeRatio']).toBe('10.0%');
  });
});

// ---------------------------------------------------------------------------
// parseAssessmentResponse
// ---------------------------------------------------------------------------

describe('parseAssessmentResponse', () => {
  it('should return a valid AssessmentResult when given well-formed JSON', () => {
    const raw = JSON.stringify({
      riskLevel: 'MODERATE',
      summary: 'Applicant is self-employed with acceptable credit.',
      watchPoints: ['Self-employment income may be volatile'],
    });

    const result = parseAssessmentResponse(raw);

    expect(result).toEqual({
      riskLevel: 'MODERATE',
      summary: 'Applicant is self-employed with acceptable credit.',
      watchPoints: ['Self-employment income may be volatile'],
    });
  });

  it('should accept an empty watchPoints array', () => {
    const raw = JSON.stringify({
      riskLevel: 'LOW',
      summary: 'Excellent profile.',
      watchPoints: [],
    });

    const result = parseAssessmentResponse(raw);

    expect(result).not.toBeNull();
    expect(result?.watchPoints).toHaveLength(0);
  });

  it.each<[string, string]>([
    ['invalid riskLevel',   JSON.stringify({ riskLevel: 'UNKNOWN', summary: 'ok', watchPoints: [] })],
    ['empty summary',       JSON.stringify({ riskLevel: 'LOW', summary: '', watchPoints: [] })],
    ['missing summary',     JSON.stringify({ riskLevel: 'LOW', watchPoints: [] })],
    ['missing watchPoints', JSON.stringify({ riskLevel: 'LOW', summary: 'ok' })],
    ['non-object JSON',     JSON.stringify([1, 2, 3])],
    ['plain string',        '"just a string"'],
    ['invalid JSON',        'not json at all'],
  ])('should return null when given %s', (_label, raw) => {
    const result = parseAssessmentResponse(raw);

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// runLoanAssessment
// ---------------------------------------------------------------------------

describe('runLoanAssessment', () => {
  it('should return a parsed AssessmentResult when the API responds with valid JSON', async () => {
    const input = buildLoanApplication();
    const client = mockClient(VALID_JSON);

    const result = await runLoanAssessment(input, client as unknown as MockClient);

    expect(result).toEqual({
      riskLevel: 'LOW',
      summary: 'Strong credit profile with stable employment history.',
      watchPoints: [],
    });
  });

  it('should call the API with the correct model and user prompt', async () => {
    const input = buildLoanApplication({ creditScore: 750 });
    const client = mockClient(VALID_JSON);

    await runLoanAssessment(input, client as unknown as MockClient);

    const call = client.messages.create.mock.calls[0]![0] as {
      model: string;
      messages: { role: string; content: string }[];
    };
    expect(call.model).toMatch(/haiku/);
    const userPrompt = JSON.parse(call.messages[0]!.content) as Record<string, unknown>;
    expect(userPrompt['creditScore']).toBe(750);
  });

  it('should include the system prompt with cache_control ephemeral', async () => {
    const input = buildLoanApplication();
    const client = mockClient(VALID_JSON);

    await runLoanAssessment(input, client as unknown as MockClient);

    const call = client.messages.create.mock.calls[0]![0] as {
      system: { type: string; text: string; cache_control: { type: string } }[];
    };
    expect(call.system[0]!.type).toBe('text');
    expect(call.system[0]!.cache_control.type).toBe('ephemeral');
    expect(typeof call.system[0]!.text).toBe('string');
  });

  it('should return null when the API throws an error', async () => {
    const input = buildLoanApplication();
    const client = mockClientError(new Error('Service unavailable'));

    const result = await runLoanAssessment(input, client as unknown as MockClient);

    expect(result).toBeNull();
  });

  it('should return null when the API response contains no text block', async () => {
    const input = buildLoanApplication();
    const client = mockClientNoText();

    const result = await runLoanAssessment(input, client as unknown as MockClient);

    expect(result).toBeNull();
  });

  it('should return null when the API response text fails schema validation', async () => {
    const input = buildLoanApplication();
    const client = mockClient(JSON.stringify({ riskLevel: 'BOGUS', summary: 'ok', watchPoints: [] }));

    const result = await runLoanAssessment(input, client as unknown as MockClient);

    expect(result).toBeNull();
  });

  it('should return null when the API response text is not valid JSON', async () => {
    const input = buildLoanApplication();
    const client = mockClient('Sorry, I cannot help with that.');

    const result = await runLoanAssessment(input, client as unknown as MockClient);

    expect(result).toBeNull();
  });
});
