import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chatApi, type ConversationWithMeta } from '../lib/api';

// Query keys
export const chatKeys = {
  all: ['chat'] as const,
  conversations: () => [...chatKeys.all, 'conversations'] as const,
  conversation: (id: string) => [...chatKeys.all, 'conversation', id] as const,
  folders: () => [...chatKeys.all, 'folders'] as const,
  myGroups: () => [...chatKeys.all, 'my-groups'] as const,
  groupConversations: (groupId: string) => [...chatKeys.all, 'group-conversations', groupId] as const,
};

// Fetch all conversations
export function useConversations() {
  return useQuery({
    queryKey: chatKeys.conversations(),
    queryFn: chatApi.getConversations,
  });
}

// Fetch single conversation with messages
export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: chatKeys.conversation(id!),
    queryFn: () => chatApi.getConversation(id!),
    enabled: !!id,
  });
}

// Create a new conversation
export function useCreateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (title?: string) => chatApi.createConversation(title),
    onSuccess: (newConversation) => {
      const fullConversation = {
        ...newConversation,
        isOwned: true,
        isShared: false,
        messages: [],
      } as ConversationWithMeta;

      // Populate individual conversation cache so ConversationView doesn't need to fetch
      queryClient.setQueryData<ConversationWithMeta>(
        chatKeys.conversation(newConversation.id),
        fullConversation
      );

      // Update the conversation list
      queryClient.setQueryData<ConversationWithMeta[]>(
        chatKeys.conversations(),
        (old) => old ? [fullConversation, ...old] : [fullConversation]
      );
    },
  });
}

// Update conversation (title, folderId)
export function useUpdateConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; title?: string; folderId?: string | null }) =>
      chatApi.updateConversation(id, data),
    onSuccess: (updated, { id }) => {
      queryClient.setQueryData<ConversationWithMeta[]>(
        chatKeys.conversations(),
        (old) => old?.map((c) => (c.id === id ? { ...c, ...updated } : c))
      );
      queryClient.setQueryData<ConversationWithMeta>(
        chatKeys.conversation(id),
        (old) => old ? { ...old, ...updated } : undefined
      );
    },
  });
}

// Toggle star
export function useToggleStar() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, starred }: { id: string; starred: boolean }) =>
      chatApi.toggleStar(id, starred),
    onMutate: async ({ id, starred }) => {
      await queryClient.cancelQueries({ queryKey: chatKeys.conversations() });
      const previous = queryClient.getQueryData<ConversationWithMeta[]>(chatKeys.conversations());

      queryClient.setQueryData<ConversationWithMeta[]>(
        chatKeys.conversations(),
        (old) => old?.map((c) => (c.id === id ? { ...c, starred } : c))
      );

      return { previous };
    },
    onError: (_, __, context) => {
      if (context?.previous) {
        queryClient.setQueryData(chatKeys.conversations(), context.previous);
      }
    },
  });
}

// Delete conversation (soft delete)
export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => chatApi.deleteConversation(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData<ConversationWithMeta[]>(
        chatKeys.conversations(),
        (old) => old?.filter((c) => c.id !== id)
      );
      queryClient.removeQueries({ queryKey: chatKeys.conversation(id) });
    },
  });
}

// Send message — uses streaming SSE endpoint to update the assistant bubble live
export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, content, images }: { conversationId: string; content: string; images?: string[] }) =>
      chatApi.sendMessageStream(conversationId, content, {
        onStart: (userMessage, assistantMessage) => {
          // Drop both messages into the cache immediately so the UI shows a
          // live-updating assistant bubble while tokens arrive.
          queryClient.setQueryData<ConversationWithMeta>(
            chatKeys.conversation(conversationId),
            (old) => old
              ? { ...old, messages: [...(old.messages || []), userMessage, assistantMessage] }
              : old,
          );
        },
        onChunk: (delta) => {
          queryClient.setQueryData<ConversationWithMeta>(
            chatKeys.conversation(conversationId),
            (old) => {
              if (!old?.messages?.length) return old;
              const messages = old.messages.slice();
              const lastIdx = messages.length - 1;
              const last = messages[lastIdx];
              if (last?.role !== 'assistant') return old;
              messages[lastIdx] = { ...last, content: last.content + delta };
              return { ...old, messages };
            },
          );
        },
      }, images),
    onSuccess: ({ assistantMessage }, { conversationId }) => {
      // Replace the streamed bubble with the server's canonical final message
      // (includes any tool-use prefix added server-side).
      queryClient.setQueryData<ConversationWithMeta>(
        chatKeys.conversation(conversationId),
        (old) => {
          if (!old?.messages?.length) return old;
          const messages = old.messages.map(m => m.id === assistantMessage.id ? assistantMessage : m);
          return { ...old, messages };
        },
      );
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
    },
    onError: (_err, { conversationId }) => {
      // Strip any in-flight assistant placeholder that never filled
      queryClient.setQueryData<ConversationWithMeta>(
        chatKeys.conversation(conversationId),
        (old) => {
          if (!old?.messages?.length) return old;
          const messages = old.messages.filter(m => !(m.role === 'assistant' && m.modelUsed === 'pending'));
          return { ...old, messages };
        },
      );
    },
  });
}

// Get user's groups for sharing
export function useMyGroups() {
  return useQuery({
    queryKey: chatKeys.myGroups(),
    queryFn: chatApi.getMyGroups,
  });
}

// Share conversation
export function useShareConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, groupId }: { conversationId: string; groupId: string }) =>
      chatApi.shareConversation(conversationId, groupId),
    onSuccess: (_share, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) });
    },
  });
}

// Unshare conversation
export function useUnshareConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ conversationId, groupId }: { conversationId: string; groupId: string }) =>
      chatApi.unshareConversation(conversationId, groupId),
    onSuccess: (_, { conversationId }) => {
      queryClient.invalidateQueries({ queryKey: chatKeys.conversation(conversationId) });
    },
  });
}

// ============================================
// FOLDER HOOKS
// ============================================

export function useFolders() {
  return useQuery({
    queryKey: chatKeys.folders(),
    queryFn: chatApi.getFolders,
  });
}

export function useCreateFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string }) =>
      chatApi.createFolder(name, parentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.folders() });
    },
  });
}

export function useUpdateFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; name?: string; isCollapsed?: boolean }) =>
      chatApi.updateFolder(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.folders() });
    },
  });
}

export function useReorderFolders() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ folderIds, parentId }: { folderIds: string[]; parentId?: string | null }) =>
      chatApi.reorderFolders(folderIds, parentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.folders() });
    },
  });
}

export function useDeleteFolder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => chatApi.deleteFolder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: chatKeys.folders() });
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
    },
  });
}
