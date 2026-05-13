import { useQueries } from '@tanstack/react-query';
import { useAccounts } from '@/hooks/useAccounts';
import { listByAccount } from '@/api/transactions.api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import type { AccountType, Transaction } from '@/types/api';

export function Dashboard() {
  const { data: accounts, isLoading: accountsLoading } = useAccounts();

  const accountList = accounts ?? [];
  const txQueries = useQueries({
    queries: accountList.map((account) => ({
      queryKey: ['transactions', account.id],
      queryFn: () => listByAccount(account.id),
    })),
  });

  const txLoading = txQueries.some((q) => q.isLoading);
  const accountTypeById = new Map<string, AccountType>(accountList.map((a) => [a.id, a.type]));
  const transactions: Transaction[] = txQueries
    .flatMap((q) => q.data ?? [])
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Dashboard</h1>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Accounts</h2>
        {accountsLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {accountList.map((account) => (
              <Card key={account.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{account.type}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">${account.balance.toFixed(2)}</p>
                  <Badge variant={account.status === 'ACTIVE' ? 'default' : 'secondary'} className="mt-1">
                    {account.status}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Recent Transactions</h2>
        {txLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 rounded" />)}
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.slice(0, 10).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between rounded-lg border px-4 py-2">
                <span className="text-sm text-muted-foreground">{tx.type}</span>
                <span className="text-sm font-medium">{accountTypeById.get(tx.accountId) ?? '—'}</span>
                <span className="text-sm font-medium">${tx.amount.toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
