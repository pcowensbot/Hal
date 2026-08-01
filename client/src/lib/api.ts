import type {
  User,
  Conversation,
  Message,
  ChatFolder,
  Book,
  StarredNote,
  Device,
  DeviceApiLog,
  Group,
  CustomRole,
  InviteCode,
  Settings,
  OllamaModel,
  AuthResponse,
  DashboardStats,
  ConversationShare,
  LogDaysResponse,
  DeviceLogsResponse,
  DeviceLogDaysResponse,
  SharedApiLogResponse,
  TokenStats,
  ApiUsageStats,
} from '../types';

const API_BASE = '/api';

// Token management
let authToken: string | null = localStorage.getItem('token');

export function setToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
  }
}

export function getToken(): string | null {
  return authToken;
}

// API error class
export class ApiError extends Error {
  status: number;
  data?: unknown;

  constructor(message: string, status: number, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// Base fetch wrapper
async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (authToken) {
    (headers as Record<string, string>)['Authorization'] = `Bearer ${authToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));

    // On 401, clear auth and redirect to login (skip for auth endpoints that handle their own errors)
    if (response.status === 401 && !endpoint.startsWith('/auth/')) {
      setToken(null);
      // Use dynamic import to avoid circular dependency (authStore imports from api)
      const { useAuthStore } = await import('../stores/authStore');
      useAuthStore.getState().logout();
      window.location.href = '/login';
    }

    throw new ApiError(
      data.error || `Request failed with status ${response.status}`,
      response.status,
      data
    );
  }

  return response.json();
}

// Auth API
export const authApi = {
  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  getMe: () =>
    request<{ user: AuthResponse['user'] }>('/auth/me'),

  signup: (data: { email: string; password: string; firstName: string; inviteCode: string }) =>
    request<AuthResponse>('/auth/signup', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateAvatar: (avatar: string) =>
    request<{ success: boolean; user: User }>('/auth/avatar', {
      method: 'POST',
      body: JSON.stringify({ avatar }),
    }),

  removeAvatar: () =>
    request<{ success: boolean; user: User }>('/auth/avatar', {
      method: 'DELETE',
    }),

  updateProfile: (firstName: string) =>
    request<{ success: boolean; user: User }>('/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify({ firstName }),
    }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean; message: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  deleteAccount: (deleteType: 'complete' | 'archive', password: string) =>
    request<{ success: boolean; message: string; archive?: unknown }>('/auth/delete-account', {
      method: 'POST',
      body: JSON.stringify({ deleteType, password }),
    }),
};

// Extended conversation type with computed fields
export interface ConversationWithMeta extends Conversation {
  isOwned: boolean;
  isShared: boolean;
}

// Chat API
export const chatApi = {
  getConversations: () =>
    request<ConversationWithMeta[]>('/chat/conversations'),

  getConversation: (id: string) =>
    request<ConversationWithMeta>(`/chat/conversations/${id}`),

  createConversation: (title?: string) =>
    request<Conversation>('/chat/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),

  updateConversation: (id: string, data: { title?: string; folderId?: string | null }) =>
    request<Conversation>(`/chat/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  toggleStar: (id: string, starred: boolean) =>
    request<{ success: boolean; starred: boolean }>(`/chat/conversations/${id}/star`, {
      method: 'PATCH',
      body: JSON.stringify({ starred }),
    }),

  deleteConversation: (id: string) =>
    request<{ success: boolean; message: string }>(`/chat/conversations/${id}`, {
      method: 'DELETE',
    }),

  sendMessage: (conversationId: string, content: string, images?: string[]) =>
    request<{ userMessage: Message; assistantMessage: Message }>(
      `/chat/conversations/${conversationId}/messages`,
      {
        method: 'POST',
        body: JSON.stringify({ content, ...(images && images.length > 0 ? { images } : {}) }),
      }
    ),

  // Streaming variant — emits server-sent events with a user/assistant pair up front,
  // chunk events for content deltas, and a done event with the finalized assistant message.
  sendMessageStream: async (
    conversationId: string,
    content: string,
    callbacks: {
      onStart: (userMessage: Message, assistantMessage: Message) => void;
      onChunk: (delta: string) => void;
    },
    images?: string[],
  ): Promise<{ userMessage: Message; assistantMessage: Message }> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

    const response = await fetch(`${API_BASE}/chat/conversations/${conversationId}/messages/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content, ...(images && images.length > 0 ? { images } : {}) }),
    });

    if (!response.ok || !response.body) {
      const data = await response.json().catch(() => ({}));
      throw new ApiError(
        (data as { error?: string })?.error || 'Failed to send message',
        response.status,
        data,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let userMessage: Message | null = null;
    let assistantMessage: Message | null = null;
    let streamError: string | null = null;

    const processEvent = (eventName: string, payload: string) => {
      if (!payload) return;
      const parsed = JSON.parse(payload);
      if (eventName === 'start') {
        userMessage = parsed.userMessage;
        assistantMessage = parsed.assistantMessage;
        callbacks.onStart(parsed.userMessage, parsed.assistantMessage);
      } else if (eventName === 'chunk') {
        callbacks.onChunk(parsed.delta);
      } else if (eventName === 'done') {
        assistantMessage = parsed.assistantMessage;
      } else if (eventName === 'error') {
        streamError = parsed.error || 'Stream error';
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const raw of events) {
        if (!raw.trim()) continue;
        let eventName = 'message';
        let data = '';
        for (const line of raw.split('\n')) {
          if (line.startsWith('event: ')) eventName = line.slice(7).trim();
          else if (line.startsWith('data: ')) data += line.slice(6);
        }
        processEvent(eventName, data);
      }
    }

    if (streamError) throw new Error(streamError);
    if (!userMessage || !assistantMessage) throw new Error('Stream ended without completion');
    return { userMessage, assistantMessage };
  },

  // Sharing
  getMyGroups: () =>
    request<(Group & { isGroupAdmin: boolean })[]>('/chat/my-groups'),

  shareConversation: (conversationId: string, groupId: string) =>
    request<ConversationShare>(`/chat/conversations/${conversationId}/share`, {
      method: 'POST',
      body: JSON.stringify({ groupId }),
    }),

  unshareConversation: (conversationId: string, groupId: string) =>
    request<{ success: boolean }>(`/chat/conversations/${conversationId}/share/${groupId}`, {
      method: 'DELETE',
    }),

  getGroupConversations: (groupId: string) =>
    request<Conversation[]>(`/chat/groups/${groupId}/conversations`),

  // Folders
  getFolders: () =>
    request<ChatFolder[]>('/chat/folders'),

  createFolder: (name: string, parentId?: string) =>
    request<ChatFolder>('/chat/folders', {
      method: 'POST',
      body: JSON.stringify({ name, parentId }),
    }),

  updateFolder: (id: string, data: { name?: string; isCollapsed?: boolean }) =>
    request<ChatFolder>(`/chat/folders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  reorderFolders: (folderIds: string[], parentId?: string | null) =>
    request<{ success: boolean }>('/chat/folders/reorder', {
      method: 'POST',
      body: JSON.stringify({ folderIds, parentId }),
    }),

  deleteFolder: (id: string) =>
    request<{ success: boolean }>(`/chat/folders/${id}`, {
      method: 'DELETE',
    }),
};

// Knowledge API
export const knowledgeApi = {
  getBooks: () =>
    request<Book[]>('/knowledge/books'),

  getBook: (id: string) =>
    request<Book & { notes: StarredNote[] }>(`/knowledge/books/${id}`),

  createBook: (name: string, description?: string) =>
    request<Book>('/knowledge/books', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  updateBook: (id: string, data: { name?: string; description?: string }) =>
    request<Book>(`/knowledge/books/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteBook: (id: string) =>
    request<{ success: boolean }>(`/knowledge/books/${id}`, {
      method: 'DELETE',
    }),

  getNotes: (bookId?: string) =>
    request<StarredNote[]>(`/knowledge/notes${bookId ? `?bookId=${bookId}` : ''}`),

  createNote: (messageId: string, bookId?: string, title?: string, note?: string) =>
    request<StarredNote>('/knowledge/notes', {
      method: 'POST',
      body: JSON.stringify({ messageId, bookId, title, note }),
    }),

  updateNote: (id: string, data: { title?: string; note?: string; bookId?: string }) =>
    request<StarredNote>(`/knowledge/notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteNote: (id: string) =>
    request<{ success: boolean }>(`/knowledge/notes/${id}`, {
      method: 'DELETE',
    }),

  search: (query: string) =>
    request<StarredNote[]>(`/knowledge/search?q=${encodeURIComponent(query)}`),

  autoOrganize: (noteIds: string[]) =>
    request<{ suggestions: { noteId: string; suggestedBook: string; confidence: number }[] }>(
      '/knowledge/auto-organize',
      {
        method: 'POST',
        body: JSON.stringify({ noteIds }),
      }
    ),

  exportBook: (id: string) =>
    request<{ book: Book; notes: StarredNote[] }>(`/knowledge/books/${id}/export`),

  importBook: (data: { book: Partial<Book>; notes: Partial<StarredNote>[] }) =>
    request<Book>('/knowledge/books/import', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  createNoteFromText: (content: string, title?: string, bookId?: string) =>
    request<StarredNote>('/knowledge/notes/from-text', {
      method: 'POST',
      body: JSON.stringify({ content, title, bookId }),
    }),
};

// Device API
export const deviceApi = {
  getDevices: () =>
    request<Device[]>('/devices'),

  createDevice: (name: string, description?: string) =>
    request<Device & { apiKey: string }>('/devices', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  updateDevice: (id: string, data: { name?: string; description?: string }) =>
    request<Device>(`/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteDevice: (id: string) =>
    request<{ success: boolean }>(`/devices/${id}`, {
      method: 'DELETE',
    }),

  regenerateKey: (id: string) =>
    request<{ apiKey: string }>(`/devices/${id}/regenerate`, {
      method: 'POST',
    }),

  getDeviceLogs: (id: string, limit?: number) =>
    request<DeviceApiLog[]>(`/devices/${id}/logs${limit ? `?limit=${limit}` : ''}`),
};

// Admin API
export const adminApi = {
  getStats: () =>
    request<DashboardStats>('/parent/stats'),

  getUsers: () =>
    request<User[]>('/parent/users'),

  updateUser: (id: string, data: { roleId: string }) =>
    request<User>(`/parent/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  toggleUserActive: (id: string, isActive: boolean) =>
    request<User>(`/parent/users/${id}/toggle-status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),

  resetUserPassword: (id: string, newPassword: string) =>
    request<{ success: boolean; message: string }>(`/parent/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    }),

  // Groups
  getGroups: () =>
    request<Group[]>('/parent/groups'),

  createGroup: (data: { name: string; description?: string; color?: string }) =>
    request<Group>('/parent/groups', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateGroup: (id: string, data: { name?: string; description?: string; color?: string }) =>
    request<Group>(`/parent/groups/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteGroup: (id: string) =>
    request<{ success: boolean }>(`/parent/groups/${id}`, {
      method: 'DELETE',
    }),

  addGroupMember: (groupId: string, userId: string, isGroupAdmin?: boolean) =>
    request<{ success: boolean }>(`/parent/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId, isGroupAdmin }),
    }),

  removeGroupMember: (groupId: string, userId: string) =>
    request<{ success: boolean }>(`/parent/groups/${groupId}/members/${userId}`, {
      method: 'DELETE',
    }),

  // Roles
  getRoles: () =>
    request<CustomRole[]>('/parent/roles'),

  createRole: (data: Partial<CustomRole>) =>
    request<CustomRole>('/parent/roles', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateRole: (id: string, data: Partial<CustomRole>) =>
    request<CustomRole>(`/parent/roles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  deleteRole: (id: string) =>
    request<{ success: boolean }>(`/parent/roles/${id}`, {
      method: 'DELETE',
    }),

  // Invites
  getInvites: () =>
    request<InviteCode[]>('/parent/invites'),

  createInvite: (data: { roleId: string; groupId?: string; makeGroupAdmin?: boolean; expiresInDays?: number }) =>
    request<InviteCode & { code: string }>('/parent/invites', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deactivateInvite: (id: string) =>
    request<{ success: boolean }>(`/parent/invites/${id}`, {
      method: 'DELETE',
    }),

  // Pending deletions
  getPendingDeletions: () =>
    request<Conversation[]>('/parent/pending-deletions'),

  restoreConversation: (id: string) =>
    request<Conversation>(`/parent/conversations/${id}/restore`, {
      method: 'POST',
    }),

  permanentlyDeleteConversation: (id: string) =>
    request<{ success: boolean }>(`/parent/conversations/${id}/permanent`, {
      method: 'DELETE',
    }),

  // All conversations (admin view)
  getAllConversations: (params?: { userId?: string; search?: string }) =>
    request<Conversation[]>(
      `/parent/conversations${params ? `?${new URLSearchParams(params as Record<string, string>)}` : ''}`
    ),

  // Single conversation with messages (admin view)
  getConversation: (id: string) =>
    request<Conversation>(`/parent/conversations/${id}`),

  getApiUsage: () =>
    request<ApiUsageStats>('/parent/api-usage'),

  getLiveView: () =>
    request<{
      activeUsers: { id: string; firstName: string; email: string; role: string; avatar: string | null; lastActivity: string; activityType: string }[];
      recentChats: {
        id: string; role: string; createdAt: string; model: string | null;
        conversation: { id: string; title: string; userId: string; user: { id: string; firstName: string; avatar: string | null } };
      }[];
      recentApiCalls: {
        id: string; endpoint: string; method: string; model: string | null; status: number; durationMs: number | null; tokenCount: number | null; createdAt: string;
        device: { id: string; name: string; user: { id: string; firstName: string; avatar: string | null } };
      }[];
    }>('/parent/live'),
};

// Parent/System Admin API
export const parentApi = {
  getSettings: () =>
    request<Settings>('/parent/settings'),

  updateSettings: (data: Partial<Settings>) =>
    request<Settings>('/parent/settings', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),

  // Models (Ollama)
  getModels: () =>
    request<OllamaModel[]>('/admin/models'),

  pullModel: (name: string) =>
    request<{ success: boolean; message: string }>('/admin/models/pull', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  deleteModel: (name: string) =>
    request<{ success: boolean }>(`/admin/models/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    }),

  loadModel: (name: string) =>
    request<{ success: boolean; message: string }>('/admin/models/load', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  unloadModel: (name: string) =>
    request<{ success: boolean; message: string }>('/admin/models/unload', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  getRunningModels: () =>
    request<{ name: string; model: string; size: number; digest: string; expires_at: string }[]>('/admin/models/running'),

  getDefaultModel: () =>
    request<{ defaultModel: string }>('/admin/settings/default-model'),

  setDefaultModel: (model: string) =>
    request<{ success: boolean; defaultModel: string }>('/admin/settings/default-model', {
      method: 'POST',
      body: JSON.stringify({ model }),
    }),

  // Hardware info
  getHardwareInfo: () =>
    request<{
      gpus: { id: number; name: string; vendor: string; vramTotal: number; vramFree: number; temperature: number | null; powerDraw: number | null; fanSpeed: number | null }[];
      ram: { total: number; available: number };
      cpu: { model: string; cores: number };
    }>('/admin/hardware'),
};

// Import API
export const importApi = {
  importChat: (shareUrl: string) =>
    request<{ conversation: { id: string; title: string; messageCount: number; platform: string } }>('/import/chat', {
      method: 'POST',
      body: JSON.stringify({ shareUrl }),
    }),
};

// Documents API (Docling)
export const documentsApi = {
  process: (formData: FormData) => {
    // Remove Content-Type header to let browser set it with boundary
    const headers: HeadersInit = {};
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    return fetch(`${API_BASE}/documents/process`, {
      method: 'POST',
      headers,
      body: formData,
    }).then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new ApiError(
          data.error || `Request failed with status ${response.status}`,
          response.status,
          data
        );
      }
      return response.json() as Promise<{ success: boolean; content: string; metadata: { originalName: string; size: number; mimeType: string; pages?: number; format?: string } }>;
    });
  },
};

// Device Logs API
export const tokenStatsApi = {
  getStats: () => request<TokenStats>('/sessions/token-stats'),
};

export const deviceLogsApi = {
  getLogDays: (month?: string) => {
    const params = month ? `?month=${month}` : '';
    return request<LogDaysResponse>(`/sessions/log-days${params}`);
  },

  getLogDaysByDevice: () => {
    return request<DeviceLogDaysResponse>('/sessions/log-days-by-device');
  },

  getLogs: (params: {
    date: string;
    deviceId?: string;
    search?: string;
    timeFrom?: string;
    timeTo?: string;
    page?: number;
    limit?: number;
  }) => {
    const searchParams = new URLSearchParams();
    searchParams.set('date', params.date);
    if (params.deviceId) searchParams.set('deviceId', params.deviceId);
    if (params.search) searchParams.set('search', params.search);
    if (params.timeFrom) searchParams.set('timeFrom', params.timeFrom);
    if (params.timeTo) searchParams.set('timeTo', params.timeTo);
    if (params.page) searchParams.set('page', String(params.page));
    if (params.limit) searchParams.set('limit', String(params.limit));
    return request<DeviceLogsResponse>(`/sessions/logs?${searchParams}`);
  },

  createShare: (deviceId: string, logIds: string[]) => {
    return request<{ slug: string; url: string }>('/sessions/share', {
      method: 'POST',
      body: JSON.stringify({ deviceId, logIds }),
    });
  },
};

export const shareApi = {
  getShare: (slug: string) => {
    return request<SharedApiLogResponse>(`/share/${slug}`);
  },
};

