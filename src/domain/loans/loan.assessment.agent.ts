import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { logger } from '../../config/logger';
import { env } from '../../config/env';
import type { LoanApplicationInput } from './loan.eligibility';

export const AssessmentSchema = z.object({
  riskLevel: z.enum(['LOW', 'MODERATE', 'HIGH']),
  summary: z.string().min(1),
  watchPoints: z.array(z.string()),
});

export type AssessmentResult = z.infer<typeof AssessmentSchema>;

const SYSTEM_PROMPT = `You are a senior loan risk analyst at NordicBank. You receive structured loan application data and produce a concise risk assessment.

Always respond with valid JSON matching exactly this schema:
{
  "riskLevel": "LOW" | "MODERATE" | "HIGH",
  "summary": "<2-3 sentence narrative assessment>",
  "watchPoints": ["<specific concern 1>", "<specific concern 2>"]
}

Guidelines:
- LOW: strong credit, stable employment, comfortable DTI
- MODERATE: acceptable credit with minor concerns, self-employed, or borderline DTI
- HIGH: near-minimum credit score, high DTI, short employment history, or large loan relative to income
- watchPoints should be actionable, specific concerns (empty array is valid for LOW risk)
- Respond ONLY with the JSON object, no markdown, no explanation`;

export function buildUserPrompt(input: LoanApplicationInput): string {
  const monthlyIncome = (input.annualIncome / 12).toFixed(2);
  const dti = ((input.monthlyDebt / (input.annualIncome / 12)) * 100).toFixed(1);

  return JSON.stringify({
    creditScore: input.creditScore,
    employmentStatus: input.employmentStatus,
    annualIncome: input.annualIncome,
    monthlyIncome,
    existingMonthlyDebt: input.monthlyDebt,
    debtToIncomeRatio: `${dti}%`,
    requestedAmount: input.requestedAmount,
    requestedTermMonths: input.requestedTermMonths,
    applicantAge: input.applicantAge,
  });
}

export function parseAssessmentResponse(raw: string): AssessmentResult | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = AssessmentSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export async function runLoanAssessment(
  input: LoanApplicationInput,
  client?: Pick<Anthropic, 'messages'>,
): Promise<AssessmentResult | null> {
  const { anthropic } = await import('../../config/anthropic');
  const apiClient = client ?? anthropic;

  try {
    const response = await apiClient.messages.create({
      model: env.ASSESSMENT_MODEL,
      max_tokens: 512,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // @ts-expect-error — cache_control is supported at runtime but not yet in all SDK type versions
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: buildUserPrompt(input) }],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      logger.warn('Loan assessment agent returned no text content');
      return null;
    }

    const result = parseAssessmentResponse(textBlock.text);
    if (result === null) {
      logger.warn({ raw: textBlock.text }, 'Loan assessment agent returned invalid schema');
    }
    return result;
  } catch (error) {
    logger.warn({ error }, 'Loan assessment agent failed — continuing without assessment');
    return null;
  }
}
