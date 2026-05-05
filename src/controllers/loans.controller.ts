import type { Request, Response } from 'express';
import { asyncHandler } from '../middleware/validate.middleware';
import { LoanRepository } from '../repositories/loan.repository';
import { AccountRepository } from '../repositories/account.repository';
import { NotFoundError } from '../shared/errors';
import { evaluateLoanApplication } from '../domain/loans/loan.eligibility';
import { runLoanAssessment } from '../domain/loans/loan.assessment.agent';
import type { LoanApplicationInput } from '../domain/loans/loan.eligibility';
import type { AppDeps } from '../app';

export function makeLoansController(deps: AppDeps) {
  const apply = asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as {
      accountId: string;
      requestedAmount: number;
      requestedTermMonths: number;
      annualIncome: number;
      monthlyDebt: number;
      creditScore: number;
      employmentStatus: LoanApplicationInput['employmentStatus'];
      applicantAge: number;
    };

    const accountRepo = new AccountRepository(deps.db);
    const loanRepo = new LoanRepository(deps.db);
    const userId = req.user!.userId;

    const account = await accountRepo.findById(body.accountId);
    if (!account || account.userId !== userId) throw new NotFoundError('Account', body.accountId);

    const existingLoansCount = await loanRepo.countActiveByUserId(userId);

    const input: LoanApplicationInput = {
      applicantAge: body.applicantAge,
      annualIncome: body.annualIncome,
      monthlyDebt: body.monthlyDebt,
      requestedAmount: body.requestedAmount,
      requestedTermMonths: body.requestedTermMonths,
      creditScore: body.creditScore,
      employmentStatus: body.employmentStatus,
      kycStatus: req.user!.role === 'CUSTOMER' ? account.status === 'ACTIVE' ? 'VERIFIED' : 'NOT_STARTED' : 'VERIFIED',
      existingLoansCount,
    };

    const decisionResult = evaluateLoanApplication(input);
    if (!decisionResult.ok) throw decisionResult.error;
    const decision = decisionResult.value;

    const assessment =
      decision.decision === 'APPROVED' ? await runLoanAssessment(input) : null;

    const record = await loanRepo.create(userId, body.accountId, input, decision, assessment);

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
