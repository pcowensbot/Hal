import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, parentApi } from '../lib/api';
import type { CustomRole } from '../types';

// Query keys
export const adminKeys = {
  all: ['admin'] as const,
  stats: () => [...adminKeys.all, 'stats'] as const,
  users: () => [...adminKeys.all, 'users'] as const,
  groups: () => [...adminKeys.all, 'groups'] as const,
  roles: () => [...adminKeys.all, 'roles'] as const,
  invites: () => [...adminKeys.all, 'invites'] as const,
  conversations: (params?: { userId?: string }) => [...adminKeys.all, 'conversations', params] as const,
  pendingDeletions: () => [...adminKeys.all, 'pending-deletions'] as const,
  settings: () => [...adminKeys.all, 'settings'] as const,
  models: () => [...adminKeys.all, 'models'] as const,
  runningModels: () => [...adminKeys.all, 'running-models'] as const,
  defaultModel: () => [...adminKeys.all, 'default-model'] as const,
  gpuInfo: () => [...adminKeys.all, 'gpu'] as const,
};

// Stats
export function useAdminStats() {
  return useQuery({
    queryKey: adminKeys.stats(),
    queryFn: adminApi.getStats,
  });
}

// Users
export function useAdminUsers() {
  return useQuery({
    queryKey: adminKeys.users(),
    queryFn: adminApi.getUsers,
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, roleId }: { id: string; roleId: string }) =>
      adminApi.updateUser(id, { roleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.users() });
    },
  });
}

export function useToggleUserActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      adminApi.toggleUserActive(id, isActive),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.users() });
    },
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      adminApi.resetUserPassword(id, newPassword),
  });
}

// Groups
export function useAdminGroups() {
  return useQuery({
    queryKey: adminKeys.groups(),
    queryFn: adminApi.getGroups,
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { name: string; description?: string; color?: string }) =>
      adminApi.createGroup(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.groups() });
    },
  });
}

export function useUpdateGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; description?: string; color?: string }) =>
      adminApi.updateGroup(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.groups() });
    },
  });
}

export function useDeleteGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => adminApi.deleteGroup(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.groups() });
    },
  });
}

export function useAddGroupMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      groupId,
      userId,
      isGroupAdmin,
    }: {
      groupId: string;
      userId: string;
      isGroupAdmin?: boolean;
    }) => adminApi.addGroupMember(groupId, userId, isGroupAdmin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.groups() });
      queryClient.invalidateQueries({ queryKey: adminKeys.users() });
    },
  });
}

export function useRemoveGroupMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      adminApi.removeGroupMember(groupId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.groups() });
      queryClient.invalidateQueries({ queryKey: adminKeys.users() });
    },
  });
}

// Roles
export function useAdminRoles() {
  return useQuery({
    queryKey: adminKeys.roles(),
    queryFn: adminApi.getRoles,
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Partial<CustomRole>) => adminApi.createRole(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.roles() });
    },
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<CustomRole>) =>
      adminApi.updateRole(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.roles() });
    },
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => adminApi.deleteRole(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.roles() });
    },
  });
}

// Invites
export function useAdminInvites() {
  return useQuery({
    queryKey: adminKeys.invites(),
    queryFn: adminApi.getInvites,
  });
}

export function useCreateInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      roleId: string;
      groupId?: string;
      makeGroupAdmin?: boolean;
      expiresInDays?: number;
    }) => adminApi.createInvite(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.invites() });
    },
  });
}

export function useDeactivateInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => adminApi.deactivateInvite(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.invites() });
    },
  });
}

// Conversations
export function useAllConversations(params?: { userId?: string; search?: string }) {
  return useQuery({
    queryKey: adminKeys.conversations(params),
    queryFn: () => adminApi.getAllConversations(params),
  });
}

export function usePendingDeletions() {
  return useQuery({
    queryKey: adminKeys.pendingDeletions(),
    queryFn: adminApi.getPendingDeletions,
  });
}

export function useRestoreConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => adminApi.restoreConversation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.pendingDeletions() });
      queryClient.invalidateQueries({ queryKey: adminKeys.conversations() });
    },
  });
}

export function usePermanentlyDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => adminApi.permanentlyDeleteConversation(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.pendingDeletions() });
    },
  });
}

// System settings
export function useSettings() {
  return useQuery({
    queryKey: adminKeys.settings(),
    queryFn: parentApi.getSettings,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: parentApi.updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.settings() });
    },
  });
}

// Models
export function useModels() {
  return useQuery({
    queryKey: adminKeys.models(),
    queryFn: parentApi.getModels,
  });
}

export function usePullModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => parentApi.pullModel(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.models() });
    },
  });
}

export function useDeleteModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => parentApi.deleteModel(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.models() });
    },
  });
}

export function useLoadModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => parentApi.loadModel(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.runningModels() });
      queryClient.invalidateQueries({ queryKey: adminKeys.gpuInfo() });
    },
  });
}

export function useUnloadModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => parentApi.unloadModel(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.runningModels() });
      queryClient.invalidateQueries({ queryKey: adminKeys.gpuInfo() });
    },
  });
}

// Running models
export function useRunningModels() {
  return useQuery({
    queryKey: adminKeys.runningModels(),
    queryFn: parentApi.getRunningModels,
    refetchInterval: 10000,
  });
}

// Default model
export function useDefaultModel() {
  return useQuery({
    queryKey: adminKeys.defaultModel(),
    queryFn: parentApi.getDefaultModel,
  });
}

export function useSetDefaultModel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (model: string) => parentApi.setDefaultModel(model),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: adminKeys.defaultModel() });
    },
  });
}

// API Usage
export function useApiUsage() {
  return useQuery({
    queryKey: [...adminKeys.all, 'api-usage'] as const,
    queryFn: adminApi.getApiUsage,
  });
}

// Hardware Info
export function useHardwareInfo() {
  return useQuery({
    queryKey: adminKeys.gpuInfo(),
    queryFn: parentApi.getHardwareInfo,
    refetchInterval: 30000,
  });
}

// Live View
export function useLiveView() {
  return useQuery({
    queryKey: [...adminKeys.all, 'live'] as const,
    queryFn: adminApi.getLiveView,
    refetchInterval: 10000,
  });
}
