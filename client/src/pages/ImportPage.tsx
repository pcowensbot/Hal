import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, ThemeToggle } from '../components/layout';
import { Button } from '../components/ui/Button';
import { useLogout, chatKeys } from '../hooks';
import { useAuthStore, toast } from '../stores';
import { importApi, ApiError } from '../lib/api';
import styles from './ImportPage.module.css';

export function ImportPage() {
  const navigate = useNavigate();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const [shareUrl, setShareUrl] = useState('');
  const [isImporting, setIsImporting] = useState(false);

  const hasAdminAccess = user?.isSystemAdmin ||
    user?.permissions?.canManageUsers ||
    user?.permissions?.canManageGroups;

  const detectPlatform = (url: string): string | null => {
    if (url.includes('claude.ai')) return 'Claude';
    if (url.includes('chatgpt.com')) return 'ChatGPT';
    return null;
  };

  const platform = shareUrl.trim() ? detectPlatform(shareUrl) : null;
  const isValidUrl = platform !== null;

  const handleImport = async () => {
    if (!shareUrl.trim() || !isValidUrl) return;

    setIsImporting(true);
    try {
      const result = await importApi.importChat(shareUrl.trim());
      toast.success(`Imported ${result.conversation.messageCount} messages from ${result.conversation.platform}`);
      queryClient.invalidateQueries({ queryKey: chatKeys.conversations() });
      setShareUrl('');
      navigate(`/chat/${result.conversation.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import conversation';
      const details = error instanceof ApiError ? (error.data as { message?: string })?.message : undefined;
      toast.error(message, { details });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className={styles.layout}>
      {/* Sidebar */}
      <aside className={styles.sidebar}>
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
          <Link to="/chat" className={styles.navIcon} title="Chat">
            {'\u{1F4AC}'}
          </Link>
          <Link to="/knowledge" className={styles.navIcon} title="Knowledge">
            {'\u{1F4DA}'}
          </Link>
          <Link to="/api" className={styles.navIcon} title="API">
            {'\u{26A1}'}
          </Link>
          {hasAdminAccess && (
            <Link to="/dashboard" className={styles.navIcon} title="Dashboard">
              {'\u{1F4CA}'}
            </Link>
          )}
          <div className={styles.navIcon} onClick={logout} title="Logout">
            {'\u{1F6AA}'}
          </div>
        </div>

        <div className={styles.sidebarContent}>
          <h3 className={styles.sidebarTitle}>Import</h3>
          <p className={styles.sidebarDescription}>
            Bring conversations from Claude.ai and ChatGPT into HAL.
          </p>
        </div>
      </aside>

      {/* Main content */}
      <main className={styles.main}>
        <div className={styles.content}>
          <h1 className={styles.pageTitle}>Import Conversations</h1>
          <p className={styles.pageDescription}>
            Two ways to bring your conversations into HAL — the Chrome extension for one-click imports, or paste a share link.
          </p>

          {/* Method 1: Chrome Extension */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionIcon}>{'\u{1F9E9}'}</span>
              <div>
                <h2 className={styles.sectionTitle}>Chrome Extension</h2>
                <p className={styles.sectionSubtitle}>Recommended — imports directly from your browser</p>
              </div>
            </div>

            <div className={styles.card}>
              <p className={styles.cardDescription}>
                The HAL Import extension reads conversations directly from the page DOM, bypassing Cloudflare and API restrictions. It works on both Claude.ai and ChatGPT.
              </p>

              <h3 className={styles.stepTitle}>Setup Instructions</h3>
              <ol className={styles.steps}>
                <li>
                  <strong>Download the extension</strong>
                  <p>The extension files are in the <code>extension/</code> folder of the HAL project.</p>
                </li>
                <li>
                  <strong>Open Chrome Extensions page</strong>
                  <p>Go to <code>chrome://extensions</code> in your browser, or Menu &rarr; Extensions &rarr; Manage Extensions.</p>
                </li>
                <li>
                  <strong>Enable Developer Mode</strong>
                  <p>Toggle the "Developer mode" switch in the top-right corner.</p>
                </li>
                <li>
                  <strong>Load the extension</strong>
                  <p>Click "Load unpacked" and select the <code>extension/</code> folder.</p>
                </li>
                <li>
                  <strong>Configure the server URL</strong>
                  <p>Click the HAL Import icon in your toolbar, open "Server settings", and enter your HAL URL and auth token.</p>
                </li>
              </ol>

              <h3 className={styles.stepTitle}>How to Use</h3>
              <ol className={styles.steps}>
                <li>Navigate to a conversation on <strong>claude.ai</strong> or <strong>chatgpt.com</strong></li>
                <li>Click the HAL Import extension icon in your toolbar</li>
                <li>Preview the extracted messages</li>
                <li>Click "Import to HAL" — done</li>
              </ol>

              <div className={styles.supported}>
                <span className={styles.supportedLabel}>Supported sites:</span>
                <span className={styles.badge}>claude.ai</span>
                <span className={styles.badge}>chatgpt.com</span>
              </div>
            </div>
          </section>

          {/* Method 2: Share Link */}
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionIcon}>{'\u{1F517}'}</span>
              <div>
                <h2 className={styles.sectionTitle}>Paste a Share Link</h2>
                <p className={styles.sectionSubtitle}>Quick import via public share URLs</p>
              </div>
            </div>

            <div className={styles.card}>
              <p className={styles.cardDescription}>
                If you have a share link from Claude.ai or ChatGPT, paste it below to import the conversation.
              </p>

              <div className={styles.importForm}>
                <div className={styles.inputRow}>
                  <input
                    type="url"
                    className={styles.urlInput}
                    value={shareUrl}
                    onChange={(e) => setShareUrl(e.target.value)}
                    placeholder="https://claude.ai/share/... or https://chatgpt.com/share/..."
                    disabled={isImporting}
                  />
                  <Button
                    variant="primary"
                    onClick={handleImport}
                    loading={isImporting}
                    disabled={!isValidUrl}
                  >
                    Import
                  </Button>
                </div>
                {shareUrl.trim() && (
                  <div className={styles.detection}>
                    {isValidUrl ? (
                      <span className={styles.detected}>Detected: {platform}</span>
                    ) : (
                      <span className={styles.notDetected}>Not a supported share link</span>
                    )}
                  </div>
                )}
              </div>

              <div className={styles.shareInstructions}>
                <div className={styles.platformColumn}>
                  <strong>Claude.ai</strong>
                  <ol className={styles.miniSteps}>
                    <li>Open the conversation</li>
                    <li>Click the share icon</li>
                    <li>Create a share link and copy it</li>
                  </ol>
                </div>
                <div className={styles.platformColumn}>
                  <strong>ChatGPT</strong>
                  <ol className={styles.miniSteps}>
                    <li>Open the conversation</li>
                    <li>Click the share icon at the top</li>
                    <li>Copy the share link</li>
                  </ol>
                </div>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
