import { useState } from 'react';
import { useAccounts, useCreateAccount } from '@/hooks/useAccounts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { AccountType } from '@/types/api';
import type { ApiError } from '@/lib/fetch';

export function Accounts() {
  const { data: accounts, isLoading } = useAccounts();
  const { mutate: createAccount, isPending, error } = useCreateAccount();
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<AccountType>('CHECKING');

  const handleCreate = () => {
    createAccount(selectedType, { onSuccess: () => setOpen(false) });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Accounts</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>New Account</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Open New Account</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              {error !== null && (
                <Alert variant="destructive" role="alert">
                  <AlertDescription>{(error as ApiError).code ?? error.message}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-1">
                <Label htmlFor="accountType">Account type</Label>
                <Select value={selectedType} onValueChange={(v) => setSelectedType(v as AccountType)}>
                  <SelectTrigger id="accountType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CHECKING">Checking</SelectItem>
                    <SelectItem value="SAVINGS">Savings</SelectItem>
                    <SelectItem value="BUSINESS">Business</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button className="w-full" onClick={handleCreate} disabled={isPending}>
                {isPending ? 'Creating…' : 'Create account'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Your Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Balance</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(accounts ?? []).map((account) => (
                  <TableRow key={account.id}>
                    <TableCell className="font-mono text-xs">{account.id}</TableCell>
                    <TableCell>{account.type}</TableCell>
                    <TableCell>${account.balance.toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={account.status === 'ACTIVE' ? 'default' : 'secondary'}>
                        {account.status}
                      </Badge>
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
