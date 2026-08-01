import { useState, useRef, useEffect, type KeyboardEvent, type DragEvent } from 'react';
import type { ChatFolder } from '../../../types';
import type { ConversationWithMeta } from '../../../lib/api';
import { ConversationItem } from './ConversationItem';
import { cn } from '../../../lib/utils';
import styles from './FolderItem.module.css';

export interface FolderItemProps {
  folder: ChatFolder;
  conversations: ConversationWithMeta[];
  activeConversationId?: string;
  isSubfolder?: boolean;
  onToggleCollapse: (id: string, collapsed: boolean) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onCreateSubfolder?: (parentId: string) => void;
  onConversationDrop: (conversationId: string, folderId: string) => void;
  onFolderDragStart: (e: DragEvent, folderId: string) => void;
  onFolderDragOver: (e: DragEvent) => void;
  onFolderDrop: (e: DragEvent, targetFolderId: string) => void;
  onConversationClick: (id: string) => void;
  onConversationStar: (id: string, starred: boolean) => void;
  onConversationRename: (id: string, title: string) => void;
  onConversationDelete: (id: string) => void;
  onConversationShare: (id: string) => void;
}

export function FolderItem({
  folder,
  conversations,
  activeConversationId,
  isSubfolder = false,
  onToggleCollapse,
  onRenameFolder,
  onDeleteFolder,
  onCreateSubfolder,
  onConversationDrop,
  onFolderDragStart,
  onFolderDragOver,
  onFolderDrop,
  onConversationClick,
  onConversationStar,
  onConversationRename,
  onConversationDelete,
  onConversationShare,
}: FolderItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(folder.name);
  const [isDropTarget, setIsDropTarget] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const folderConversations = conversations.filter(c => c.folderId === folder.id);
  const totalCount = folderConversations.length +
    (folder.children?.reduce((sum, child) =>
      sum + conversations.filter(c => c.folderId === child.id).length, 0) || 0);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleRenameSubmit = () => {
    if (editName.trim() && editName !== folder.name) {
      onRenameFolder(folder.id, editName.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleRenameSubmit();
    else if (e.key === 'Escape') { setIsEditing(false); setEditName(folder.name); }
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const types = e.dataTransfer.types;
    if (types.includes('conversation-id') || types.includes('folder-id')) {
      setIsDropTarget(true);
    }
  };

  const handleDragLeave = (e: DragEvent) => {
    e.stopPropagation();
    setIsDropTarget(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(false);

    const conversationId = e.dataTransfer.getData('conversation-id');
    if (conversationId) {
      onConversationDrop(conversationId, folder.id);
      return;
    }

    onFolderDrop(e, folder.id);
  };

  return (
    <div className={cn(styles.folder, isSubfolder && styles.subfolder)}>
      <div
        className={cn(
          styles.folderHeader,
          isDropTarget && styles.dropTarget,
        )}
        draggable
        onDragStart={(e) => onFolderDragStart(e, folder.id)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isEditing && onToggleCollapse(folder.id, !folder.isCollapsed)}
      >
        <span className={cn(styles.chevron, !folder.isCollapsed && styles.open)}>
          {'\u25B6'}
        </span>
        <span className={styles.folderIcon}>
          {folder.isCollapsed ? '\uD83D\uDCC1' : '\uD83D\uDCC2'}
        </span>

        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            className={styles.nameInput}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className={styles.folderName}>{folder.name}</span>
        )}

        {totalCount > 0 && (
          <span className={styles.folderCount}>{totalCount}</span>
        )}

        {!isEditing && (
          <div className={styles.folderActions} onClick={(e) => e.stopPropagation()}>
            <div className={styles.menuWrapper} ref={menuRef}>
              <button
                type="button"
                className={styles.folderAction}
                onClick={() => setMenuOpen(!menuOpen)}
                title="Folder options"
              >
                {'\u22EE'}
              </button>
              <div className={cn(styles.menu, menuOpen && styles.open)}>
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => { setMenuOpen(false); setIsEditing(true); setEditName(folder.name); }}
                >
                  {'\u270F'} Rename
                </button>
                {!isSubfolder && onCreateSubfolder && (
                  <button
                    type="button"
                    className={styles.menuItem}
                    onClick={() => { setMenuOpen(false); onCreateSubfolder(folder.id); }}
                  >
                    {'\uD83D\uDCC1'} Add subfolder
                  </button>
                )}
                <button
                  type="button"
                  className={cn(styles.menuItem, styles.danger)}
                  onClick={() => { setMenuOpen(false); onDeleteFolder(folder.id); }}
                >
                  {'\uD83D\uDDD1'} Delete folder
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className={cn(styles.folderChildren, folder.isCollapsed && styles.collapsed)}>
        {/* Direct conversations in this folder */}
        {folderConversations.map((conversation) => (
          <ConversationItem
            key={conversation.id}
            conversation={conversation}
            isActive={conversation.id === activeConversationId}
            onClick={() => onConversationClick(conversation.id)}
            onStar={(starred) => onConversationStar(conversation.id, starred)}
            onRename={(title) => onConversationRename(conversation.id, title)}
            onDelete={() => onConversationDelete(conversation.id)}
            onShare={() => onConversationShare(conversation.id)}
          />
        ))}

        {/* Subfolders */}
        {folder.children?.map((child) => (
          <FolderItem
            key={child.id}
            folder={child}
            conversations={conversations}
            activeConversationId={activeConversationId}
            isSubfolder
            onToggleCollapse={onToggleCollapse}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            onConversationDrop={onConversationDrop}
            onFolderDragStart={onFolderDragStart}
            onFolderDragOver={onFolderDragOver}
            onFolderDrop={onFolderDrop}
            onConversationClick={onConversationClick}
            onConversationStar={onConversationStar}
            onConversationRename={onConversationRename}
            onConversationDelete={onConversationDelete}
            onConversationShare={onConversationShare}
          />
        ))}
      </div>
    </div>
  );
}
