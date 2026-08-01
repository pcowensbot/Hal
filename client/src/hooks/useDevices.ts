import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deviceApi } from '../lib/api';

// Query keys
export const deviceKeys = {
  all: ['devices'] as const,
  list: () => [...deviceKeys.all, 'list'] as const,
  logs: (id: string) => [...deviceKeys.all, 'logs', id] as const,
};

// Fetch all devices
export function useDevices() {
  return useQuery({
    queryKey: deviceKeys.list(),
    queryFn: deviceApi.getDevices,
  });
}

// Fetch device logs
export function useDeviceLogs(id: string | undefined, limit?: number) {
  return useQuery({
    queryKey: deviceKeys.logs(id!),
    queryFn: () => deviceApi.getDeviceLogs(id!, limit),
    enabled: !!id,
  });
}

// Create device
export function useCreateDevice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, description }: { name: string; description?: string }) =>
      deviceApi.createDevice(name, description),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceKeys.list() });
    },
  });
}

// Update device
export function useUpdateDevice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name?: string;
      description?: string;
    }) => deviceApi.updateDevice(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceKeys.list() });
    },
  });
}

// Delete device
export function useDeleteDevice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deviceApi.deleteDevice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceKeys.list() });
    },
  });
}

// Regenerate API key
export function useRegenerateKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deviceApi.regenerateKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: deviceKeys.list() });
    },
  });
}
