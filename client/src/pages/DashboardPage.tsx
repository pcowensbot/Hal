import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Avatar, ThemeToggle } from '../components/layout';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import {
  useLogout,
  useAdminStats,
  useAdminUsers,
  useToggleUserActive,
  useUpdateUser,
  useResetUserPassword,
  useAdminGroups,
  useCreateGroup,
  useDeleteGroup,
  useAddGroupMember,
  useRemoveGroupMember,
  useAdminRoles,
  useCreateRole,
  useDeleteRole,
  useAdminInvites,
  useCreateInvite,
  useDeactivateInvite,
  usePendingDeletions,
  useRestoreConversation,
  usePermanentlyDeleteConversation,
  useAllConversations,
  useModels,
  useDeleteModel,
  useLoadModel,
  useUnloadModel,
  useRunningModels,
  useDefaultModel,
  useSetDefaultModel,
  useApiUsage,
  useHardwareInfo,
  useLiveView,
} from '../hooks';
import { adminApi, ApiError } from '../lib/api';
import { useAuthStore, toast } from '../stores';
import { cn, formatTime } from '../lib/utils';
import type { User, Group, CustomRole, InviteCode, Conversation, Message } from '../types';
import styles from './DashboardPage.module.css';

type TabId = 'overview' | 'conversations' | 'deletions' | 'users' | 'groups' | 'roles' | 'invites' | 'system' | 'live';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '\u{1F4CA}' },
  { id: 'live', label: 'Live View', icon: '\u{1F4E1}' },
  { id: 'conversations', label: 'Conversations', icon: '\u{1F4AC}' },
  { id: 'deletions', label: 'Pending Deletions', icon: '\u{1F5D1}\u{FE0F}' },
  { id: 'users', label: 'Members', icon: '\u{1F465}' },
  { id: 'groups', label: 'Groups', icon: '\u{1F3E2}' },
  { id: 'roles', label: 'Roles', icon: '\u{1F6E1}\u{FE0F}' },
  { id: 'invites', label: 'Invite Codes', icon: '\u{2709}\u{FE0F}' },
  { id: 'system', label: 'System', icon: '\u{2699}\u{FE0F}' },
];

export function DashboardPage() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const logout = useLogout();
  const user = useAuthStore((state) => state.user);

  return (
    <div className={styles.layout}>
      {/* Mobile backdrop */}
      <div
        className={cn(styles.backdrop, sidebarOpen && styles.visible)}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Sidebar */}
      <aside className={cn(styles.sidebar, sidebarOpen && styles.open)}>
        <div className={styles.sidebarHeader}>
          <Link to="/chat" className={styles.logo}>HAL</Link>
          <div className={styles.headerActions}>
            <ThemeToggle />
          </div>
        </div>

        <div className={styles.navBar}>
          <Link to="/chat" className={styles.navIconLink} title="Chat">
            {'\u{1F4AC}'}
          </Link>
          <Link to="/knowledge" className={styles.navIconLink} title="Knowledge">
            {'\u{1F4DA}'}
          </Link>
          <Link to="/api" className={styles.navIconLink} title="API">
            {'\u{26A1}'}
          </Link>
          <div
            className={styles.navIconLink}
            onClick={() => navigate('/profile')}
            title={user?.firstName || 'Profile'}
          >
            <Avatar src={user?.avatar} name={user?.firstName} size="sm" />
          </div>
          <div
            className={styles.navIconLink}
            onClick={logout}
            title="Logout"
          >
            {'\u{1F6AA}'}
          </div>
        </div>

        <nav className={styles.nav}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={cn(styles.navItem, activeTab === tab.id && styles.active)}
              onClick={() => {
                setActiveTab(tab.id);
                setSidebarOpen(false);
              }}
            >
              <span className={styles.navIcon}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* Main content */}
      <main className={styles.main}>
        <header className={styles.mainHeader}>
          <div className={styles.mainHeaderLeft}>
            <button
              className={styles.mobileMenuBtn}
              onClick={() => setSidebarOpen(true)}
            >
              {'\u{2630}'}
            </button>
            <h1 className={styles.mainTitle}>
              {TABS.find((t) => t.id === activeTab)?.icon}{' '}
              {TABS.find((t) => t.id === activeTab)?.label}
            </h1>
          </div>
        </header>

        <div className={styles.content}>
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'live' && <LiveViewTab />}
          {activeTab === 'conversations' && <ConversationsTab />}
          {activeTab === 'deletions' && <DeletionsTab />}
          {activeTab === 'users' && <UsersTab />}
          {activeTab === 'groups' && <GroupsTab />}
          {activeTab === 'roles' && <RolesTab />}
          {activeTab === 'invites' && <InvitesTab />}
          {activeTab === 'system' && <SystemTab />}
        </div>
      </main>
    </div>
  );
}

// Overview Tab
function ApiUsageCard() {
  const { data, isLoading } = useApiUsage();

  if (isLoading) return <LoadingSpinner />;
  if (!data || data.totalSessions === 0) return null;

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>API Usage</h3>
      </div>
      <div className={styles.sectionBody}>
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <span className={styles.statIcon}>{'\u{26A1}'}</span>
            <div>
              <div className={styles.statValue}>{data.totalSessions}</div>
              <div className={styles.statLabel}>Total Sessions</div>
            </div>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statIcon}>{'\u{1F4C5}'}</span>
            <div>
              <div className={styles.statValue}>{data.sessionsThisWeek}</div>
              <div className={styles.statLabel}>Sessions This Week</div>
            </div>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statIcon}>{'\u{1F4CA}'}</span>
            <div>
              <div className={styles.statValue}>{data.totalTokens.toLocaleString()}</div>
              <div className={styles.statLabel}>Total Tokens</div>
            </div>
          </div>
        </div>
        {data.userBreakdown.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>User</th>
                <th>Sessions</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {data.userBreakdown.map((u) => (
                <tr key={u.id}>
                  <td>{u.firstName}</td>
                  <td>{u.sessionCount}</td>
                  <td>{u.totalTokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function OverviewTab() {
  const { data: stats, isLoading } = useAdminStats();

  if (isLoading) return <LoadingSpinner />;

  return (
    <>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statIcon}>{'\u{1F465}'}</span>
          <div>
            <div className={styles.statValue}>{stats?.totalUsers ?? '-'}</div>
            <div className={styles.statLabel}>Total Users</div>
          </div>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statIcon}>{'\u{1F4AC}'}</span>
          <div>
            <div className={styles.statValue}>{stats?.totalConversations ?? '-'}</div>
            <div className={styles.statLabel}>Conversations</div>
          </div>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statIcon}>{'\u{1F5D1}\u{FE0F}'}</span>
          <div>
            <div className={styles.statValue}>{stats?.pendingDeletions ?? '-'}</div>
            <div className={styles.statLabel}>Pending Deletions</div>
          </div>
        </div>
      </div>
      <ApiUsageCard />
    </>
  );
}

// Highlight search matches in text
function HighlightText({ text, search }: { text: string; search: string }) {
  if (!search) return <>{text}</>;
  const regex = new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);
  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className={styles.highlight}>{part}</mark>
        ) : (
          part
        )
      )}
    </>
  );
}

// Conversation Viewer Modal
function ConversationViewer({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [viewerSearch, setViewerSearch] = useState('');
  const [matchIndex, setMatchIndex] = useState(0);
  const matchRefs = useRef<(HTMLDivElement | null)[]>([]);
  const { data: conversation, isLoading } = useQuery({
    queryKey: ['admin', 'conversation', conversationId],
    queryFn: () => adminApi.getConversation(conversationId),
  });

  // Find which message indices match the search
  const matchingIndices = (conversation?.messages || [])
    .map((m: Message, i: number) => ({ i, matches: viewerSearch && m.content.toLowerCase().includes(viewerSearch.toLowerCase()) }))
    .filter((x) => x.matches)
    .map((x) => x.i);

  const totalMatches = matchingIndices.length;

  // Scroll to current match
  useEffect(() => {
    if (totalMatches > 0 && matchRefs.current[matchIndex]) {
      matchRefs.current[matchIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [matchIndex, totalMatches]);

  // Reset match index when search changes
  useEffect(() => {
    setMatchIndex(0);
    matchRefs.current = [];
  }, [viewerSearch]);

  // Scroll to bottom on initial load (no search)
  useEffect(() => {
    if (conversation?.messages && !viewerSearch) {
      messagesEndRef.current?.scrollIntoView();
    }
  }, [conversation?.messages, viewerSearch]);

  const title = conversation
    ? `${conversation.title || 'Untitled'} — ${conversation.user?.firstName || 'Unknown'}`
    : 'Loading...';

  const headerTitle = (
    <div className={styles.viewerHeader}>
      <div className={styles.viewerTitle}>{title}</div>
      <div className={styles.viewerSearchBar}>
        <Input
          value={viewerSearch}
          onChange={(e) => setViewerSearch(e.target.value)}
          placeholder="Search in conversation..."
        />
        {viewerSearch && totalMatches > 0 && (
          <div className={styles.viewerSearchNav}>
            <span className={styles.viewerMatchCount}>{matchIndex + 1}/{totalMatches}</span>
            <button
              className={styles.viewerNavBtn}
              onClick={() => setMatchIndex((matchIndex - 1 + totalMatches) % totalMatches)}
            >{'\u25B2'}</button>
            <button
              className={styles.viewerNavBtn}
              onClick={() => setMatchIndex((matchIndex + 1) % totalMatches)}
            >{'\u25BC'}</button>
          </div>
        )}
        {viewerSearch && totalMatches === 0 && (
          <span className={styles.viewerNoMatch}>No matches</span>
        )}
      </div>
    </div>
  );

  return (
    <Modal isOpen onClose={onClose} title={headerTitle} size="xl">
      {isLoading ? (
        <LoadingSpinner />
      ) : conversation?.messages && conversation.messages.length > 0 ? (
        <div className={styles.chatViewer}>
          {conversation.messages.map((m: Message, i: number) => {
            const matchPos = matchingIndices.indexOf(i);
            const isCurrentMatch = matchPos === matchIndex;
            return (
              <div
                key={m.id}
                ref={matchPos >= 0 ? (el) => { matchRefs.current[matchPos] = el; } : undefined}
                className={cn(
                  styles.chatMessage,
                  m.role === 'user' ? styles.chatUser : styles.chatAssistant,
                  isCurrentMatch && styles.chatMatchActive,
                )}
              >
                <div className={styles.chatRole}>
                  {m.role === 'user' ? conversation.user?.firstName || 'User' : 'HAL'}
                  <span className={styles.chatTime}>{formatTime(m.createdAt)}</span>
                </div>
                <div className={styles.chatContent}>
                  <HighlightText text={m.content} search={viewerSearch} />
                </div>
              </div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>
      ) : (
        <div className={styles.empty}>
          <p>No messages in this conversation</p>
        </div>
      )}
    </Modal>
  );
}

// Live View Tab
function LiveViewTab() {
  const { data, isLoading } = useLiveView();

  const timeAgo = (dateStr: string) => {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    return `${Math.floor(minutes / 60)}h ago`;
  };

  const statusBadge = (status: number) => {
    const color = status >= 200 && status < 300 ? 'var(--success)' : 'var(--error)';
    return <span style={{ color, fontWeight: 500 }}>{status}</span>;
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <>
      {/* Active Users */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>
            {data?.activeUsers?.length ? '\u{1F7E2}' : '\u{26AA}'} Active Users
            <span className={styles.liveCount}>{data?.activeUsers?.length || 0}</span>
          </h2>
          <span className={styles.livePulse}>Auto-refreshing every 10s</span>
        </div>
        <div className={styles.sectionBody}>
          {data?.activeUsers?.length ? (
            <div className={styles.liveUserGrid}>
              {data.activeUsers.map((u) => (
                <div key={u.id} className={styles.liveUserCard}>
                  <div className={styles.liveUserInfo}>
                    <Avatar src={u.avatar} name={u.firstName} size="sm" />
                    <div>
                      <div className={styles.liveUserName}>{u.firstName}</div>
                      <div className={styles.liveUserMeta}>
                        {u.activityType === 'api' ? 'API' : 'Chat'} — {timeAgo(u.lastActivity)}
                      </div>
                    </div>
                  </div>
                  <span className={styles.liveIndicator} />
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>No active users right now</div>
          )}
        </div>
      </section>

      {/* Recent Chat Activity */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{'\u{1F4AC}'} Recent Chat Activity</h2>
          <span className={styles.livePulse}>Last hour</span>
        </div>
        <div className={styles.sectionBody}>
          {data?.recentChats?.length ? (
            <div className={styles.liveActivityFeed}>
              {data.recentChats.map((msg) => (
                <div key={msg.id} className={styles.liveActivityRow}>
                  <div className={styles.liveActivityTime}>{timeAgo(msg.createdAt)}</div>
                  <Avatar src={msg.conversation.user.avatar} name={msg.conversation.user.firstName} size="sm" />
                  <div className={styles.liveActivityDetail}>
                    <span className={styles.liveActivityUser}>{msg.conversation.user.firstName}</span>
                    {msg.role === 'user' ? ' sent a message in ' : ' received a response in '}
                    <span className={styles.liveActivityConvo}>{msg.conversation.title}</span>
                    {msg.model && <span className={styles.liveActivityModel}>{msg.model}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.empty}>No chat activity in the last hour</div>
          )}
        </div>
      </section>

      {/* Recent API Activity */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{'\u{26A1}'} Recent API Activity</h2>
          <span className={styles.livePulse}>Last hour</span>
        </div>
        <div className={styles.sectionBody}>
          {data?.recentApiCalls?.length ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Device</th>
                  <th>Endpoint</th>
                  <th>Model</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>Tokens</th>
                </tr>
              </thead>
              <tbody>
                {data.recentApiCalls.map((call) => (
                  <tr key={call.id}>
                    <td>{timeAgo(call.createdAt)}</td>
                    <td>{call.device.user.firstName}</td>
                    <td>{call.device.name}</td>
                    <td><code>{call.method} {call.endpoint}</code></td>
                    <td>{call.model || '—'}</td>
                    <td>{statusBadge(call.status)}</td>
                    <td>{call.durationMs ? `${(call.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                    <td>{call.tokenCount || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.empty}>No API activity in the last hour</div>
          )}
        </div>
      </section>
    </>
  );
}

// Conversations Tab
function ConversationsTab() {
  const [userFilter, setUserFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [viewingId, setViewingId] = useState<string | null>(null);
  const { data: users } = useAdminUsers();

  const params: { userId?: string; search?: string } = {};
  if (userFilter) params.userId = userFilter;
  if (search) params.search = search;

  const { data: conversations, isLoading } = useAllConversations(
    Object.keys(params).length > 0 ? params : undefined
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
  };

  return (
    <>
      <div className={styles.filterBar}>
        <form onSubmit={handleSearch} className={styles.searchForm}>
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search conversations..."
          />
          <Button type="submit" variant="secondary" size="sm">Search</Button>
          {search && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSearchInput(''); setSearch(''); }}
            >
              Clear
            </Button>
          )}
        </form>
        <select
          className={styles.filterSelect}
          value={userFilter}
          onChange={(e) => setUserFilter(e.target.value)}
        >
          <option value="">All Users</option>
          {users?.map((u) => (
            <option key={u.id} value={u.id}>{u.firstName}</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <LoadingSpinner />
      ) : conversations && conversations.length > 0 ? (
        <section className={styles.section}>
          <div className={styles.sectionBody}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>User</th>
                  <th>Created</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((c: Conversation) => (
                  <tr key={c.id}>
                    <td>{c.title || 'Untitled'}</td>
                    <td>{c.user?.firstName || '-'}</td>
                    <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td>{new Date(c.updatedAt).toLocaleDateString()}</td>
                    <td className={styles.actions}>
                      <button
                        className={styles.viewBtn}
                        onClick={() => setViewingId(c.id)}
                        title="View conversation"
                      >
                        {'\u{1F441}'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>{'\u{1F4AC}'}</div>
          <p>No conversations found</p>
        </div>
      )}

      {viewingId && (
        <ConversationViewer
          conversationId={viewingId}
          onClose={() => setViewingId(null)}
        />
      )}
    </>
  );
}

// Pending Deletions Tab
function DeletionsTab() {
  const { data: deletions, isLoading } = usePendingDeletions();
  const restoreConversation = useRestoreConversation();
  const permanentlyDelete = usePermanentlyDeleteConversation();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmStep, setConfirmStep] = useState(0); // 0=none, 1=first confirm, 2=final confirm
  const [deleting, setDeleting] = useState(false);

  const allSelected = deletions && deletions.length > 0 && selected.size === deletions.length;

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setConfirmStep(0);
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(deletions?.map((c: Conversation) => c.id) || []));
    }
    setConfirmStep(0);
  };

  const handleRestore = async (id: string) => {
    try {
      await restoreConversation.mutateAsync(id);
      toast.success('Conversation restored');
      setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
    } catch {
      toast.error('Failed to restore conversation');
    }
  };

  const handlePermanentDelete = async (id: string) => {
    if (confirm('Permanently delete this conversation? This cannot be undone.')) {
      try {
        await permanentlyDelete.mutateAsync(id);
        toast.success('Conversation permanently deleted');
        setSelected((prev) => { const next = new Set(prev); next.delete(id); return next; });
      } catch {
        toast.error('Failed to delete conversation');
      }
    }
  };

  const handleDeleteSelected = async () => {
    if (confirmStep === 0) {
      setConfirmStep(1);
      return;
    }
    if (confirmStep === 1) {
      setConfirmStep(2);
      return;
    }
    // confirmStep === 2 — actually delete
    setDeleting(true);
    let successCount = 0;
    for (const id of selected) {
      try {
        await permanentlyDelete.mutateAsync(id);
        successCount++;
      } catch {
        // continue with remaining
      }
    }
    toast.success(`Permanently deleted ${successCount} conversation${successCount !== 1 ? 's' : ''}`);
    setSelected(new Set());
    setConfirmStep(0);
    setDeleting(false);
  };

  if (isLoading) return <LoadingSpinner />;

  if (!deletions || deletions.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>{'\u{2705}'}</div>
        <p>No pending deletions</p>
      </div>
    );
  }

  return (
    <>
      {selected.size > 0 && (
        <div className={styles.bulkActions}>
          <span>{selected.size} selected</span>
          {confirmStep === 0 && (
            <Button size="sm" variant="danger" onClick={handleDeleteSelected} disabled={deleting}>
              Delete Selected
            </Button>
          )}
          {confirmStep === 1 && (
            <Button size="sm" variant="danger" onClick={handleDeleteSelected} disabled={deleting}>
              Are you sure? Click again to confirm
            </Button>
          )}
          {confirmStep === 2 && (
            <Button size="sm" variant="danger" onClick={handleDeleteSelected} disabled={deleting}>
              {deleting ? 'Deleting...' : 'FINAL CONFIRM — Delete permanently'}
            </Button>
          )}
          {confirmStep > 0 && !deleting && (
            <Button size="sm" variant="ghost" onClick={() => setConfirmStep(0)}>
              Cancel
            </Button>
          )}
        </div>
      )}
      <section className={styles.section}>
        <div className={styles.sectionBody}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: '2rem' }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    style={{ accentColor: 'var(--primary)' }}
                  />
                </th>
                <th>Title</th>
                <th>User</th>
                <th>Deleted</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {deletions.map((c: Conversation) => (
                <tr key={c.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleSelect(c.id)}
                      style={{ accentColor: 'var(--primary)' }}
                    />
                  </td>
                  <td>{c.title || 'Untitled'}</td>
                  <td>{c.user?.firstName || '-'}</td>
                  <td>{c.deletedAt ? new Date(c.deletedAt).toLocaleDateString() : '-'}</td>
                  <td className={styles.actions}>
                    <Button size="sm" variant="secondary" onClick={() => handleRestore(c.id)}>
                      Restore
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => handlePermanentDelete(c.id)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// Users Tab
function UsersTab() {
  const { data: users, isLoading } = useAdminUsers();
  const { data: roles } = useAdminRoles();
  const toggleActive = useToggleUserActive();
  const updateUser = useUpdateUser();
  const resetPassword = useResetUserPassword();

  const [editUser, setEditUser] = useState<User | null>(null);
  const [editRoleId, setEditRoleId] = useState('');
  const [resetPwUser, setResetPwUser] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleToggleActive = async (user: User) => {
    try {
      await toggleActive.mutateAsync({ id: user.id, isActive: !user.isActive });
      toast.success(user.isActive ? 'User disabled' : 'User enabled');
    } catch {
      toast.error('Failed to update user status');
    }
  };

  const generatePassword = () => {
    const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%';
    let pw = '';
    for (let i = 0; i < 12; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    setNewPassword(pw);
    setShowPassword(true);
  };

  const handleResetPassword = async () => {
    if (!resetPwUser || newPassword.length < 6) return;
    try {
      await resetPassword.mutateAsync({ id: resetPwUser.id, newPassword });
      toast.success(`Password reset for ${resetPwUser.firstName}`);
      setResetPwUser(null);
      setNewPassword('');
      setShowPassword(false);
    } catch {
      toast.error('Failed to reset password');
    }
  };

  const handleEditUser = (user: User) => {
    setEditUser(user);
    setEditRoleId(user.roleId || '');
  };

  const handleSaveUser = async () => {
    if (!editUser) return;
    if (!editRoleId) {
      toast.error('Select a role for the user');
      return;
    }
    try {
      await updateUser.mutateAsync({ id: editUser.id, roleId: editRoleId });
      toast.success('User updated');
      setEditUser(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to update user');
    }
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionBody}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users?.map((u) => (
                <tr key={u.id}>
                  <td>{u.firstName}</td>
                  <td>{u.email}</td>
                  <td>
                    {u.customRole && (
                      <span
                        className={styles.colorDot}
                        style={{ backgroundColor: u.customRole.color || '#888' }}
                      />
                    )}
                    {u.customRole?.name || u.role}
                  </td>
                  <td>
                    <span className={cn(styles.badge, u.isActive ? styles.badgeSuccess : styles.badgeError)}>
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className={styles.actions}>
                    <Button size="sm" variant="ghost" onClick={() => handleEditUser(u)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setResetPwUser(u); setNewPassword(''); setShowPassword(false); }}>
                      Reset PW
                    </Button>
                    <Button
                      size="sm"
                      variant={u.isActive ? 'danger' : 'primary'}
                      onClick={() => handleToggleActive(u)}
                    >
                      {u.isActive ? 'Disable' : 'Enable'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Edit User Modal */}
      <Modal
        isOpen={!!editUser}
        onClose={() => setEditUser(null)}
        title={`Edit User: ${editUser?.firstName}`}
        footer={
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button variant="primary" onClick={handleSaveUser}>Save</Button>
          </div>
        }
      >
        <div style={{ marginBottom: 'var(--spacing-md)' }}>
          <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500 }}>Role</label>
          <select
            className={styles.filterSelect}
            value={editRoleId}
            onChange={(e) => setEditRoleId(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">Select a role…</option>
            {roles?.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        isOpen={!!resetPwUser}
        onClose={() => { setResetPwUser(null); setNewPassword(''); setShowPassword(false); }}
        title={`Reset Password: ${resetPwUser?.firstName}`}
        size="sm"
        footer={
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => { setResetPwUser(null); setNewPassword(''); setShowPassword(false); }}>Cancel</Button>
            <Button variant="primary" onClick={handleResetPassword} disabled={newPassword.length < 6}>Save</Button>
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500 }}>New Password</label>
            <div style={{ display: 'flex', gap: 'var(--spacing-sm)' }}>
              <Input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 6 characters"
                style={{ flex: 1 }}
              />
              <Button size="sm" variant="ghost" onClick={() => setShowPassword(!showPassword)}>
                {showPassword ? 'Hide' : 'Show'}
              </Button>
            </div>
          </div>
          <Button variant="secondary" onClick={generatePassword}>
            Generate Random Password
          </Button>
          {newPassword.length > 0 && newPassword.length < 6 && (
            <p style={{ color: 'var(--error)', fontSize: 'var(--text-sm)', margin: 0 }}>
              Password must be at least 6 characters
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

// Groups Tab
function GroupsTab() {
  const { data: groups, isLoading } = useAdminGroups();
  const { data: users } = useAdminUsers();
  const createGroup = useCreateGroup();
  const deleteGroup = useDeleteGroup();
  const addMember = useAddGroupMember();
  const removeMember = useRemoveGroupMember();

  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupColor, setNewGroupColor] = useState('#3b82f6');
  const [newGroupDescription, setNewGroupDescription] = useState('');

  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [addUserId, setAddUserId] = useState('');
  const [addAsAdmin, setAddAsAdmin] = useState(false);

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      await createGroup.mutateAsync({
        name: newGroupName.trim(),
        color: newGroupColor,
        description: newGroupDescription.trim() || undefined,
      });
      toast.success('Group created');
      setNewGroupName('');
      setNewGroupDescription('');
    } catch {
      toast.error('Failed to create group');
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (confirm('Delete this group?')) {
      try {
        await deleteGroup.mutateAsync(id);
        toast.success('Group deleted');
      } catch {
        toast.error('Failed to delete group');
      }
    }
  };

  const handleAddMember = async () => {
    if (!selectedGroup || !addUserId) return;
    try {
      await addMember.mutateAsync({
        groupId: selectedGroup.id,
        userId: addUserId,
        isGroupAdmin: addAsAdmin,
      });
      toast.success('Member added');
      setAddUserId('');
      setAddAsAdmin(false);
    } catch {
      toast.error('Failed to add member');
    }
  };

  const handleRemoveMember = async (groupId: string, userId: string) => {
    try {
      await removeMember.mutateAsync({ groupId, userId });
      toast.success('Member removed');
    } catch {
      toast.error('Failed to remove member');
    }
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <>
      {/* Create group form */}
      <div className={styles.formSection}>
        <h3 className={styles.formTitle}>Create New Group</h3>
        <div className={styles.formRow}>
          <Input
            label="Group Name"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder="e.g., Marketing Team"
          />
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500, fontSize: 'var(--text-sm)' }}>Color</label>
            <input
              type="color"
              value={newGroupColor}
              onChange={(e) => setNewGroupColor(e.target.value)}
              className={styles.colorInput}
            />
          </div>
        </div>
        <Input
          label="Description (optional)"
          value={newGroupDescription}
          onChange={(e) => setNewGroupDescription(e.target.value)}
          placeholder="Brief description"
        />
        <div className={styles.formActions}>
          <Button variant="primary" onClick={handleCreateGroup} disabled={createGroup.isPending}>
            Create Group
          </Button>
        </div>
      </div>

      {/* Groups list */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Existing Groups</h2>
        </div>
        <div className={styles.sectionBody}>
          {groups && groups.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Members</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <span className={styles.colorDot} style={{ backgroundColor: g.color || '#888' }} />
                      {g.name}
                    </td>
                    <td>{g.members?.length || 0}</td>
                    <td>{new Date(g.createdAt).toLocaleDateString()}</td>
                    <td className={styles.actions}>
                      <Button size="sm" variant="ghost" onClick={() => setSelectedGroup(g)}>
                        Manage
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => handleDeleteGroup(g.id)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.empty}>No groups yet</div>
          )}
        </div>
      </section>

      {/* Group Details Modal */}
      <Modal
        isOpen={!!selectedGroup}
        onClose={() => setSelectedGroup(null)}
        title={`Group: ${selectedGroup?.name}`}
        size="lg"
      >
        <h4 style={{ marginBottom: 'var(--spacing-md)' }}>Members</h4>
        {selectedGroup?.members && selectedGroup.members.length > 0 ? (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>User</th>
                <th>Admin</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {selectedGroup.members.map((m: { userId: string; user?: User; isGroupAdmin: boolean }) => (
                <tr key={m.userId}>
                  <td>{m.user?.firstName || m.userId}</td>
                  <td>{m.isGroupAdmin ? 'Yes' : 'No'}</td>
                  <td>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleRemoveMember(selectedGroup.id, m.userId)}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--spacing-md)' }}>No members yet</p>
        )}

        <h4 style={{ marginTop: 'var(--spacing-lg)', marginBottom: 'var(--spacing-md)' }}>Add Member</h4>
        <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'flex-end' }}>
          <select
            className={styles.filterSelect}
            value={addUserId}
            onChange={(e) => setAddUserId(e.target.value)}
          >
            <option value="">Select user...</option>
            {users?.filter((u) => !selectedGroup?.members?.some((m: { userId: string }) => m.userId === u.id)).map((u) => (
              <option key={u.id} value={u.id}>{u.firstName}</option>
            ))}
          </select>
          <label className={styles.permissionToggle}>
            <input
              type="checkbox"
              checked={addAsAdmin}
              onChange={(e) => setAddAsAdmin(e.target.checked)}
            />
            Group Admin
          </label>
          <Button variant="primary" size="sm" onClick={handleAddMember}>Add</Button>
        </div>
      </Modal>
    </>
  );
}

// Roles Tab
function RolesTab() {
  const { data: roles, isLoading } = useAdminRoles();
  const createRole = useCreateRole();
  const deleteRole = useDeleteRole();

  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleColor, setNewRoleColor] = useState('#6b7280');
  const [permissions, setPermissions] = useState({
    canManageUsers: false,
    canManageGroups: false,
    canManageRoles: false,
    canViewAllConvos: false,
    canManageSystem: false,
    canCreateInvites: false,
    canDeleteConvos: false,
  });

  const handleCreateRole = async () => {
    if (!newRoleName.trim()) return;
    try {
      await createRole.mutateAsync({
        name: newRoleName.trim(),
        color: newRoleColor,
        ...permissions,
      });
      toast.success('Role created');
      setNewRoleName('');
      setPermissions({
        canManageUsers: false,
        canManageGroups: false,
        canManageRoles: false,
        canViewAllConvos: false,
        canManageSystem: false,
        canCreateInvites: false,
        canDeleteConvos: false,
      });
    } catch {
      toast.error('Failed to create role');
    }
  };

  const handleDeleteRole = async (id: string) => {
    if (confirm('Delete this role?')) {
      try {
        await deleteRole.mutateAsync(id);
        toast.success('Role deleted');
      } catch {
        toast.error('Failed to delete role');
      }
    }
  };

  const togglePermission = (key: keyof typeof permissions) => {
    setPermissions((p) => ({ ...p, [key]: !p[key] }));
  };

  if (isLoading) return <LoadingSpinner />;

  const permissionLabels: Record<string, string> = {
    canManageUsers: 'Manage Users',
    canManageGroups: 'Manage Groups',
    canManageRoles: 'Manage Roles',
    canViewAllConvos: 'View All Conversations',
    canManageSystem: 'System Admin',
    canCreateInvites: 'Create Invites',
    canDeleteConvos: 'Delete Conversations',
  };

  return (
    <>
      {/* Create role form */}
      <div className={styles.formSection}>
        <h3 className={styles.formTitle}>Create New Role</h3>
        <div className={styles.formRow}>
          <Input
            label="Role Name"
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder="e.g., Team Lead"
          />
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500, fontSize: 'var(--text-sm)' }}>Color</label>
            <input
              type="color"
              value={newRoleColor}
              onChange={(e) => setNewRoleColor(e.target.value)}
              className={styles.colorInput}
            />
          </div>
        </div>

        <label style={{ display: 'block', marginBottom: 'var(--spacing-sm)', fontWeight: 500, fontSize: 'var(--text-sm)' }}>Permissions</label>
        <div className={styles.permissionsGrid}>
          {Object.entries(permissionLabels).map(([key, label]) => (
            <label key={key} className={styles.permissionToggle}>
              <input
                type="checkbox"
                checked={permissions[key as keyof typeof permissions]}
                onChange={() => togglePermission(key as keyof typeof permissions)}
              />
              {label}
            </label>
          ))}
        </div>

        <div className={styles.formActions}>
          <Button variant="primary" onClick={handleCreateRole} disabled={createRole.isPending}>
            Create Role
          </Button>
        </div>
      </div>

      {/* Roles list */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Existing Roles</h2>
        </div>
        <div className={styles.sectionBody}>
          {roles && roles.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Permissions</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <span className={styles.colorDot} style={{ backgroundColor: r.color || '#888' }} />
                      {r.name}
                    </td>
                    <td>
                      {Object.entries(permissionLabels)
                        .filter(([key]) => r[key as keyof CustomRole])
                        .map(([, label]) => label)
                        .join(', ') || 'None'}
                    </td>
                    <td className={styles.actions}>
                      <Button size="sm" variant="danger" onClick={() => handleDeleteRole(r.id)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.empty}>No custom roles yet</div>
          )}
        </div>
      </section>
    </>
  );
}

// Invites Tab
function InvitesTab() {
  const { data: invites, isLoading } = useAdminInvites();
  const { data: roles } = useAdminRoles();
  const { data: groups } = useAdminGroups();
  const createInvite = useCreateInvite();
  const deactivateInvite = useDeactivateInvite();

  const [roleId, setRoleId] = useState('');
  const [groupId, setGroupId] = useState('');
  const [makeGroupAdmin, setMakeGroupAdmin] = useState(false);
  const [expireDays, setExpireDays] = useState('');
  const [newCode, setNewCode] = useState<string | null>(null);

  const handleCreateInvite = async () => {
    if (!roleId) {
      toast.error('Select a role for the invite');
      return;
    }

    try {
      const result = await createInvite.mutateAsync({
        roleId,
        groupId: groupId || undefined,
        makeGroupAdmin: groupId ? makeGroupAdmin : undefined,
        expiresInDays: expireDays ? parseInt(expireDays) : undefined,
      });

      toast.success('Invite code created');
      setNewCode(result.code);
      setRoleId('');
      setGroupId('');
      setMakeGroupAdmin(false);
      setExpireDays('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to create invite code');
    }
  };

  const handleDeactivate = async (id: string) => {
    try {
      await deactivateInvite.mutateAsync(id);
      toast.success('Invite deactivated');
    } catch {
      toast.error('Failed to deactivate invite');
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
  };

  if (isLoading) return <LoadingSpinner />;

  return (
    <>
      {/* Create invite form */}
      <div className={styles.formSection}>
        <h3 className={styles.formTitle}>Generate New Invite Code</h3>

        {newCode && (
          <div className={cn(styles.message, styles.messageSuccess)}>
            New code: <code className={styles.code}>{newCode}</code>
            <Button size="sm" variant="ghost" onClick={() => copyCode(newCode)} style={{ marginLeft: 'var(--spacing-sm)' }}>
              Copy
            </Button>
          </div>
        )}

        <div className={styles.formRow}>
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500, fontSize: 'var(--text-sm)' }}>Role Assignment</label>
            <select
              className={styles.filterSelect}
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">Select a role…</option>
              {roles?.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontWeight: 500, fontSize: 'var(--text-sm)' }}>Auto-Join Group</label>
            <select
              className={styles.filterSelect}
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">No group</option>
              {groups?.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        </div>

        {groupId && (
          <label className={styles.permissionToggle} style={{ marginBottom: 'var(--spacing-md)' }}>
            <input
              type="checkbox"
              checked={makeGroupAdmin}
              onChange={(e) => setMakeGroupAdmin(e.target.checked)}
            />
            Make Group Admin
          </label>
        )}

        <Input
          label="Expires In (days, optional)"
          type="number"
          value={expireDays}
          onChange={(e) => setExpireDays(e.target.value)}
          placeholder="Leave empty for no expiration"
        />

        <div className={styles.formActions}>
          <Button variant="primary" onClick={handleCreateInvite} disabled={createInvite.isPending}>
            Generate Code
          </Button>
        </div>
      </div>

      {/* Invites list */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Invite Codes</h2>
        </div>
        <div className={styles.sectionBody}>
          {invites && invites.length > 0 ? (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Role</th>
                  <th>Group</th>
                  <th>Status</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i: InviteCode) => (
                  <tr key={i.id}>
                    <td><code className={styles.code}>{i.code}</code></td>
                    <td>{i.assignedRole?.name || 'Default'}</td>
                    <td>{i.assignedGroup?.name || '-'}</td>
                    <td>
                      <span className={cn(
                        styles.badge,
                        i.usedAt ? styles.badgeDefault : i.isActive ? styles.badgeSuccess : styles.badgeError
                      )}>
                        {i.usedAt ? 'Used' : i.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{i.expiresAt ? new Date(i.expiresAt).toLocaleDateString() : 'Never'}</td>
                    <td className={styles.actions}>
                      <Button size="sm" variant="ghost" onClick={() => copyCode(i.code)}>
                        Copy
                      </Button>
                      {i.isActive && !i.usedAt && (
                        <Button size="sm" variant="danger" onClick={() => handleDeactivate(i.id)}>
                          Deactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className={styles.empty}>No invite codes yet</div>
          )}
        </div>
      </section>
    </>
  );
}

// System Tab
function SystemTab() {
  const { data: models, isLoading: modelsLoading } = useModels();
  const { data: runningModels } = useRunningModels();
  const { data: defaultModelData } = useDefaultModel();
  const setDefaultModel = useSetDefaultModel();
  const { data: hardware, isLoading: hwLoading } = useHardwareInfo();
  const deleteModel = useDeleteModel();
  const loadModel = useLoadModel();
  const unloadModel = useUnloadModel();

  const currentDefault = defaultModelData?.defaultModel || '';
  const runningNames = new Set((runningModels || []).map((m: { name: string }) => m.name));

  const handleDeleteModel = async (name: string) => {
    if (confirm(`Delete model "${name}"?`)) {
      try {
        await deleteModel.mutateAsync(name);
        toast.success(`Model "${name}" deleted`);
      } catch {
        toast.error(`Failed to delete model`);
      }
    }
  };

  const handleLoadModel = async (name: string) => {
    try {
      toast.success(`Loading ${name}...`);
      await loadModel.mutateAsync(name);
      toast.success(`Model "${name}" loaded into memory`);
    } catch {
      toast.error(`Failed to load model "${name}"`);
    }
  };

  const handleUnloadModel = async (name: string) => {
    try {
      await unloadModel.mutateAsync(name);
      toast.success(`Model "${name}" unloaded from memory`);
    } catch {
      toast.error(`Failed to unload model "${name}"`);
    }
  };

  const handleSetDefault = async (name: string) => {
    try {
      await setDefaultModel.mutateAsync(name);
      toast.success(`Default model set to "${name}"`);
    } catch {
      toast.error('Failed to set default model');
    }
  };

  const formatMB = (mb: number) => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${mb} MB`;
  };

  const formatBytes = (bytes: number) => {
    const gb = bytes / 1024 / 1024 / 1024;
    return `${gb.toFixed(1)} GB`;
  };

  return (
    <>
      {/* Hardware Status */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{'\u{2699}\u{FE0F}'} Hardware Status</h2>
        </div>
        <div className={styles.sectionBody}>
          {hwLoading ? (
            <LoadingSpinner />
          ) : hardware ? (
            <div className={styles.gpuGrid}>
              {/* CPU */}
              {hardware.cpu?.model && (
                <div className={styles.gpuCard}>
                  <div className={styles.gpuName}>{'\u{1F4BB}'} CPU</div>
                  <div className={styles.gpuStat}>
                    <span>Model</span>
                    <span>{hardware.cpu.model}</span>
                  </div>
                  <div className={styles.gpuStat}>
                    <span>Cores</span>
                    <span>{hardware.cpu.cores}</span>
                  </div>
                </div>
              )}

              {/* RAM */}
              {hardware.ram?.total > 0 && (
                <div className={styles.gpuCard}>
                  <div className={styles.gpuName}>{'\u{1F4BE}'} Memory</div>
                  <div className={styles.gpuStat}>
                    <span>Total</span>
                    <span>{formatMB(hardware.ram.total)}</span>
                  </div>
                  <div className={styles.gpuStat}>
                    <span>Available</span>
                    <span>{formatMB(hardware.ram.available)}</span>
                  </div>
                  <div className={styles.progressBar}>
                    <div
                      className={styles.progressFill}
                      style={{ width: `${Math.round(((hardware.ram.total - hardware.ram.available) / hardware.ram.total) * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* GPUs */}
              {hardware.gpus && hardware.gpus.length > 0 ? (
                hardware.gpus.map((gpu, i) => {
                  const usedMB = gpu.vramTotal - gpu.vramFree;
                  const utilPct = gpu.vramTotal > 0 ? Math.round((usedMB / gpu.vramTotal) * 100) : 0;
                  const temp = gpu.temperature;
                  const tempColor = temp != null
                    ? temp >= 85 ? 'var(--error)' : temp >= 70 ? 'var(--warning, #f59e0b)' : 'var(--success)'
                    : undefined;
                  const tempPct = temp != null ? Math.min(100, Math.round((temp / 100) * 100)) : 0;
                  return (
                    <div key={gpu.id ?? i} className={styles.gpuCard}>
                      <div className={styles.gpuName}>{'\u{1F5B3}\u{FE0F}'} {gpu.name}</div>
                      {temp != null && (
                        <div className={styles.tempGauge}>
                          <div className={styles.tempLabel}>
                            <span>{'\u{1F321}\u{FE0F}'} Temperature</span>
                            <span style={{ color: tempColor, fontWeight: 600 }}>{temp}°C</span>
                          </div>
                          <div className={styles.progressBar}>
                            <div
                              className={styles.progressFill}
                              style={{ width: `${tempPct}%`, background: tempColor }}
                            />
                          </div>
                        </div>
                      )}
                      <div className={styles.gpuStat}>
                        <span>VRAM Total</span>
                        <span>{formatMB(gpu.vramTotal)}</span>
                      </div>
                      <div className={styles.gpuStat}>
                        <span>VRAM Free</span>
                        <span>{formatMB(gpu.vramFree)}</span>
                      </div>
                      <div className={styles.progressBar}>
                        <div
                          className={styles.progressFill}
                          style={{ width: `${utilPct}%` }}
                        />
                      </div>
                      <div className={styles.gpuStat}>
                        <span>VRAM Usage</span>
                        <span>{utilPct}%</span>
                      </div>
                      {gpu.powerDraw != null && (
                        <div className={styles.gpuStat}>
                          <span>Power Draw</span>
                          <span>{gpu.powerDraw.toFixed(0)} W</span>
                        </div>
                      )}
                      {gpu.fanSpeed != null && gpu.fanSpeed > 0 && (
                        <div className={styles.gpuStat}>
                          <span>Fan Speed</span>
                          <span>{gpu.fanSpeed}%</span>
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className={styles.gpuCard}>
                  <div className={styles.gpuName}>{'\u{1F5B3}\u{FE0F}'} GPU</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No GPU detected</div>
                </div>
              )}
            </div>
          ) : (
            <div className={styles.empty}>No hardware information available</div>
          )}
        </div>
      </section>

      {/* Active Model */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{'\u{1F3AF}'} Active Model</h2>
        </div>
        <div className={styles.sectionBody}>
          <div className={styles.activeModelRow}>
            <div>
              <div className={styles.activeModelLabel}>Default Model</div>
              <div className={styles.activeModelName}>{currentDefault || 'Not set'}</div>
            </div>
            <select
              className={styles.filterSelect}
              value={currentDefault}
              onChange={(e) => handleSetDefault(e.target.value)}
              disabled={setDefaultModel.isPending}
            >
              {models?.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </select>
          </div>
          {runningModels && runningModels.length > 0 ? (
            <div className={styles.runningModels}>
              <div className={styles.runningLabel}>Loaded in memory</div>
              {runningModels.map((m: { name: string; size: number; expires_at: string }) => (
                <div key={m.name} className={styles.runningModel}>
                  <span className={styles.runningDot} />
                  <span>{m.name}</span>
                  <span className={styles.runningMeta}>{formatBytes(m.size)}</span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleUnloadModel(m.name)}
                    disabled={unloadModel.isPending}
                  >
                    Unload
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.runningModels}>
              <div className={styles.runningLabel}>Loaded in memory</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No models currently loaded — models load on first chat request</div>
            </div>
          )}
        </div>
      </section>

      {/* Installed Models */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{'\u{1F916}'} Installed Models</h2>
        </div>
        <div className={styles.sectionBody}>
          {modelsLoading ? (
            <LoadingSpinner />
          ) : models && models.length > 0 ? (
            models.map((model) => (
              <div key={model.name} className={styles.modelCard}>
                <div className={styles.modelInfo}>
                  <div className={styles.modelName}>
                    {model.name}
                    {runningNames.has(model.name) && (
                      <span className={cn(styles.badge, styles.badgeSuccess)} style={{ marginLeft: 'var(--spacing-sm)' }}>Running</span>
                    )}
                    {model.name === currentDefault && (
                      <span className={cn(styles.badge, styles.badgeDefault)} style={{ marginLeft: 'var(--spacing-sm)' }}>Default</span>
                    )}
                  </div>
                  <div className={styles.modelMeta}>
                    Size: {formatBytes(model.size)} | Modified: {new Date(model.modified_at).toLocaleDateString()}
                  </div>
                </div>
                <div className={styles.actions}>
                  {runningNames.has(model.name) ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleUnloadModel(model.name)}
                      disabled={unloadModel.isPending}
                    >
                      Unload
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => handleLoadModel(model.name)}
                      disabled={loadModel.isPending}
                    >
                      Load
                    </Button>
                  )}
                  {model.name !== currentDefault && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleSetDefault(model.name)}
                      disabled={setDefaultModel.isPending}
                    >
                      Set Default
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => handleDeleteModel(model.name)}
                    disabled={deleteModel.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className={styles.empty}>No models installed</div>
          )}
        </div>
      </section>
    </>
  );
}
