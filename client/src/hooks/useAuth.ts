import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores';
import { authApi } from '../lib/api';
import { toast } from '../stores/uiStore';

export function useLogin() {
  const login = useAuthStore((state) => state.login);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) =>
      login(email, password),
    onSuccess: () => {
      navigate('/chat');
      toast.success('Welcome back!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Login failed');
    },
  });
}

export function useSignup() {
  const signup = useAuthStore((state) => state.signup);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: (data: { email: string; password: string; firstName: string; inviteCode: string }) =>
      signup(data),
    onSuccess: () => {
      navigate('/chat');
      toast.success('Account created successfully!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Signup failed');
    },
  });
}

export function useLogout() {
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  return () => {
    logout();
    navigate('/login');
    toast.info('You have been logged out');
  };
}

export function useUpdateAvatar() {
  const updateUser = useAuthStore((state) => state.updateUser);

  return useMutation({
    mutationFn: (avatar: string) => authApi.updateAvatar(avatar),
    onSuccess: ({ user }) => {
      updateUser({ avatar: user.avatar });
      toast.success('Avatar updated');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update avatar');
    },
  });
}

export function useRemoveAvatar() {
  const updateUser = useAuthStore((state) => state.updateUser);

  return useMutation({
    mutationFn: () => authApi.removeAvatar(),
    onSuccess: () => {
      updateUser({ avatar: null });
      toast.success('Avatar removed');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove avatar');
    },
  });
}

export function useUpdateProfile() {
  const updateUser = useAuthStore((state) => state.updateUser);

  return useMutation({
    mutationFn: (firstName: string) => authApi.updateProfile(firstName),
    onSuccess: ({ user }) => {
      updateUser({ firstName: user.firstName });
      toast.success('Profile updated');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update profile');
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: ({ currentPassword, newPassword }: { currentPassword: string; newPassword: string }) =>
      authApi.changePassword(currentPassword, newPassword),
    onSuccess: () => {
      toast.success('Password changed successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to change password');
    },
  });
}

export function useDeleteAccount() {
  const logout = useAuthStore((state) => state.logout);
  const navigate = useNavigate();

  return useMutation({
    mutationFn: ({ deleteType, password }: { deleteType: 'complete' | 'archive'; password: string }) =>
      authApi.deleteAccount(deleteType, password),
    onSuccess: (response) => {
      logout();
      navigate('/login');
      toast.info('Account deleted');

      // If archive was requested, trigger download
      if (response.archive) {
        const blob = new Blob([JSON.stringify(response.archive, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'hal-account-archive.json';
        a.click();
        URL.revokeObjectURL(url);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to delete account');
    },
  });
}
