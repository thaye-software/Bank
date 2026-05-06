import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { login, register } from '@/api/auth.api';
import { setToken, clearToken } from '@/lib/auth';

export function useLogin() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => login(email, password),
    onSuccess: (data) => {
      setToken(data.token);
      navigate('/');
    },
  });
}

export function useRegister() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: ({ fullName, email, password }: { fullName: string; email: string; password: string }) =>
      register(fullName, email, password),
    onSuccess: (data) => {
      setToken(data.token);
      navigate('/');
    },
  });
}

export function useLogout() {
  const navigate = useNavigate();
  return () => {
    clearToken();
    navigate('/login');
  };
}
