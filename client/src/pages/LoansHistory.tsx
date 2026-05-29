import { useLoans } from '@/hooks/useLoans';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ApiError } from '@/lib/fetch';

function formatPercent(value: number | undefined): string {
  if (value === undefined) return '—';
  return `${(value * 100).toFixed(2)}%`;
}

function formatMoney(value: number | undefined): string {
  if (value === undefined) return '—';
  return `$${value.toFixed(2)}`;
}

export function LoansHistory() {
  const { data, isLoading, error } = useLoans();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Loan History</h1>

      {error !== null && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{(error as ApiError).code ?? error.message}</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Past Applications</CardTitle>
          </CardHeader>
          <CardContent>
            {(data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No loan applications yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Decision</TableHead>
                    <TableHead>Approved Amount</TableHead>
                    <TableHead>APR</TableHead>
                    <TableHead>Monthly Payment</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(data ?? []).map((loan) => (
                    <TableRow key={loan.id}>
                      <TableCell className="text-muted-foreground text-sm">
                        {new Date(loan.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell>
                        <Badge variant={loan.decision === 'APPROVED' ? 'default' : 'destructive'}>
                          {loan.decision}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatMoney(loan.approvedAmount)}</TableCell>
                      <TableCell>{formatPercent(loan.apr)}</TableCell>
                      <TableCell>{formatMoney(loan.monthlyPayment)}</TableCell>
                      <TableCell>
                        {loan.decision === 'REJECTED' ? (
                          <span className="text-sm text-muted-foreground">{loan.rejectionCode}</span>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
