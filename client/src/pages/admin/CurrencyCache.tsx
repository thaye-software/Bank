import { useClearCurrencyCache } from '@/hooks/useCurrency';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { ApiError } from '@/lib/fetch';

export function CurrencyCache() {
  const { mutate, isPending, isSuccess, error, reset } = useClearCurrencyCache();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Currency Cache</h1>

      <Card>
        <CardHeader>
          <CardTitle>Clear cached exchange rates</CardTitle>
          <CardDescription>
            Removes all in-memory FX rates so the next conversion fetches fresh data from the upstream
            provider. Use this if rates appear stuck or after a vendor incident.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error !== null && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{(error as ApiError).code ?? error.message}</AlertDescription>
            </Alert>
          )}

          {isSuccess && (
            <Alert role="status">
              <AlertDescription>Exchange rate cache cleared.</AlertDescription>
            </Alert>
          )}

          <Button
            variant="destructive"
            disabled={isPending}
            onClick={() => {
              reset();
              mutate();
            }}
          >
            {isPending ? 'Clearing…' : 'Clear cached exchange rates'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
