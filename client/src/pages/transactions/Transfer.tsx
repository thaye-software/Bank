import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAccounts } from '@/hooks/useAccounts';
import { useTransfer } from '@/hooks/useTransactions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ApiError } from '@/lib/fetch';

const schema = z.object({
  destinationAccountId: z.string().uuid('Must be a valid account ID'),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount (e.g. 100.00)'),
});
type FormValues = z.infer<typeof schema>;

export function Transfer() {
  const { data: accounts } = useAccounts();
  const { mutate, isPending, error, isSuccess, data } = useTransfer();
  const [sourceAccountId, setSourceAccountId] = useState<string>('');
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = (v: FormValues) => {
    if (sourceAccountId === '') return;
    mutate(
      { sourceAccountId, destinationAccountId: v.destinationAccountId, amount: v.amount },
      { onSuccess: () => reset() },
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Transfer</h1>
      <Card className="max-w-md">
        <CardHeader><CardTitle>Transfer Funds</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error !== null && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{(error as ApiError).code ?? error.message}</AlertDescription>
              </Alert>
            )}
            {isSuccess && (
              <Alert role="alert">
                <AlertDescription>
                  Transferred ${data?.amount.toFixed(2)} — status: {data?.status}
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-1">
              <Label htmlFor="sourceAccount">From account</Label>
              <Select onValueChange={setSourceAccountId}>
                <SelectTrigger id="sourceAccount">
                  <SelectValue placeholder="Select source account" />
                </SelectTrigger>
                <SelectContent>
                  {(accounts ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.type} — ${a.balance.toFixed(2)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="destinationAccountId">Destination account ID</Label>
              <Input id="destinationAccountId" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" {...register('destinationAccountId')} />
              {errors.destinationAccountId && (
                <p className="text-sm text-destructive">{errors.destinationAccountId.message}</p>
              )}
            </div>
            <div className="space-y-1">
              <Label htmlFor="transferAmount">Amount</Label>
              <Input id="transferAmount" placeholder="100.00" {...register('amount')} />
              {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={isPending || sourceAccountId === ''}>
              {isPending ? 'Processing…' : 'Transfer'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
