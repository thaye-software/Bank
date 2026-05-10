import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAccounts } from '@/hooks/useAccounts';
import { useApplyForLoan } from '@/hooks/useLoans';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { EmploymentStatus } from '@/types/api';
import type { ApiError } from '@/lib/fetch';

const schema = z.object({
  accountId: z.string().uuid('Select an account'),
  requestedAmount: z.coerce.number().positive('Must be positive'),
  requestedTermMonths: z.coerce.number().int(),
  annualIncome: z.coerce.number().positive('Must be positive'),
  monthlyDebt: z.coerce.number().min(0),
  creditScore: z.coerce.number().int().min(300).max(850),
  employmentStatus: z.enum(['EMPLOYED', 'SELF_EMPLOYED', 'UNEMPLOYED', 'RETIRED'] as const),
  applicantAge: z.coerce.number().int().min(0),
});
type FormValues = z.infer<typeof schema>;

function riskBadgeVariant(level: string): 'default' | 'secondary' | 'destructive' {
  if (level === 'HIGH') return 'destructive';
  if (level === 'MODERATE') return 'secondary';
  return 'default';
}

export function LoanApplication() {
  const { data: accounts } = useAccounts();
  const { mutate, isPending, error, isSuccess, data } = useApplyForLoan();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { employmentStatus: 'EMPLOYED', requestedTermMonths: 36 },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Loan Application</h1>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Apply for a Loan</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit((v) => mutate(v))} className="space-y-4">
              {error !== null && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{(error as ApiError).code ?? error.message}</AlertDescription>
                </Alert>
              )}

              <div className="space-y-1">
                <Label htmlFor="loanAccount">Account</Label>
                <Select onValueChange={(v) => setValue('accountId', v)}>
                  <SelectTrigger id="loanAccount">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {(accounts ?? []).map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.type} — ${a.balance.toFixed(2)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.accountId && <p className="text-sm text-destructive">{errors.accountId.message}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="requestedAmount">Requested amount ($)</Label>
                  <Input id="requestedAmount" type="number" {...register('requestedAmount')} />
                  {errors.requestedAmount && <p className="text-sm text-destructive">{errors.requestedAmount.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="requestedTermMonths">Term (months)</Label>
                  <Select defaultValue="36" onValueChange={(v) => setValue('requestedTermMonths', Number(v))}>
                    <SelectTrigger id="requestedTermMonths">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[12, 24, 36, 48, 60].map((t) => (
                        <SelectItem key={t} value={String(t)}>{t} months</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="annualIncome">Annual income ($)</Label>
                  <Input id="annualIncome" type="number" {...register('annualIncome')} />
                  {errors.annualIncome && <p className="text-sm text-destructive">{errors.annualIncome.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="monthlyDebt">Monthly debt ($)</Label>
                  <Input id="monthlyDebt" type="number" {...register('monthlyDebt')} />
                  {errors.monthlyDebt && <p className="text-sm text-destructive">{errors.monthlyDebt.message}</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="creditScore">Credit score</Label>
                  <Input id="creditScore" type="number" {...register('creditScore')} />
                  {errors.creditScore && <p className="text-sm text-destructive">{errors.creditScore.message}</p>}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="applicantAge">Age</Label>
                  <Input id="applicantAge" type="number" {...register('applicantAge')} />
                  {errors.applicantAge && <p className="text-sm text-destructive">{errors.applicantAge.message}</p>}
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="employmentStatus">Employment status</Label>
                <Select defaultValue="EMPLOYED" onValueChange={(v) => setValue('employmentStatus', v as EmploymentStatus)}>
                  <SelectTrigger id="employmentStatus">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="EMPLOYED">Employed</SelectItem>
                    <SelectItem value="SELF_EMPLOYED">Self-employed</SelectItem>
                    <SelectItem value="UNEMPLOYED">Unemployed</SelectItem>
                    <SelectItem value="RETIRED">Retired</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? 'Evaluating…' : 'Submit Application'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {isSuccess && data !== undefined && (
          <Card>
            <CardHeader>
              <CardTitle>Application Result</CardTitle>
              <CardDescription>
                <Badge variant={data.decision === 'APPROVED' ? 'default' : 'destructive'}>
                  {data.decision}
                </Badge>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {data.decision === 'APPROVED' ? (
                <>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-muted-foreground">Approved amount</p><p className="font-semibold">${data.approvedAmount?.toFixed(2)}</p></div>
                    <div><p className="text-muted-foreground">APR</p><p className="font-semibold">{((data.apr ?? 0) * 100).toFixed(2)}%</p></div>
                    <div><p className="text-muted-foreground">Term</p><p className="font-semibold">{data.termMonths} months</p></div>
                    <div><p className="text-muted-foreground">Monthly payment</p><p className="font-semibold">${data.monthlyPayment?.toFixed(2)}</p></div>
                  </div>

                  {data.assessment !== undefined && data.assessment !== null && (
                    <div className="rounded-lg border p-4 space-y-2">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold">AI Risk Assessment</p>
                        <Badge variant={riskBadgeVariant(data.assessment.riskLevel)}>
                          {data.assessment.riskLevel}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{data.assessment.summary}</p>
                      {data.assessment.watchPoints.length > 0 && (
                        <ul className="list-disc pl-4 text-sm text-muted-foreground space-y-1">
                          {data.assessment.watchPoints.map((point, i) => (
                            <li key={i}>{point}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{data.errorCode ?? 'Application rejected'}</AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
