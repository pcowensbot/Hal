import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { deviceLogsApi, tokenStatsApi, shareApi, knowledgeApi } from '../lib/api';

export const deviceLogKeys = {
  all: ['device-logs'] as const,
  days: (month?: string) => [...deviceLogKeys.all, 'days', month] as const,
  daysByDevice: () => [...deviceLogKeys.all, 'days-by-device'] as const,
  logs: (params: Record<string, unknown>) => [...deviceLogKeys.all, 'logs', params] as const,
  share: (slug: string) => [...deviceLogKeys.all, 'share', slug] as const,
};

export function useTokenStats() {
  return useQuery({
    queryKey: [...deviceLogKeys.all, 'token-stats'] as const,
    queryFn: tokenStatsApi.getStats,
  });
}

export function useLogDays(month?: string) {
  return useQuery({
    queryKey: deviceLogKeys.days(month),
    queryFn: () => deviceLogsApi.getLogDays(month),
  });
}

export function useLogDaysByDevice() {
  return useQuery({
    queryKey: deviceLogKeys.daysByDevice(),
    queryFn: () => deviceLogsApi.getLogDaysByDevice(),
  });
}

export function useDeviceLogs(params: {
  date: string;
  deviceId?: string;
  search?: string;
  timeFrom?: string;
  timeTo?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: deviceLogKeys.logs(params as Record<string, unknown>),
    queryFn: () => deviceLogsApi.getLogs(params),
    enabled: !!params.date,
  });
}

export function useCreateShare() {
  return useMutation({
    mutationFn: ({ deviceId, logIds }: { deviceId: string; logIds: string[] }) =>
      deviceLogsApi.createShare(deviceId, logIds),
  });
}

export function useSharedLogs(slug: string) {
  return useQuery({
    queryKey: deviceLogKeys.share(slug),
    queryFn: () => shareApi.getShare(slug),
    enabled: !!slug,
  });
}

export function useAddLogsToKnowledge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (logs: { prompt: string; response: string; createdAt: string }[]) => {
      const results = [];
      for (const log of logs) {
        const title = log.prompt.substring(0, 100);
        const content = `**Prompt:**\n${log.prompt}\n\n**Response:**\n${log.response}`;
        results.push(await knowledgeApi.createNoteFromText(content, title));
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
}
