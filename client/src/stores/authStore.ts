import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';
import { authApi, setToken, getToken } from '../lib/api';

// Permissions derived from custom role
export interface Permissions {
  canManageUsers: boolean;
  canManageGroups: boolean;
  canManageRoles: boolean;
  canViewAllConvos: boolean;
  canManageSystem: boolean;
  canCreateInvites: boolean;
  canDeleteConvos: boolean;
}

// User with additional login response data
export interface AuthUser extends Omit<User, 'customRole'> {
  customRole?: {
    id: string;
    name: string;
    color?: string | null;
  } | null;
  permissions: Permissions;
  groups: {
    id: string;
    name: string;
    color?: string | null;
    isGroupAdmin: boolean;
    canViewAll: boolean;
  }[];
}

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  signup: (data: { email: string; password: string; firstName: string; inviteCode: string }) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<AuthUser>) => void;
  setError: (error: string | null) => void;
  checkAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: getToken(),
      isAuthenticated: !!getToken(),
      isLoading: false,
      error: null,

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const response = await authApi.login(email, password);
          setToken(response.token);
          set({
            user: response.user as AuthUser,
            token: response.token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Login failed';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      signup: async (data) => {
        set({ isLoading: true, error: null });
        try {
          const response = await authApi.signup(data);
          setToken(response.token);
          set({
            user: response.user as AuthUser,
            token: response.token,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Signup failed';
          set({ error: message, isLoading: false });
          throw err;
        }
      },

      logout: () => {
        setToken(null);
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          error: null,
        });
      },

      updateUser: (updates) => {
        const { user } = get();
        if (user) {
          set({ user: { ...user, ...updates } });
        }
      },

      setError: (error) => {
        set({ error });
      },

      checkAuth: () => {
        const token = getToken();
        if (!token) {
          set({ isAuthenticated: false, user: null, token: null });
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.isAuthenticated && state?.token) {
          authApi.getMe()
            .then((response) => {
              useAuthStore.setState({ user: response.user as AuthUser });
            })
            .catch(() => {
              setToken(null);
              useAuthStore.setState({
                user: null,
                token: null,
                isAuthenticated: false,
              });
            });
        }
      },
    }
  )
);

// Selectors for convenience
export const selectUser = (state: AuthState) => state.user;
export const selectIsAuthenticated = (state: AuthState) => state.isAuthenticated;
export const selectPermissions = (state: AuthState) => state.user?.permissions;
export const selectIsSystemAdmin = (state: AuthState) => state.user?.isSystemAdmin ?? false;
export const selectUserGroups = (state: AuthState) => state.user?.groups ?? [];
