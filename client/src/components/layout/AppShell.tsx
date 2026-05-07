import { Navigate, Outlet } from 'react-router-dom';
import { getToken } from '@/lib/auth';
import { Sidebar } from './Sidebar';

export function AppShell() {
  if (getToken() === null) {
    return <Navigate to="/login" replace />;
  }
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
