import { useState, useMemo, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConversationItem } from './ConversationItem';
import { FolderItem } from './FolderItem';
import { Button } from '../../ui/Button';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import {
  useConversations,
  useCreateConversation,
  useToggleStar,
  useUpdateConversation,
  useDeleteConversation,
  useFolders,
  useCreateFolder,
  useUpdateFolder,
  useReorderFolders,
  useDeleteFolder,
} from '../../../hooks';
import { toast } from '../../../stores';
import { cn } from '../../../lib/utils';
import styles from './ConversationList.module.css';

export interface ConversationListProps {
  activeConversationId?: string;
  onConversationSelect?: (id: string) => void;
  onNewChat?: () => void;
  onImport?: () => void;
  onShare?: (conversationId: string) => void;
  className?: string;
}

export function ConversationList({
  activeConversationId,
  onConversationSelect,
  onNewChat,
  onShare,
  className,
}: ConversationListProps) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');

  // Queries and mutations
  const { data: conversations, isLoading, error } = useConversations();
  const { data: folders } = useFolders();
  const createMutation = useCreateConversation();
  const toggleStarMutation = useToggleStar();
  const updateMutation = useUpdateConversation();
  const deleteMutation = useDeleteConversation();
  const createFolderMutation = useCreateFolder();
  const updateFolderMutation = useUpdateFolder();
  const reorderFoldersMutation = useReorderFolders();
  const deleteFolderMutation = useDeleteFolder();

  // Filter conversations by search
  const filteredConversations = useMemo(() => {
    if (!conversations) return [];
    if (!searchQuery.trim()) return conversations;

    const query = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(query) ||
        c.messages?.some((m) => m.content.toLowerCase().includes(query))
    );
  }, [conversations, searchQuery]);

  // Collect all folder IDs (including children) for filtering unfiled conversations
  const allFolderIds = useMemo(() => {
    if (!folders) return new Set<string>();
    const ids = new Set<string>();
    for (const f of folders) {
      ids.add(f.id);
      for (const child of f.children || []) {
        ids.add(child.id);
      }
    }
    return ids;
  }, [folders]);

  // Group unfiled conversations by date
  const groupedConversations = useMemo(() => {
    const unfiled = filteredConversations.filter(
      (c) => !c.folderId || !allFolderIds.has(c.folderId)
    );
    const starredOrImported = unfiled.filter((c) => c.starred || c.source);
    const rest = unfiled.filter((c) => !c.starred && !c.source);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);

    const todayItems = rest.filter((c) => new Date(c.updatedAt) >= today);
    const yesterdayItems = rest.filter(
      (c) => new Date(c.updatedAt) >= yesterday && new Date(c.updatedAt) < today
    );
    const lastWeekItems = rest.filter(
      (c) => new Date(c.updatedAt) >= lastWeek && new Date(c.updatedAt) < yesterday
    );
    const olderItems = rest.filter((c) => new Date(c.updatedAt) < lastWeek);

    return { starredOrImported, todayItems, yesterdayItems, lastWeekItems, olderItems };
  }, [filteredConversations, allFolderIds]);

  // Handlers
  const handleNewChat = async () => {
    if (onNewChat) {
      onNewChat();
    } else {
      try {
        const newConversation = await createMutation.mutateAsync(undefined);
        navigate(`/chat/${newConversation.id}`);
        toast.success('New chat created');
      } catch {
        toast.error('Failed to create chat');
      }
    }
  };

  const handleConversationClick = (id: string) => {
    if (onConversationSelect) {
      onConversationSelect(id);
    } else {
      navigate(`/chat/${id}`);
    }
  };

  const handleStar = async (id: string, starred: boolean) => {
    try {
      await toggleStarMutation.mutateAsync({ id, starred });
    } catch {
      toast.error('Failed to update star');
    }
  };

  const handleRename = async (id: string, title: string) => {
    try {
      await updateMutation.mutateAsync({ id, title });
      toast.success('Chat renamed');
    } catch {
      toast.error('Failed to rename chat');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success('Chat deleted');
      if (id === activeConversationId) {
        navigate('/chat');
      }
    } catch {
      toast.error('Failed to delete chat');
    }
  };

  const handleShareClick = (id: string) => {
    onShare?.(id);
  };

  const handleRemoveFromFolder = async (id: string) => {
    try {
      await updateMutation.mutateAsync({ id, folderId: null });
    } catch {
      toast.error('Failed to remove from folder');
    }
  };

  // Folder handlers
  const handleCreateFolder = async () => {
    try {
      await createFolderMutation.mutateAsync({ name: 'New Folder' });
    } catch {
      toast.error('Failed to create folder');
    }
  };

  const handleCreateSubfolder = async (parentId: string) => {
    try {
      await createFolderMutation.mutateAsync({ name: 'New Subfolder', parentId });
    } catch {
      toast.error('Failed to create subfolder');
    }
  };

  const handleToggleCollapse = async (id: string, collapsed: boolean) => {
    try {
      await updateFolderMutation.mutateAsync({ id, isCollapsed: collapsed });
    } catch {
      // Non-critical
    }
  };

  const handleRenameFolder = async (id: string, name: string) => {
    try {
      await updateFolderMutation.mutateAsync({ id, name });
    } catch {
      toast.error('Failed to rename folder');
    }
  };

  const handleDeleteFolder = async (id: string) => {
    try {
      await deleteFolderMutation.mutateAsync(id);
      toast.success('Folder deleted');
    } catch {
      toast.error('Failed to delete folder');
    }
  };

  const handleConversationDrop = async (conversationId: string, folderId: string) => {
    try {
      await updateMutation.mutateAsync({ id: conversationId, folderId });
    } catch {
      toast.error('Failed to move conversation');
    }
  };

  // Folder drag-and-drop for reordering
  const handleFolderDragStart = (e: DragEvent, folderId: string) => {
    e.dataTransfer.setData('folder-id', folderId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleFolderDragOver = (e: DragEvent) => {
    e.preventDefault();
  };

  const handleFolderDrop = async (e: DragEvent, targetFolderId: string) => {
    const draggedFolderId = e.dataTransfer.getData('folder-id');
    if (!draggedFolderId || draggedFolderId === targetFolderId || !folders) return;

    // Reorder: move dragged folder to position of target
    const topLevel = folders.map(f => f.id);
    const fromIdx = topLevel.indexOf(draggedFolderId);
    const toIdx = topLevel.indexOf(targetFolderId);
    if (fromIdx === -1 || toIdx === -1) return;

    const reordered = [...topLevel];
    reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, draggedFolderId);

    try {
      await reorderFoldersMutation.mutateAsync({ folderIds: reordered });
    } catch {
      toast.error('Failed to reorder folders');
    }
  };

  // Drop zone for unfiling conversations (drop on the list area outside folders)
  const handleListDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes('conversation-id')) {
      e.preventDefault();
    }
  };

  const handleListDrop = async (e: DragEvent) => {
    const conversationId = e.dataTransfer.getData('conversation-id');
    if (conversationId) {
      try {
        await updateMutation.mutateAsync({ id: conversationId, folderId: null });
      } catch {
        toast.error('Failed to remove from folder');
      }
    }
  };

  const renderSection = (title: string, items: typeof filteredConversations) => {
    if (items.length === 0) return null;

    return (
      <>
        <div className={styles.sectionHeader}>{title}</div>
        {items.map((conversation) => (
          <ConversationItem
            key={conversation.id}
            conversation={conversation}
            isActive={conversation.id === activeConversationId}
            onClick={() => handleConversationClick(conversation.id)}
            onStar={(starred) => handleStar(conversation.id, starred)}
            onRename={(title) => handleRename(conversation.id, title)}
            onDelete={() => handleDelete(conversation.id)}
            onShare={() => handleShareClick(conversation.id)}
            onRemoveFromFolder={
              conversation.folderId ? () => handleRemoveFromFolder(conversation.id) : undefined
            }
          />
        ))}
      </>
    );
  };

  if (error) {
    return (
      <div className={cn(styles.container, className)}>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>{'\u26A0'}</div>
          <h3 className={styles.emptyTitle}>Failed to load chats</h3>
          <p className={styles.emptyDescription}>Please try refreshing the page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(styles.container, className)}>
      {/* Action buttons */}
      <div className={styles.actions}>
        <Button
          variant="primary"
          className={styles.actionButton}
          onClick={handleNewChat}
          loading={createMutation.isPending}
        >
          + New Chat
        </Button>
        <Button variant="outline" onClick={handleCreateFolder} title="New Folder">
          {'\uD83D\uDCC1'}
        </Button>
      </div>

      {/* Search */}
      <div className={styles.search}>
        <input
          type="text"
          className={styles.searchInput}
          placeholder="Search conversations..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Conversation list */}
      <div
        className={styles.list}
        onDragOver={handleListDragOver}
        onDrop={handleListDrop}
      >
        {isLoading ? (
          <div className={styles.loading}>
            <LoadingSpinner size="lg" />
          </div>
        ) : filteredConversations.length === 0 && (!folders || folders.length === 0) ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>{'\u{1F4AC}'}</div>
            <h3 className={styles.emptyTitle}>
              {searchQuery ? 'No results found' : 'No conversations yet'}
            </h3>
            <p className={styles.emptyDescription}>
              {searchQuery
                ? 'Try a different search term'
                : 'Start a new chat to begin'}
            </p>
          </div>
        ) : (
          <>
            {/* Folders first */}
            {folders && folders.length > 0 && !searchQuery && (
              <>
                {folders.map((folder) => (
                  <FolderItem
                    key={folder.id}
                    folder={folder}
                    conversations={filteredConversations}
                    activeConversationId={activeConversationId}
                    onToggleCollapse={handleToggleCollapse}
                    onRenameFolder={handleRenameFolder}
                    onDeleteFolder={handleDeleteFolder}
                    onCreateSubfolder={handleCreateSubfolder}
                    onConversationDrop={handleConversationDrop}
                    onFolderDragStart={handleFolderDragStart}
                    onFolderDragOver={handleFolderDragOver}
                    onFolderDrop={handleFolderDrop}
                    onConversationClick={handleConversationClick}
                    onConversationStar={handleStar}
                    onConversationRename={handleRename}
                    onConversationDelete={handleDelete}
                    onConversationShare={handleShareClick}
                  />
                ))}
              </>
            )}

            {/* Unfiled conversations */}
            {renderSection('Starred & Imported', groupedConversations.starredOrImported)}
            {renderSection('Today', groupedConversations.todayItems)}
            {renderSection('Yesterday', groupedConversations.yesterdayItems)}
            {renderSection('Last 7 Days', groupedConversations.lastWeekItems)}
            {renderSection('Older', groupedConversations.olderItems)}
          </>
        )}
      </div>
    </div>
  );
}
