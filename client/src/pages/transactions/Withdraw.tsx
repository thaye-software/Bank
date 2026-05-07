import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAccounts } from '@/hooks/useAccounts';
import { useWithdraw } from '@/hooks/useTransactions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ApiError } from '@/lib/fetch';

const schema = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a valid amount (e.g. 100.00)'),
});
type FormValues = z.infer<typeof schema>;

export function Withdraw() {
  const { data: accounts } = useAccounts();
  const { mutate, isPending, error, isSuccess, data } = useWithdraw();
  const [accountId, setAccountId] = useState<string>('');
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = (v: FormValues) => {
    if (accountId === '') return;
    mutate({ accountId, amount: v.amount }, { onSuccess: () => reset() });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Withdraw</h1>
      <Card className="max-w-md">
        <CardHeader><CardTitle>Make a Withdrawal</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error !== null && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{(error as ApiError).code ?? error.message}</AlertDescription>
              </Alert>
            )}
            {isSuccess && (
              <Alert role="alert">
                <AlertDescription>Withdrew ${data?.amount.toFixed(2)} successfully.</AlertDescription>
              </Alert>
            )}
            <div className="space-y-1">
              <Label htmlFor="withdrawAccount">Account</Label>
              <Select onValueChange={setAccountId}>
                <SelectTrigger id="withdrawAccount">
                  <SelectValue placeholder="Select account" />
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
              <Label htmlFor="withdrawAmount">Amount</Label>
              <Input id="withdrawAmount" placeholder="100.00" {...register('amount')} />
              {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={isPending || accountId === ''}>
              {isPending ? 'Processing…' : 'Withdraw'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
