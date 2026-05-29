import type { Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/validate.middleware';
import { LoanRepository } from '../repositories/loan.repository';
import { AccountRepository } from '../repositories/account.repository';
import { NotFoundError, ValidationError } from '../shared/errors';
import { evaluateLoanApplication } from '../domain/loans/loan.eligibility';
import type { LoanApplicationInput } from '../domain/loans/loan.eligibility';
import type { AppDeps } from '../app';


const ApplyLoanSchema = z.object({
  accountId: z.string().min(1, 'accountId is required'),
  requestedAmount: z.number().finite().positive(),
  requestedTermMonths: z.number().int().positive(),
  annualIncome: z.number().finite().nonnegative(),
  monthlyDebt: z.number().finite().nonnegative(),
  creditScore: z.number().int().min(0).max(850),
  employmentStatus: z.enum(['EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'RETIRED']),
  applicantAge: z.number().int().min(0).max(120),
});

type ApplyLoanBody = z.infer<typeof ApplyLoanSchema>;

export function makeLoansController(deps: AppDeps) {
  const apply = asyncHandler(async (req: Request, res: Response) => {
    const parsed = ApplyLoanSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid loan application payload', parsed.error.flatten());
    }
    const body: ApplyLoanBody = parsed.data;

    const accountRepo = new AccountRepository(deps.db);
    const loanRepo = new LoanRepository(deps.db);
    const userId = req.user!.userId;

    const account = await accountRepo.findById(body.accountId);
    if (!account || account.userId !== userId) {
      throw new NotFoundError('Account', body.accountId);
    }

    const existingLoansCount = await loanRepo.countActiveByUserId(userId);

    const input: LoanApplicationInput = {
      applicantAge: body.applicantAge,
      annualIncome: body.annualIncome,
      monthlyDebt: body.monthlyDebt,
      requestedAmount: body.requestedAmount,
      requestedTermMonths: body.requestedTermMonths,
      creditScore: body.creditScore,
      employmentStatus: body.employmentStatus,
      kycStatus:
        req.user!.role === 'CUSTOMER'
          ? account.status === 'ACTIVE'
            ? 'VERIFIED'
            : 'NOT_STARTED'
          : 'VERIFIED',
      existingLoansCount,
    };

    const decisionResult = evaluateLoanApplication(input);
    if (!decisionResult.ok) throw decisionResult.error;
    const decision = decisionResult.value;

    const record = await loanRepo.create(userId, body.accountId, input, decision);

    const status = decision.decision === 'APPROVED' ? 201 : 200;
    res.status(status).json({ success: true, data: record });
  });

  const listByUser = asyncHandler(async (req: Request, res: Response) => {
    const loanRepo = new LoanRepository(deps.db);
    const applications = await loanRepo.findByUserId(req.user!.userId);
    res.json({ success: true, data: applications });
  });

  return { apply, listByUser };
}