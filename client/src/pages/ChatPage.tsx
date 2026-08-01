import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ConversationList, ConversationView, ShareModal, MessageInput } from '../components/features/chat';
import { Avatar, ThemeToggle } from '../components/layout';
import { Button } from '../components/ui/Button';
import { useLogout, useCreateConversation, useSendMessage } from '../hooks';
import { useAuthStore, toast } from '../stores';
import { cn } from '../lib/utils';
import styles from './ChatPage.module.css';

export function ChatPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const logout = useLogout();
  const user = useAuthStore((state) => state.user);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareConversationId, setShareConversationId] = useState<string | null>(null);
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  const createConversationMutation = useCreateConversation();
  const sendMessageMutation = useSendMessage();

  const handleNewChatMessage = async (content: string) => {
    if (!content.trim() || isCreatingChat) return;

    setIsCreatingChat(true);
    try {
      // Create new conversation
      const newConversation = await createConversationMutation.mutateAsync(undefined);

      // Navigate to the new conversation
      navigate(`/chat/${newConversation.id}`);

      // Send the first message
      await sendMessageMutation.mutateAsync({
        conversationId: newConversation.id,
        content,
      });
    } catch {
      toast.error('Failed to start new chat');
    } finally {
      setIsCreatingChat(false);
    }
  };

  const handleConversationSelect = (id: string) => {
    navigate(`/chat/${id}`);
    setSidebarOpen(false);
  };

  const handleBackToList = () => {
    navigate('/chat');
  };

  const handleShare = (id: string) => {
    setShareConversationId(id);
    setShareModalOpen(true);
  };

  // Check if user has admin access
  const hasAdminAccess = user?.isSystemAdmin ||
    user?.permissions?.canManageUsers ||
    user?.permissions?.canManageGroups;

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
            <div
              className={styles.profileButton}
              onClick={() => navigate('/profile')}
              title={user?.firstName || 'Profile'}
            >
              <Avatar src={user?.avatar} name={user?.firstName} size="sm" />
            </div>
            <ThemeToggle />
          </div>
        </div>

        <div className={styles.navBar}>
          <Link to="/knowledge" className={styles.navIcon} title="Knowledge">
            {'\u{1F4DA}'}
          </Link>
          <Link to="/api" className={styles.navIcon} title="API">
            {'\u{26A1}'}
          </Link>
          <Link to="/import" className={styles.navIcon} title="Import">
            {'\u{1F4E5}'}
          </Link>
          {hasAdminAccess && (
            <Link to="/dashboard" className={styles.navIcon} title="Dashboard">
              {'\u{1F4CA}'}
            </Link>
          )}
          <div
            className={styles.navIcon}
            onClick={logout}
            title="Logout"
          >
            {'\u{1F6AA}'}
          </div>
        </div>

        <div className={styles.conversationList}>
          <ConversationList
            activeConversationId={conversationId}
            onConversationSelect={handleConversationSelect}
            onShare={handleShare}
          />
        </div>
      </aside>

      {/* Main content */}
      <main className={styles.main}>
        {conversationId ? (
          <ConversationView
            conversationId={conversationId}
            onBack={handleBackToList}
            onShare={() => handleShare(conversationId)}
          />
        ) : (
          <div className={styles.emptyMain}>
            <div className={styles.emptyIcon}>{'\u{1F4AC}'}</div>
            <h2 className={styles.emptyTitle}>Welcome to HAL</h2>
            <p className={styles.emptyDescription}>
              Start a new conversation by typing below, or select an existing chat from the sidebar.
            </p>
            <div className={styles.newChatInput}>
              <MessageInput
                onSend={handleNewChatMessage}
                loading={isCreatingChat}
                placeholder="Type your message to start a new chat..."
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className={styles.showSidebarButton}
              onClick={() => setSidebarOpen(true)}
            >
              Or browse existing chats
            </Button>
          </div>
        )}
      </main>

      {/* Share Modal */}
      {shareConversationId && (
        <ShareModal
          conversationId={shareConversationId}
          isOpen={shareModalOpen}
          onClose={() => {
            setShareModalOpen(false);
            setShareConversationId(null);
          }}
        />
      )}

    </div>
  );
}
