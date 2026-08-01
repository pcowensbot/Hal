import { useRef, useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { StarMessageModal } from './StarMessageModal';
import { ImageLightbox } from './ImageLightbox';
import { ArtifactsPanel } from './ArtifactsPanel';
import { LoadingSpinner } from '../../ui/LoadingSpinner';
import {
  useConversation,
  useSendMessage,
  useToggleStar,
  useCreateNoteFromText,
} from '../../../hooks';
import { useAuthStore, useThemeStore } from '../../../stores';
import { toast } from '../../../stores';
import { cn } from '../../../lib/utils';
import { extractArtifacts } from '../../../lib/extractArtifacts';
import type { Message, Artifact } from '../../../types';
import styles from './ConversationView.module.css';

export interface ConversationViewProps {
  conversationId: string;
  onBack?: () => void;
  onShare?: () => void;
  className?: string;
}

export function ConversationView({
  conversationId,
  onBack,
  onShare,
  className,
}: ConversationViewProps) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const fontSize = useThemeStore((state) => state.sizes.fontSize);
  const setSizes = useThemeStore((state) => state.setSizes);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [starModalOpen, setStarModalOpen] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImages, setLightboxImages] = useState<{ url: string; alt?: string }[]>([]);
  const [lightboxInitialIndex, setLightboxInitialIndex] = useState(0);

  // Artifacts panel state
  const [artifactsPanelOpen, setArtifactsPanelOpen] = useState(false);
  const prevArtifactCountRef = useRef(0);

  // Queries and mutations
  const { data: conversation, isLoading, error } = useConversation(conversationId);
  const sendMessageMutation = useSendMessage();
  const toggleStarMutation = useToggleStar();
  const createNoteFromTextMutation = useCreateNoteFromText();

  // Extract artifacts from assistant messages (must be before early returns — rules of hooks)
  const messages = conversation?.messages || [];
  const artifacts = useMemo(() => extractArtifacts(messages), [messages]);

  // Auto-open panel when new artifacts appear
  useEffect(() => {
    if (artifacts.length > prevArtifactCountRef.current && artifacts.length > 0) {
      setArtifactsPanelOpen(true);
    }
    prevArtifactCountRef.current = artifacts.length;
  }, [artifacts.length]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (conversation?.messages?.length) {
      scrollToBottom();
    }
  }, [conversation?.messages?.length]);

  // Handle scroll position for "scroll to bottom" button
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      setShowScrollButton(!isNearBottom);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToBottom = (smooth = true) => {
    messagesEndRef.current?.scrollIntoView({
      behavior: smooth ? 'smooth' : 'auto',
    });
  };

  const handleSendMessage = async (content: string, images?: string[]) => {
    try {
      await sendMessageMutation.mutateAsync({
        conversationId,
        content,
        images,
      });
    } catch {
      toast.error('Failed to send message');
    }
  };

  const handleStar = async () => {
    if (!conversation) return;
    try {
      await toggleStarMutation.mutateAsync({
        id: conversationId,
        starred: !conversation.starred,
      });
    } catch {
      toast.error('Failed to update star');
    }
  };

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate('/chat');
    }
  };

  const handleStarMessage = (message: Message) => {
    setSelectedMessage(message);
    setStarModalOpen(true);
  };

  const handleImageClick = (src: string, message: Message) => {
    // Collect all images from this message and any surrounding messages
    const images: { url: string; alt?: string }[] = [];
    let initialIndex = 0;

    // For simplicity, just show the clicked image for now
    // Could be extended to show all images in conversation
    if (message.attachments) {
      message.attachments.forEach((attachment) => {
        if (attachment.originalUrl === src) {
          initialIndex = images.length;
        }
        images.push({ url: attachment.originalUrl, alt: attachment.filename });
      });
    }

    // Add the clicked image if not from attachments
    if (images.length === 0) {
      images.push({ url: src });
    }

    setLightboxImages(images);
    setLightboxInitialIndex(initialIndex);
    setLightboxOpen(true);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className={cn(styles.container, className)}>
        <div className={styles.loading}>
          <LoadingSpinner size="lg" text="Loading conversation..." />
        </div>
      </div>
    );
  }

  // Error state
  if (error || !conversation) {
    return (
      <div className={cn(styles.container, className)}>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>{'\u26A0'}</div>
          <h3 className={styles.emptyTitle}>Conversation not found</h3>
          <p className={styles.emptyDescription}>
            This conversation may have been deleted or you don't have access to it.
          </p>
        </div>
      </div>
    );
  }

  const isReadOnly = conversation.isShared && !conversation.isOwned;

  const handleSaveArtifactToKnowledge = async (artifact: Artifact) => {
    await createNoteFromTextMutation.mutateAsync({
      content: artifact.content,
      title: artifact.filename,
    });
  };

  return (
    <div className={cn(styles.container, className)}>
      {/* Main conversation content */}
      <div className={styles.conversationContent}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <button
              type="button"
              className={styles.backButton}
              onClick={handleBack}
              aria-label="Back"
            >
              {'\u2190'}
            </button>
            <div className={styles.titleSection}>
              <h1 className={styles.title}>{conversation.title}</h1>
              {conversation.isShared && (
                <span className={styles.sharedBadge}>
                  {'\u{1F517}'} Shared by {conversation.user?.firstName}
                </span>
              )}
            </div>
          </div>

          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.headerAction}
              onClick={() => setSizes({ fontSize: fontSize === 'large' ? 'medium' : 'small' })}
              disabled={fontSize === 'small'}
              title="Smaller text"
              aria-label="Decrease font size"
            >
              <span className={styles.fontBtnText}>A<span className={styles.fontBtnSign}>−</span></span>
            </button>
            <button
              type="button"
              className={styles.headerAction}
              onClick={() => setSizes({ fontSize: fontSize === 'small' ? 'medium' : 'large' })}
              disabled={fontSize === 'large'}
              title="Larger text"
              aria-label="Increase font size"
            >
              <span className={styles.fontBtnText}>A<span className={styles.fontBtnSign}>+</span></span>
            </button>
            {artifacts.length > 0 && (
              <button
                type="button"
                className={cn(styles.headerAction, artifactsPanelOpen && styles.artifactsActive)}
                onClick={() => setArtifactsPanelOpen(!artifactsPanelOpen)}
                title={`${artifactsPanelOpen ? 'Hide' : 'Show'} artifacts (${artifacts.length})`}
              >
                {'\u{1F4C4}'}
                <span className={styles.artifactBadge}>{artifacts.length}</span>
              </button>
            )}
            {conversation.isOwned && (
              <>
                <button
                  type="button"
                  className={cn(styles.headerAction, conversation.starred && styles.starred)}
                  onClick={handleStar}
                  title={conversation.starred ? 'Unstar' : 'Star'}
                >
                  {conversation.starred ? '\u2605' : '\u2606'}
                </button>
                <button
                  type="button"
                  className={styles.headerAction}
                  onClick={onShare}
                  title="Share"
                >
                  {'\u{1F517}'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Messages */}
        <div className={styles.messages} ref={messagesContainerRef} data-chat-font-size={fontSize}>
          {messages.length === 0 ? (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>{'\u{1F4AD}'}</div>
              <h3 className={styles.emptyTitle}>Start the conversation</h3>
              <p className={styles.emptyDescription}>
                Send a message to begin chatting with HAL.
              </p>
            </div>
          ) : (
            <div className={styles.messagesContent}>
              {messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  userName={user?.firstName}
                  isStreaming={message.role === 'assistant' && message.modelUsed === 'pending'}
                  onStar={() => handleStarMessage(message)}
                  onImageClick={(src) => handleImageClick(src, message)}
                />
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Scroll to bottom button */}
        <button
          type="button"
          className={cn(styles.scrollBottom, showScrollButton && styles.visible)}
          onClick={() => scrollToBottom()}
          aria-label="Scroll to bottom"
        >
          {'\u2193'}
        </button>

        {/* Input or read-only notice */}
        {isReadOnly ? (
          <div className={styles.readOnly}>
            {'\u{1F512}'} This is a shared conversation. You can view but not reply.
          </div>
        ) : (
          <MessageInput
            onSend={handleSendMessage}
            loading={sendMessageMutation.isPending}
            placeholder="Type a message to HAL..."
          />
        )}

        {/* Star Message Modal */}
        {selectedMessage && (
          <StarMessageModal
            message={selectedMessage}
            isOpen={starModalOpen}
            onClose={() => {
              setStarModalOpen(false);
              setSelectedMessage(null);
            }}
          />
        )}

        {/* Image Lightbox */}
        <ImageLightbox
          images={lightboxImages}
          initialIndex={lightboxInitialIndex}
          isOpen={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      </div>

      {/* Artifacts Panel */}
      <ArtifactsPanel
        artifacts={artifacts}
        isOpen={artifactsPanelOpen}
        onClose={() => setArtifactsPanelOpen(false)}
        onSaveToKnowledge={handleSaveArtifactToKnowledge}
      />
    </div>
  );
}
