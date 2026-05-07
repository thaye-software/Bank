import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAccounts } from '@/hooks/useAccounts';
import { useConvertCurrency } from '@/hooks/useCurrency';
import { SUPPORTED_CURRENCIES, type Currency } from '@/api/currency.api';
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

export function CurrencyConvert() {
  const { data: accounts } = useAccounts();
  const { mutate, isPending, error, isSuccess, data } = useConvertCurrency();
  const [accountId, setAccountId] = useState<string>('');
  const [fromCurrency, setFromCurrency] = useState<Currency>('USD');
  const [toCurrency, setToCurrency] = useState<Currency>('EUR');
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = (v: FormValues) => {
    if (accountId === '') return;
    mutate({ accountId, fromCurrency, toCurrency, amount: v.amount }, { onSuccess: () => reset() });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Currency Convert</h1>
      <Card className="max-w-md">
        <CardHeader><CardTitle>Convert Currency</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error !== null && (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{(error as ApiError).code ?? error.message}</AlertDescription>
              </Alert>
            )}
            {isSuccess && data !== undefined && (
              <Alert role="alert">
                <AlertDescription>
                  <div className="space-y-1 text-sm">
                    <p>Converted <strong>{data.originalAmount} {data.fromCurrency}</strong> → <strong>{data.convertedAmount.toFixed(4)} {data.toCurrency}</strong></p>
                    <p className="text-muted-foreground">Rate: {data.rate} · Fee: ${data.fee.toFixed(2)}</p>
                    {data.stale === true && <p className="text-yellow-500">Using cached exchange rate</p>}
                  </div>
                </AlertDescription>
              </Alert>
            )}
            <div className="space-y-1">
              <Label htmlFor="convertAccount">Account</Label>
              <Select onValueChange={setAccountId}>
                <SelectTrigger id="convertAccount">
                  <SelectValue placeholder="Select account" />
                </SelectTrigger>
                <SelectContent>
                  {(accounts ?? []).map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.type} — ${a.balance.toFixed(2)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="fromCurrency">From</Label>
                <Select value={fromCurrency} onValueChange={(v) => setFromCurrency(v as Currency)}>
                  <SelectTrigger id="fromCurrency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="toCurrency">To</Label>
                <Select value={toCurrency} onValueChange={(v) => setToCurrency(v as Currency)}>
                  <SelectTrigger id="toCurrency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="convertAmount">Amount</Label>
              <Input id="convertAmount" placeholder="100.00" {...register('amount')} />
              {errors.amount && <p className="text-sm text-destructive">{errors.amount.message}</p>}
            </div>
            <Button type="submit" className="w-full" disabled={isPending || accountId === ''}>
              {isPending ? 'Converting…' : 'Convert'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
