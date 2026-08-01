import { useState } from 'react';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import { Badge } from '../../ui/Badge';
import {
  useConversation,
  useMyGroups,
  useShareConversation,
  useUnshareConversation,
} from '../../../hooks';
import { toast } from '../../../stores';
import styles from './ShareModal.module.css';

export interface ShareModalProps {
  conversationId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ShareModal({ conversationId, isOpen, onClose }: ShareModalProps) {
  const [pendingGroupId, setPendingGroupId] = useState<string | null>(null);

  const { data: conversation, isLoading: isLoadingConversation } = useConversation(conversationId);
  const { data: groups, isLoading: isLoadingGroups } = useMyGroups();
  const shareMutation = useShareConversation();
  const unshareMutation = useUnshareConversation();

  const isLoading = isLoadingConversation || isLoadingGroups;
  const sharedGroupIds = new Set(conversation?.shares?.map((s) => s.groupId) || []);

  const handleToggleShare = async (groupId: string) => {
    setPendingGroupId(groupId);
    try {
      if (sharedGroupIds.has(groupId)) {
        await unshareMutation.mutateAsync({ conversationId, groupId });
        toast.success('Conversation unshared');
      } else {
        await shareMutation.mutateAsync({ conversationId, groupId });
        toast.success('Conversation shared');
      }
    } catch {
      toast.error('Failed to update sharing');
    } finally {
      setPendingGroupId(null);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Share Conversation"
      size="sm"
    >
      <div className={styles.container}>
        {isLoading ? (
          <div className={styles.loading}>
            <LoadingSpinner size="md" />
          </div>
        ) : !groups || groups.length === 0 ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>{'\u{1F465}'}</div>
            <p className={styles.emptyText}>
              You're not a member of any groups yet. Join a group to share conversations.
            </p>
          </div>
        ) : (
          <>
            <p className={styles.description}>
              Select groups to share this conversation with. Members of selected groups will be able to view the conversation.
            </p>

            <div className={styles.groupList}>
              {groups.map((group) => {
                const isShared = sharedGroupIds.has(group.id);
                const isPending = pendingGroupId === group.id;

                return (
                  <div
                    key={group.id}
                    className={styles.groupItem}
                    onClick={() => !isPending && handleToggleShare(group.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (!isPending) handleToggleShare(group.id);
                      }
                    }}
                  >
                    <div className={styles.groupInfo}>
                      <div
                        className={styles.groupColor}
                        style={{ backgroundColor: group.color || 'var(--primary)' }}
                      />
                      <div className={styles.groupDetails}>
                        <span className={styles.groupName}>{group.name}</span>
                        {group.description && (
                          <span className={styles.groupDescription}>{group.description}</span>
                        )}
                      </div>
                      {group.isGroupAdmin && (
                        <Badge variant="secondary" size="sm">Admin</Badge>
                      )}
                    </div>

                    <div className={styles.groupAction}>
                      {isPending ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        <div className={`${styles.checkbox} ${isShared ? styles.checked : ''}`}>
                          {isShared && '\u2713'}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {sharedGroupIds.size > 0 && (
              <div className={styles.sharedInfo}>
                <span className={styles.sharedLabel}>{'\u{1F517}'} Shared with {sharedGroupIds.size} group{sharedGroupIds.size !== 1 ? 's' : ''}</span>
              </div>
            )}
          </>
        )}

        <div className={styles.footer}>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}
