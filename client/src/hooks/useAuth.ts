import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getCurrentUser, login, register } from '@/api/auth.api';
import { setToken, clearToken, getToken } from '@/lib/auth';

export function useLogin() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => login(email, password),
    onSuccess: (data) => {
      setToken(data.token);
      void queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      navigate('/');
    },
  });
}

export function useRegister() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fullName, email, password }: { fullName: string; email: string; password: string }) =>
      register(fullName, email, password),
    onSuccess: (data) => {
      setToken(data.token);
      void queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      navigate('/');
    },
  });
}

export function useLogout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  return () => {
    clearToken();
    queryClient.removeQueries({ queryKey: ['currentUser'] });
    navigate('/login');
  };
}

export function useCurrentUser() {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: getCurrentUser,
    enabled: getToken() !== null,
    staleTime: 5 * 60 * 1000,
  });
}
