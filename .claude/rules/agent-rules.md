---
scope: "src/domain/loans/loan.assessment.agent.ts, src/**/*agent*.ts"
---

# Claude API / Agent Conventions

These rules apply to all code that uses the Anthropic SDK (`@anthropic-ai/sdk`).

---

## 1. SDK Usage

- Import from `@anthropic-ai/sdk` only — never use raw `fetch` to call the Anthropic API.
- The Anthropic client is instantiated once in `src/config/anthropic.ts` and injected via DI. Never call `new Anthropic()` inside domain functions.
- The API key comes from `env.ts` (`ANTHROPIC_API_KEY`) — validated at startup.

```typescript
// src/config/anthropic.ts
import Anthropic from '@anthropic-ai/sdk';
import { env } from './env';

export const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
```

---

## 2. Model Selection

- Use `claude-haiku-4-5-20251001` for the Loan Assessment Agent — structured output, low latency, low cost.
- Do not hardcode the model string in agent files — read it from `env.ts` (`ASSESSMENT_MODEL`) with the haiku model ID as default.

---

## 3. Prompt Caching

The system prompt for the Loan Assessment Agent is long and identical across all calls. Always use prompt caching to avoid re-processing it on every request:

```typescript
const response = await anthropic.messages.create({
  model: env.ASSESSMENT_MODEL,
  max_tokens: 512,
  system: [
    {
      type: 'text',
      text: LOAN_ASSESSMENT_SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' },
    },
  ],
  messages: [{ role: 'user', content: buildUserPrompt(application) }],
});
```

- `LOAN_ASSESSMENT_SYSTEM_PROMPT` is a module-level constant in `loan.assessment.agent.ts`.
- The user prompt is constructed by `buildUserPrompt(application)` — a pure, testable function.

---

## 4. Structured Output

Parse the model response as JSON and validate with Zod. Never trust the raw string:

```typescript
const AssessmentSchema = z.object({
  riskLevel: z.enum(['LOW', 'MODERATE', 'HIGH']),
  summary: z.string().min(1),
  watchPoints: z.array(z.string()),
});

const raw = response.content[0].type === 'text' ? response.content[0].text : '';
const parsed = AssessmentSchema.safeParse(JSON.parse(raw));

if (!parsed.success) {
  logger.warn('Loan assessment agent returned invalid shape', { raw });
  return null;
}
```

---

## 5. Error Handling

- Wrap all Claude API calls in try/catch.
- On failure: log at `warn` level, return `null` assessment — do NOT fail the loan approval.
- On Zod parse failure: same as above — log and return `null`.
- Never let an agent failure propagate to the user as an unhandled error.

---

## 6. Testability Design

The agent module must be structured so every part can be tested independently:

| Function | Test type | Mock? |
|---|---|---|
| `buildUserPrompt(application)` | Unit | No — pure function |
| `parseAssessmentResponse(raw)` | Unit | No — pure function |
| `runLoanAssessment(application)` | Integration (AI) | Real Claude API (gated by `ENABLE_REAL_AI_TESTS=true`) |
| `runLoanAssessment(application)` | Unit | Yes — mock Anthropic client with `vi.fn()` |

```typescript
// Unit test pattern — mock the client, not the whole module
const mockCreate = vi.fn().mockResolvedValue(buildAnthropicResponse({ riskLevel: 'LOW' }));
const agent = createLoanAssessmentAgent({ anthropic: { messages: { create: mockCreate } } });
```

- `buildUserPrompt` and `parseAssessmentResponse` are exported named functions — not embedded in `runLoanAssessment`.
- The Anthropic client is passed in (DI), not imported as a module singleton, so it can be replaced in tests.

---

## 7. Designated AI Integration Tests

A small set of tests in `tests/integration/loan-assessment-agent.integration.test.ts` call the real Claude API. These tests:
- Are skipped unless `ENABLE_REAL_AI_TESTS=true` is set.
- Verify that the real API returns a response that passes the `AssessmentSchema` Zod schema.
- Do NOT assert on the exact text content of the narrative (model output is non-deterministic).
- Assert only on the **shape and types** of the response.

```typescript
it.skipIf(!process.env.ENABLE_REAL_AI_TESTS)('should return a valid assessment shape from real API', async () => {
  const result = await runLoanAssessment(buildLoanApplication({ creditScore: 720 }));
  expect(AssessmentSchema.safeParse(result).success).toBe(true);
});
```

---

## 8. What NOT To Do

- Do not assert on exact model-generated text in tests — it is non-deterministic.
- Do not call the real Claude API in unit tests or standard integration tests.
- Do not use streaming for this agent — the output is small and needs to be fully parsed before responding.
- Do not store raw Claude API responses in the database — store only the parsed, validated `AssessmentResult`.
