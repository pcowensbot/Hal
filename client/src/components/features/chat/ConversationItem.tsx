import { useState, useRef, useEffect, type KeyboardEvent, type DragEvent } from 'react';
import { formatRelativeDate, cn } from '../../../lib/utils';
import type { ConversationWithMeta } from '../../../lib/api';
import styles from './ConversationItem.module.css';

export interface ConversationItemProps {
  conversation: ConversationWithMeta;
  isActive?: boolean;
  onClick?: () => void;
  onStar?: (starred: boolean) => void;
  onRename?: (title: string) => void;
  onDelete?: () => void;
  onShare?: () => void;
  onRemoveFromFolder?: () => void;
}

export function ConversationItem({
  conversation,
  isActive = false,
  onClick,
  onStar,
  onRename,
  onDelete,
  onShare,
  onRemoveFromFolder,
}: ConversationItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conversation.title);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get preview from last message
  const lastMessage = conversation.messages?.[conversation.messages.length - 1];
  const preview = lastMessage?.content?.slice(0, 50) || 'No messages yet';

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  // Focus input when editing
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStarClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStar?.(!conversation.starred);
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen(!menuOpen);
  };

  const handleRenameClick = () => {
    setMenuOpen(false);
    setIsEditing(true);
    setEditTitle(conversation.title);
  };

  const handleRenameSubmit = () => {
    if (editTitle.trim() && editTitle !== conversation.title) {
      onRename?.(editTitle.trim());
    }
    setIsEditing(false);
  };

  const handleRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleRenameSubmit();
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditTitle(conversation.title);
    }
  };

  const handleDeleteClick = () => {
    setMenuOpen(false);
    onDelete?.();
  };

  const handleShareClick = () => {
    setMenuOpen(false);
    onShare?.();
  };

  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('conversation-id', conversation.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      className={cn(
        styles.item,
        isActive && styles.active,
        conversation.isShared && styles.shared
      )}
      draggable={!isEditing && conversation.isOwned}
      onDragStart={handleDragStart}
      onClick={isEditing ? undefined : onClick}
    >
      {conversation.starred && (
        <span className={styles.starIndicator}>{'\u2605'}</span>
      )}
      {!conversation.starred && conversation.source && (
        <span className={styles.importIndicator}>{'\u2B07'}</span>
      )}

      <div className={styles.content}>
        <div className={styles.titleRow}>
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              className={styles.titleInput}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleRenameSubmit}
              onKeyDown={handleRenameKeyDown}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              <span className={styles.title}>{conversation.title}</span>
              {conversation.source && (
                <span className={styles.importBadge}>{conversation.source}</span>
              )}
              {conversation.isShared && (
                <span className={styles.sharedBadge}>Shared</span>
              )}
            </>
          )}
        </div>
        <div className={styles.meta}>
          <span className={styles.preview}>{preview}</span>
          <span className={styles.date}>
            {formatRelativeDate(conversation.updatedAt)}
          </span>
        </div>
      </div>

      {!isEditing && conversation.isOwned && (
        <div className={styles.actions}>
          <button
            type="button"
            className={cn(styles.actionButton, conversation.starred && styles.starred)}
            onClick={handleStarClick}
            title={conversation.starred ? 'Unstar' : 'Star'}
          >
            {conversation.starred ? '\u2605' : '\u2606'}
          </button>

          <div className={styles.menuWrapper} ref={menuRef}>
            <button
              type="button"
              className={styles.actionButton}
              onClick={handleMenuClick}
              title="More options"
            >
              {'\u22EE'}
            </button>

            <div className={cn(styles.menu, menuOpen && styles.open)}>
              <button
                type="button"
                className={styles.menuItem}
                onClick={handleRenameClick}
              >
                {'\u270F'} Rename
              </button>
              <button
                type="button"
                className={styles.menuItem}
                onClick={handleShareClick}
              >
                {'\u{1F517}'} Share
              </button>
              {conversation.folderId && onRemoveFromFolder && (
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => { setMenuOpen(false); onRemoveFromFolder(); }}
                >
                  {'\u{1F4E4}'} Remove from folder
                </button>
              )}
              <button
                type="button"
                className={cn(styles.menuItem, styles.danger)}
                onClick={handleDeleteClick}
              >
                {'\u{1F5D1}'} Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
