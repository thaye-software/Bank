import { useCurrentUser, useLogout } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import type { ApiError } from '@/lib/fetch';
import type { KycStatus, Role } from '@/types/api';

function roleBadgeVariant(role: Role): 'default' | 'secondary' | 'destructive' {
  if (role === 'ADMIN') return 'destructive';
  if (role === 'STAFF') return 'secondary';
  return 'default';
}

function kycBadgeVariant(status: KycStatus): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'VERIFIED') return 'default';
  if (status === 'REJECTED') return 'destructive';
  if (status === 'PENDING_REVIEW') return 'outline';
  return 'secondary';
}

export function Profile() {
  const { data: user, isLoading, error } = useCurrentUser();
  const logout = useLogout();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Profile</h1>

      {error !== null && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{(error as ApiError).code ?? error.message}</AlertDescription>
        </Alert>
      )}

      {isLoading || !user ? (
        <Skeleton className="h-48 w-full max-w-xl" />
      ) : (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle className="text-2xl">{user.fullName}</CardTitle>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Role</p>
                <Badge variant={roleBadgeVariant(user.role)} className="mt-1">
                  {user.role}
                </Badge>
              </div>
              <div>
                <p className="text-muted-foreground">KYC status</p>
                <Badge variant={kycBadgeVariant(user.kycStatus)} className="mt-1">
                  {user.kycStatus}
                </Badge>
              </div>
            </div>

            <Button variant="ghost" className="w-full" onClick={logout}>
              Log out
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
