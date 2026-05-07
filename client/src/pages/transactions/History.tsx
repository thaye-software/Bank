import { useState } from 'react';
import { useAccounts } from '@/hooks/useAccounts';
import { useTransactionHistory } from '@/hooks/useTransactions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { TransactionStatus } from '@/types/api';

function statusVariant(status: TransactionStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'FRAUD_BLOCKED') return 'destructive';
  if (status === 'REVIEW_FLAGGED') return 'outline';
  if (status === 'PENDING_WEEKEND') return 'secondary';
  return 'default';
}

export function History() {
  const { data: accounts } = useAccounts();
  const [accountId, setAccountId] = useState<string>('');
  const { data: transactions, isLoading } = useTransactionHistory(accountId || undefined);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Transaction History</h1>
      <div className="max-w-xs">
        <Select onValueChange={setAccountId}>
          <SelectTrigger>
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

      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <Card>
          <CardHeader><CardTitle>Transactions</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(transactions ?? []).map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>{tx.type}</TableCell>
                    <TableCell>${tx.amount.toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(tx.status)}>{tx.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(tx.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
