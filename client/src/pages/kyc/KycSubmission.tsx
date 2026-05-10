import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { useKycStatus, useSubmitKyc } from '@/hooks/useKyc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { DocumentType, KycStatus } from '@/types/api';
import type { ApiError } from '@/lib/fetch';

const REDIRECT_DELAY_MS = 12_000;

const schema = z.object({
  fullName: z.string().min(1, 'Required'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  nationalIdNumber: z.string().min(1, 'Required'),
  documentType: z.enum(['PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE'] as const),
  documentImageUrl: z.string().url('Must be a valid URL'),
});
type FormValues = z.infer<typeof schema>;

function statusBadgeVariant(status: KycStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'VERIFIED') return 'default';
  if (status === 'REJECTED') return 'destructive';
  if (status === 'PENDING_REVIEW') return 'outline';
  return 'secondary';
}

export function KycSubmission() {
  const navigate = useNavigate();
  const { data: kycStatus, isLoading } = useKycStatus();
  const { mutate, isPending, error, isSuccess, data: submissionData } = useSubmitKyc();

  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { documentType: 'PASSPORT' },
  });

  // After a successful submission, redirect the user to their profile
  // so they see the updated status next to their account information.
  useEffect(() => {
    if (!isSuccess) return;
    const timer = setTimeout(() => navigate('/profile'), REDIRECT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isSuccess, navigate]);

  const onSubmit = (v: FormValues) =>
    mutate(v, {
      onSuccess: () => reset({ documentType: 'PASSPORT' }),
    });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">KYC Verification</h1>
        <Skeleton className="h-48 w-full max-w-lg" />
      </div>
    );
  }

  // Immediate post-submit confirmation. Shown based on the mutation result so
  // the user gets feedback even before the /me query refetches.
  if (isSuccess && submissionData) {
    const newStatus = submissionData.status;
    const verified = newStatus === 'VERIFIED';

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">KYC Verification</h1>
          <Badge variant={statusBadgeVariant(newStatus)}>{newStatus}</Badge>
        </div>

        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>{verified ? 'Identity verified' : 'Submission received'}</CardTitle>
            <CardDescription>
              {verified
                ? 'Your identity has been confirmed. Your accounts are now active and ready to use.'
                : 'Your documents have been submitted. Our compliance team will review them shortly. Existing accounts will remain in PENDING_KYC until verification completes.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Alert role="status">
              <AlertDescription>Redirecting to your profile…</AlertDescription>
            </Alert>
            <Button asChild variant="ghost" className="w-full">
              <Link to="/profile">Go to profile now</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const status: KycStatus = kycStatus?.status ?? 'NOT_STARTED';
  const canSubmit = status === 'NOT_STARTED' || status === 'REJECTED';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">KYC Verification</h1>
        <Badge variant={statusBadgeVariant(status)}>{status}</Badge>
      </div>

      {status === 'VERIFIED' && (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>You're verified</CardTitle>
            <CardDescription>
              Your identity has been confirmed. Any new accounts you open will be active immediately.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="ghost">
              <Link to="/">Go to Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {status === 'PENDING_REVIEW' && (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Submission under review</CardTitle>
            <CardDescription>
              Our compliance team is reviewing your documents. You'll be notified once a decision is made.
              Your existing accounts remain in <code>PENDING_KYC</code> until verification completes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="ghost">
              <Link to="/profile">View profile</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {canSubmit && (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Submit Identity Documents</CardTitle>
            {status === 'REJECTED' && (
              <CardDescription className="text-destructive">
                Your previous submission was rejected. Please review your documents and try again.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {error !== null && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{(error as ApiError).code ?? error.message}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-1">
                <Label htmlFor="fullName">Full name</Label>
                <Input id="fullName" {...register('fullName')} />
                {errors.fullName && <p className="text-sm text-destructive">{errors.fullName.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="dateOfBirth">Date of birth</Label>
                <Input id="dateOfBirth" type="date" {...register('dateOfBirth')} />
                {errors.dateOfBirth && <p className="text-sm text-destructive">{errors.dateOfBirth.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="nationalIdNumber">National ID number</Label>
                <Input id="nationalIdNumber" {...register('nationalIdNumber')} />
                {errors.nationalIdNumber && <p className="text-sm text-destructive">{errors.nationalIdNumber.message}</p>}
              </div>
              <div className="space-y-1">
                <Label htmlFor="documentType">Document type</Label>
                <Select defaultValue="PASSPORT" onValueChange={(v) => setValue('documentType', v as DocumentType)}>
                  <SelectTrigger id="documentType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PASSPORT">Passport</SelectItem>
                    <SelectItem value="NATIONAL_ID">National ID</SelectItem>
                    <SelectItem value="DRIVERS_LICENSE">Driver's License</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="documentImageUrl">Document image URL</Label>
                <Input id="documentImageUrl" type="url" {...register('documentImageUrl')} />
                {errors.documentImageUrl && <p className="text-sm text-destructive">{errors.documentImageUrl.message}</p>}
              </div>
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? 'Submitting…' : 'Submit KYC'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
