// Types derived from Prisma schema

// Enums
export type Role = 'SUPER_ADMIN' | 'PARENT' | 'CHILD' | 'MEMBER';

// User
export interface User {
  id: string;
  email: string;
  firstName: string;
  role: Role;
  avatar?: string | null;
  isActive: boolean;
  isSystemAdmin: boolean;
  roleId?: string | null;
  createdAt: string;
  apiLimitDaily?: number | null;
  apiLimitMonthly?: number | null;
  apiCallsToday: number;
  apiCallsMonth: number;
  customRole?: CustomRole | null;
}

// Conversation
export interface Conversation {
  id: string;
  userId: string;
  title: string;
  starred: boolean;
  source?: string | null;
  folderId?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  permanentDelete: boolean;
  messages?: Message[];
  shares?: ConversationShare[];
  user?: User;
}

export interface ChatFolder {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  position: number;
  isCollapsed: boolean;
  createdAt: string;
  children?: ChatFolder[];
  _count?: { conversations: number };
}

// Message attachment type
export interface MessageAttachment {
  type: 'image';
  filename: string;
  originalUrl: string;
  size: number;
}

// Message
export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string | null;
  attachments?: MessageAttachment[] | null;
  modelUsed: string;
  createdAt: string;
}

// Settings
export interface Settings {
  id: number;
  householdName: string;
  imageGenEnabled: boolean;
  defaultModel: string;
  maintenanceEnabled: boolean;
  maintenanceStartHour: number;
  maintenanceEndHour: number;
  maintenanceGPUs: string;
  maintenanceMessage?: string | null;
  chatGPU?: string | null;
  imageGenGPU?: string | null;
  knowledgeBaseGPU?: string | null;
  knowledgeBaseEnabled: boolean;
}

// InviteCode
export interface InviteCode {
  id: string;
  code: string;
  createdById?: string | null;
  createdAt: string;
  expiresAt?: string | null;
  usedAt?: string | null;
  usedById?: string | null;
  isActive: boolean;
  emailedTo?: string | null;
  emailedAt?: string | null;
  roleId?: string | null;
  groupId?: string | null;
  makeGroupAdmin: boolean;
  createdBy?: User | null;
  usedBy?: User | null;
  assignedRole?: CustomRole | null;
  assignedGroup?: Group | null;
}

// CustomRole
export interface CustomRole {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  canManageUsers: boolean;
  canManageGroups: boolean;
  canManageRoles: boolean;
  canViewAllConvos: boolean;
  canManageSystem: boolean;
  canCreateInvites: boolean;
  canDeleteConvos: boolean;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

// Group
export interface Group {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  members?: GroupMember[];
  creator?: User;
}

// GroupMember
export interface GroupMember {
  id: string;
  userId: string;
  groupId: string;
  isGroupAdmin: boolean;
  canViewAll: boolean;
  joinedAt: string;
  user?: User;
  group?: Group;
}

// ConversationShare
export interface ConversationShare {
  id: string;
  conversationId: string;
  groupId: string;
  sharedBy: string;
  sharedAt: string;
  group?: Group;
  sharedByUser?: User;
}

// Book
export interface Book {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  notes?: StarredNote[];
}

// StarredNote
export interface StarredNote {
  id: string;
  userId: string;
  messageId: string;
  title?: string | null;
  note?: string | null;
  bookId?: string | null;
  createdAt: string;
  updatedAt: string;
  message?: Message;
  book?: Book;
}

// Device
export interface Device {
  id: string;
  userId: string;
  name: string;
  description?: string | null;
  lastUsedAt?: string | null;
  requestCount: number;
  createdAt: string;
  updatedAt: string;
}

// DeviceApiLog
export interface DeviceApiLog {
  id: string;
  deviceId: string;
  endpoint: string;
  method: string;
  model?: string | null;
  prompt?: string | null;
  response?: string | null;
  status: number;
  durationMs?: number | null;
  tokenCount?: number | null;
  error?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

// Log day/response types for device log viewer
export interface LogDay {
  date: string;
  count: number;
}

export interface LogDaysResponse {
  days: LogDay[];
}

export interface DeviceLogsResponse {
  logs: (DeviceApiLog & { device?: { name: string } })[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface DeviceLogDays {
  id: string;
  name: string;
  days: LogDay[];
}

export interface DeviceLogDaysResponse {
  devices: DeviceLogDays[];
}

export interface SharedApiLogResponse {
  logs: DeviceApiLog[];
  deviceName: string;
  sharedBy: string;
  createdAt: string;
}

// API Response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// Auth types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface SignupRequest {
  email: string;
  password: string;
  firstName: string;
  inviteCode: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// Artifact (extracted from code blocks in chat messages)
export interface Artifact {
  id: string;           // `${messageId}-${blockIndex}` — deterministic
  messageId: string;
  language: string;
  filename: string;
  content: string;
  lineCount: number;
}

// Chat types
export interface SendMessageRequest {
  message: string;
  conversationId?: string;
  attachments?: File[];
}

export interface CreateConversationRequest {
  title?: string;
}

// Import types
export interface ImportChatRequest {
  source: 'claude' | 'chatgpt';
  data: string;
}

// Stats for dashboard
export interface DashboardStats {
  totalUsers: number;
  totalConversations: number;
  pendingDeletions: number;
}

// Model info from Ollama
export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: {
    format: string;
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface TokenStats {
  totalTokens: number;
  totalRequests: number;
  today: {
    tokens: number;
    requests: number;
  };
  devices: {
    id: string;
    name: string;
    tokens: number;
    requests: number;
  }[];
}

export interface ApiUsageStats {
  totalSessions: number;
  sessionsThisWeek: number;
  totalTokens: number;
  userBreakdown: {
    id: string;
    firstName: string;
    sessionCount: number;
    totalTokens: number;
  }[];
}
