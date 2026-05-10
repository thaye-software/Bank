import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import './index.css';

import { AppShell } from './components/layout/AppShell';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { Dashboard } from './pages/Dashboard';
import { Accounts } from './pages/Accounts';
import { KycSubmission } from './pages/kyc/KycSubmission';
import { Deposit } from './pages/transactions/Deposit';
import { Withdraw } from './pages/transactions/Withdraw';
import { Transfer } from './pages/transactions/Transfer';
import { History } from './pages/transactions/History';
import { LoanApplication } from './pages/LoanApplication';
import { LoansHistory } from './pages/LoansHistory';
import { CurrencyConvert } from './pages/CurrencyConvert';
import { Profile } from './pages/Profile';
import { CurrencyCache } from './pages/admin/CurrencyCache';

const queryClient = new QueryClient();

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/register', element: <Register /> },
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <Dashboard /> },
      { path: '/accounts', element: <Accounts /> },
      { path: '/kyc', element: <KycSubmission /> },
      { path: '/transactions/deposit', element: <Deposit /> },
      { path: '/transactions/withdraw', element: <Withdraw /> },
      { path: '/transactions/transfer', element: <Transfer /> },
      { path: '/transactions/history', element: <History /> },
      { path: '/loans', element: <LoanApplication /> },
      { path: '/loans/history', element: <LoansHistory /> },
      { path: '/currency', element: <CurrencyConvert /> },
      { path: '/profile', element: <Profile /> },
      { path: '/admin/currency-cache', element: <CurrencyCache /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);
