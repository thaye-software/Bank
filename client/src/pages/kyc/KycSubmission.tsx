import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useKycStatus, useSubmitKyc } from '@/hooks/useKyc';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import type { DocumentType } from '@/types/api';
import type { ApiError } from '@/lib/fetch';

const schema = z.object({
  fullName: z.string().min(1, 'Required'),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  nationalIdNumber: z.string().min(1, 'Required'),
  documentType: z.enum(['PASSPORT', 'NATIONAL_ID', 'DRIVERS_LICENSE'] as const),
  documentImageUrl: z.string().url('Must be a valid URL'),
});
type FormValues = z.infer<typeof schema>;

export function KycSubmission() {
  const { data: kycStatus, isLoading } = useKycStatus();
  const { mutate, isPending, error, isSuccess } = useSubmitKyc();
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { documentType: 'PASSPORT' },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold">KYC Verification</h1>
        {isLoading ? (
          <Skeleton className="h-6 w-24" />
        ) : (
          <Badge variant={kycStatus?.status === 'VERIFIED' ? 'default' : 'secondary'}>
            {kycStatus?.status ?? 'NOT_STARTED'}
          </Badge>
        )}
      </div>

      <Card className="max-w-lg">
        <CardHeader>
          <CardTitle>Submit Identity Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit((v) => mutate(v))} className="space-y-4">
            {error !== null && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{(error as ApiError).code ?? error.message}</AlertDescription>
              </Alert>
            )}
            {isSuccess && (
              <Alert role="alert">
                <AlertDescription>KYC submitted successfully.</AlertDescription>
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
    </div>
  );
}
