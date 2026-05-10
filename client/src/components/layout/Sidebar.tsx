import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Wallet,
  ShieldCheck,
  ArrowDownCircle,
  ArrowUpCircle,
  ArrowLeftRight,
  History as HistoryIcon,
  FileText,
  ClipboardList,
  RefreshCw,
  LogOut,
  User as UserIcon,
  Database,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCurrentUser, useLogout } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { Role } from '@/types/api';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
    isActive
      ? 'bg-accent text-accent-foreground font-medium'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
  );

function roleBadgeVariant(role: Role): 'default' | 'secondary' | 'destructive' {
  if (role === 'ADMIN') return 'destructive';
  if (role === 'STAFF') return 'secondary';
  return 'default';
}

export function Sidebar() {
  const logout = useLogout();
  const { data: user } = useCurrentUser();

  return (
    <aside className="flex h-screen w-56 flex-col bg-slate-900 border-r border-border px-3 py-4">
      <div className="mb-4 px-3">
        <span className="text-lg font-bold text-foreground">NordicBank</span>
      </div>

      {user && (
        <div className="mb-4 px-3">
          <p className="text-sm font-medium text-foreground truncate">{user.fullName}</p>
          <Badge variant={roleBadgeVariant(user.role)} className="mt-1">
            {user.role}
          </Badge>
        </div>
      )}

      <nav className="flex flex-col gap-1 flex-1">
        <NavLink to="/" end className={navLinkClass}>
          <LayoutDashboard className="h-4 w-4" /> Dashboard
        </NavLink>
        <NavLink to="/accounts" className={navLinkClass}>
          <Wallet className="h-4 w-4" /> Accounts
        </NavLink>
        {(user?.kycStatus === 'NOT_STARTED' || user?.kycStatus === 'REJECTED') && (
          <NavLink to="/kyc" className={navLinkClass}>
            <ShieldCheck className="h-4 w-4" /> KYC
          </NavLink>
        )}

        <Separator className="my-2" />

        <p className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Transactions</p>
        <NavLink to="/transactions/deposit" className={navLinkClass}>
          <ArrowDownCircle className="h-4 w-4" /> Deposit
        </NavLink>
        <NavLink to="/transactions/withdraw" className={navLinkClass}>
          <ArrowUpCircle className="h-4 w-4" /> Withdraw
        </NavLink>
        <NavLink to="/transactions/transfer" className={navLinkClass}>
          <ArrowLeftRight className="h-4 w-4" /> Transfer
        </NavLink>
        <NavLink to="/transactions/history" className={navLinkClass}>
          <HistoryIcon className="h-4 w-4" /> History
        </NavLink>

        <Separator className="my-2" />

        <NavLink to="/loans" className={navLinkClass}>
          <FileText className="h-4 w-4" /> Loan Application
        </NavLink>
        <NavLink to="/loans/history" className={navLinkClass}>
          <ClipboardList className="h-4 w-4" /> Loan History
        </NavLink>
        <NavLink to="/currency" className={navLinkClass}>
          <RefreshCw className="h-4 w-4" /> Currency Convert
        </NavLink>

        {user?.role === 'ADMIN' && (
          <>
            <Separator className="my-2" />
            <p className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Admin</p>
            <NavLink to="/admin/currency-cache" className={navLinkClass}>
              <Database className="h-4 w-4" /> Currency Cache
            </NavLink>
          </>
        )}

        <div className="mt-auto pt-4">
          <Separator className="mb-4" />
          <NavLink to="/profile" className={navLinkClass}>
            <UserIcon className="h-4 w-4" /> Profile
          </NavLink>
          <Button variant="ghost" className="mt-1 w-full justify-start gap-2 text-muted-foreground" onClick={logout}>
            <LogOut className="h-4 w-4" /> Logout
          </Button>
        </div>
      </nav>
    </aside>
  );
}
