import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, ThemeToggle } from '../components/layout';
import { Button, Input } from '../components/ui';
import {
  useLogout,
  useDevices,
  useCreateDevice,
  useDeleteDevice,
  useRegenerateKey,
  useTokenStats,
  useLogDaysByDevice,
  useDeviceLogs,
  useCreateShare,
  useAddLogsToKnowledge,
} from '../hooks';
import { useAuthStore, toast } from '../stores';
import { cn } from '../lib/utils';
import type { DeviceApiLog } from '../types';
import styles from './ApiPage.module.css';

export function ApiPage() {
  const logout = useLogout();
  const user = useAuthStore((state) => state.user);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState<'devices' | 'logs'>('devices');
  const [selectedDevice, setSelectedDevice] = useState<{ id: string; name: string } | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [expandedDevices, setExpandedDevices] = useState<Set<string>>(new Set());

  const hasAdminAccess = user?.isSystemAdmin ||
    user?.permissions?.canManageUsers ||
    user?.permissions?.canManageGroups;

  const { data: deviceDaysData } = useLogDaysByDevice();

  const handleDevicesClick = () => {
    setActiveView('devices');
    setSelectedDevice(null);
    setSelectedDate(null);
    setSidebarOpen(false);
  };

  const toggleDevice = (deviceId: string) => {
    setExpandedDevices(prev => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  };

  const handleDayClick = (device: { id: string; name: string }, date: string) => {
    setActiveView('logs');
    setSelectedDevice(device);
    setSelectedDate(date);
    setSidebarOpen(false);
  };

  // Auto-expand devices that have recent logs
  useEffect(() => {
    if (deviceDaysData?.devices && expandedDevices.size === 0) {
      setExpandedDevices(new Set(deviceDaysData.devices.map(d => d.id)));
    }
  }, [deviceDaysData]);

  const formatDayLabel = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  return (
    <div className={styles.layout}>
      <div
        className={cn(styles.backdrop, sidebarOpen && styles.visible)}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={cn(styles.sidebar, sidebarOpen && styles.open)}>
        <div className={styles.sidebarHeader}>
          <Link to="/chat" className={styles.logo}>HAL</Link>
          <div className={styles.headerActions}>
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
          {hasAdminAccess && (
            <Link to="/dashboard" className={styles.navIcon} title="Dashboard">
              {'\u{1F4CA}'}
            </Link>
          )}
          <Link to="/profile" className={styles.navIcon} title={user?.firstName || 'Profile'}>
            <Avatar src={user?.avatar} name={user?.firstName} size="sm" />
          </Link>
          <div className={styles.navIcon} onClick={logout} title="Logout">
            {'\u{1F6AA}'}
          </div>
        </div>

        <button
          className={cn(styles.devicesButton, activeView === 'devices' && styles.active)}
          onClick={handleDevicesClick}
        >
          Devices & Setup
        </button>

        <div className={styles.dayList}>
          {deviceDaysData?.devices.map((device) => (
            <div key={device.id} className={styles.deviceGroup}>
              <div
                className={styles.deviceGroupHeader}
                onClick={() => toggleDevice(device.id)}
              >
                <span className={styles.deviceGroupChevron}>
                  {expandedDevices.has(device.id) ? '\u25BE' : '\u25B8'}
                </span>
                <span className={styles.deviceGroupName}>{device.name}</span>
                <span className={styles.dayCount}>
                  {device.days.reduce((sum, d) => sum + d.count, 0)}
                </span>
              </div>
              {expandedDevices.has(device.id) && (
                <div className={styles.deviceGroupDays}>
                  {device.days.map((day) => (
                    <div
                      key={day.date}
                      className={cn(
                        styles.dayItem,
                        selectedDevice?.id === device.id && selectedDate === day.date && styles.activeDayItem,
                      )}
                      onClick={() => handleDayClick({ id: device.id, name: device.name }, day.date)}
                    >
                      <span className={styles.dayLabel}>{formatDayLabel(day.date)}</span>
                      <span className={styles.dayCount}>{day.count}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>

      <main className={styles.main}>
        {activeView === 'logs' && selectedDate && selectedDevice ? (
          <LogDayView date={selectedDate} deviceId={selectedDevice.id} deviceName={selectedDevice.name} />
        ) : (
          <ApiHome />
        )}
      </main>
    </div>
  );
}

// --- Conversation-style log view ---

function LogDayView({ date, deviceId, deviceName }: { date: string; deviceId: string; deviceName: string }) {
  const [search, setSearch] = useState('');
  const [shareFromId, setShareFromId] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useDeviceLogs({
    date,
    deviceId,
    search: search || undefined,
    limit: 100,
  });

  const createShare = useCreateShare();
  const addToKnowledge = useAddLogsToKnowledge();

  const formatTime = (dateStr: string) =>
    new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const formatDuration = (ms: number | null | undefined) => {
    if (!ms) return null;
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTokens = (count: number | null | undefined) => {
    if (!count) return null;
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M tok`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K tok`;
    return `${count} tok`;
  };

  const handleShareFrom = async (startId: string) => {
    if (!data?.logs) return;
    const startIdx = data.logs.findIndex(l => l.id === startId);
    if (startIdx === -1) return;
    const logIds = data.logs.slice(startIdx).map(l => l.id);

    try {
      const result = await createShare.mutateAsync({ deviceId, logIds });
      const fullUrl = `${window.location.origin}${result.url}`;
      await navigator.clipboard.writeText(fullUrl);
      toast.success(`Share link copied! (${logIds.length} entries)`);
      setShareFromId(null);
    } catch {
      toast.error('Failed to create share link');
    }
  };

  const handleAddToKnowledge = async (log: DeviceApiLog) => {
    try {
      await addToKnowledge.mutateAsync([{
        prompt: log.prompt || '',
        response: log.response || '',
        createdAt: log.createdAt,
      }]);
      toast.success('Added to knowledge');
    } catch {
      toast.error('Failed to add to knowledge');
    }
  };

  const dateLabel = new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <div className={styles.logViewContainer}>
      <div className={styles.logViewHeader}>
        <div>
          <h2 className={styles.logViewTitle}>{deviceName}</h2>
          <div className={styles.logViewDate}>{dateLabel}</div>
        </div>
        <Input
          className={styles.logSearch}
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.conversationView}>
        {isLoading ? (
          <div className={styles.logEmpty}>Loading...</div>
        ) : !data?.logs?.length ? (
          <div className={styles.logEmpty}>No log entries for this day.</div>
        ) : (
          data.logs.map((log: DeviceApiLog) => {
            const meta = log.metadata as Record<string, unknown> | null;
            const hasToolCalls = !!meta?.hasToolCalls;
            const toolCallCount = Number(meta?.toolCallCount) || 0;
            const isShareStart = shareFromId === log.id;

            return (
              <div key={log.id} className={cn(styles.exchange, isShareStart && styles.exchangeHighlight)}>
                {/* User prompt */}
                {log.prompt && (
                  <div className={styles.bubbleRow}>
                    <div className={styles.bubbleUser}>
                      <div className={styles.bubbleLabel}>Input</div>
                      <div className={styles.bubbleContent}>{log.prompt}</div>
                    </div>
                  </div>
                )}

                {/* Assistant response */}
                {log.response && (
                  <div className={styles.bubbleRow}>
                    <div className={styles.bubbleAssistant}>
                      <div className={styles.bubbleLabel}>Output</div>
                      <div className={styles.bubbleContent}>{log.response}</div>
                    </div>
                  </div>
                )}

                {/* Metadata bar */}
                <div className={styles.exchangeMeta}>
                  <span>{formatTime(log.createdAt)}</span>
                  {formatDuration(log.durationMs) && <span>{formatDuration(log.durationMs)}</span>}
                  {formatTokens(log.tokenCount) && <span>{formatTokens(log.tokenCount)}</span>}
                  {hasToolCalls && (
                    <span className={styles.toolBadge}>
                      tools{toolCallCount ? ` (${String(toolCallCount)})` : ''}
                    </span>
                  )}
                  {log.model && <span className={styles.modelBadge}>{log.model}</span>}
                  <div className={styles.exchangeActions}>
                    <button
                      className={styles.exchangeAction}
                      onClick={() => handleShareFrom(log.id)}
                      title="Share from here"
                      disabled={createShare.isPending}
                    >
                      Share from here
                    </button>
                    <button
                      className={styles.exchangeAction}
                      onClick={() => handleAddToKnowledge(log)}
                      title="Save to knowledge"
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

// --- Device management + setup ---

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

function ApiHome() {
  const { data: devices, isLoading } = useDevices();
  const { data: tokenStats } = useTokenStats();
  const createDevice = useCreateDevice();
  const deleteDevice = useDeleteDevice();
  const regenerateKey = useRegenerateKey();

  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [regeneratedKey, setRegeneratedKey] = useState<{ id: string; key: string } | null>(null);

  const halBaseUrl = `${window.location.protocol}//${window.location.host}/v1`;

  const handleCreate = async () => {
    if (!newName.trim()) return;
    try {
      const result = await createDevice.mutateAsync({ name: newName.trim(), description: newDescription.trim() || undefined });
      setNewApiKey(result.apiKey);
      setNewName('');
      setNewDescription('');
      toast.success(`Device "${result.name}" created`);
    } catch {
      toast.error('Failed to create device');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete device "${name}"? This will revoke its API key.`)) return;
    try {
      await deleteDevice.mutateAsync(id);
      toast.success(`Device "${name}" deleted`);
    } catch {
      toast.error('Failed to delete device');
    }
  };

  const handleRegenerate = async (id: string, name: string) => {
    if (!confirm(`Regenerate API key for "${name}"? The old key will stop working immediately.`)) return;
    try {
      const result = await regenerateKey.mutateAsync(id);
      setRegeneratedKey({ id, key: result.apiKey });
      toast.success('API key regenerated');
    } catch {
      toast.error('Failed to regenerate key');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const configJson = `{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "hal": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "HAL",
      "options": {
        "baseURL": "${halBaseUrl}",
        "apiKey": "<your-device-api-key>"
      },
      "models": {
        "qwen3.6:27b": {
          "name": "Qwen 3.6 27B (tools + vision, default)",
          "limit": { "context": 65536, "output": 16384 }
        },
        "qwen3-coder:30b": {
          "name": "Qwen3 Coder 30B (fastest agentic, no vision)",
          "limit": { "context": 65536, "output": 16384 }
        }
      }
    }
  },
  "model": "hal/qwen3.6:27b"
}`;

  return (
    <div className={styles.emptyMain}>
      {/* Token Usage Stats */}
      {tokenStats && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Token Usage</h2>
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.statsGrid}>
              <div className={styles.statCard}>
                <div className={styles.statValue}>{formatTokenCount(tokenStats.today.tokens)}</div>
                <div className={styles.statLabel}>Tokens Today</div>
                <div className={styles.statSub}>{tokenStats.today.requests} requests</div>
              </div>
              <div className={styles.statCard}>
                <div className={styles.statValue}>{formatTokenCount(tokenStats.totalTokens)}</div>
                <div className={styles.statLabel}>All Time</div>
                <div className={styles.statSub}>{tokenStats.totalRequests} requests</div>
              </div>
              {tokenStats.devices.map((device) => (
                <div key={device.id} className={styles.statCard}>
                  <div className={styles.statValue}>{formatTokenCount(device.tokens)}</div>
                  <div className={styles.statLabel}>{device.name}</div>
                  <div className={styles.statSub}>{device.requests} requests</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Devices */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Devices</h2>
        </div>
        <div className={styles.sectionBody}>
          {/* Create form */}
          <div className={styles.createForm}>
            <div>
              <label className={styles.formLabel}>Name</label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. opencode-laptop"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <div>
              <label className={styles.formLabel}>Description (optional)</label>
              <Input
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="e.g. Work laptop running OpenCode"
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || createDevice.isPending}
            >
              Add Device
            </Button>
          </div>

          {/* New API key display */}
          {newApiKey && (
            <div className={styles.apiKeyBox}>
              <div className={styles.apiKeyWarning}>
                Save this API key now — it will not be shown again!
              </div>
              <div
                className={styles.apiKeyValue}
                onClick={() => copyToClipboard(newApiKey)}
                title="Click to copy"
              >
                {newApiKey}
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setNewApiKey(null)}
                style={{ marginTop: 'var(--spacing-sm)' }}
              >
                Dismiss
              </Button>
            </div>
          )}

          {/* Device list */}
          {isLoading ? (
            <div className={styles.emptyDevices}>Loading...</div>
          ) : devices && devices.length > 0 ? (
            <div style={{ marginTop: 'var(--spacing-md)' }}>
              {devices.map((device) => (
                <div key={device.id} className={styles.deviceCard}>
                  <div className={styles.deviceInfo}>
                    <div className={styles.deviceName}>{device.name}</div>
                    <div className={styles.deviceMeta}>
                      {device.description && `${device.description} · `}
                      {device.requestCount || 0} requests
                      {device.lastUsedAt && ` · Last used ${new Date(device.lastUsedAt).toLocaleDateString()}`}
                    </div>
                  </div>
                  <div className={styles.deviceActions}>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleRegenerate(device.id, device.name)}
                      disabled={regenerateKey.isPending}
                    >
                      Regen Key
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleDelete(device.id, device.name)}
                      disabled={deleteDevice.isPending}
                    >
                      Delete
                    </Button>
                  </div>
                  {regeneratedKey?.id === device.id && (
                    <div className={styles.apiKeyBox} style={{ marginTop: 'var(--spacing-sm)', width: '100%' }}>
                      <div className={styles.apiKeyWarning}>
                        New API key — save it now!
                      </div>
                      <div
                        className={styles.apiKeyValue}
                        onClick={() => copyToClipboard(regeneratedKey.key)}
                        title="Click to copy"
                      >
                        {regeneratedKey.key}
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setRegeneratedKey(null)}
                        style={{ marginTop: 'var(--spacing-sm)' }}
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyDevices}>
              No devices yet. Create one to get an API key.
            </div>
          )}
        </div>
      </section>

      {/* OpenCode Setup */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>OpenCode Setup</h2>
        </div>
        <div className={styles.sectionBody}>
          <p className={styles.configNote} style={{ marginTop: 0, marginBottom: 'var(--spacing-sm)' }}>
            Save this as <strong>opencode.json</strong> in your project directory. Replace <code>&lt;your-device-api-key&gt;</code> with a key from a device above.
          </p>
          <div
            className={styles.codeBlock}
            onClick={() => copyToClipboard(configJson)}
            title="Click to copy"
            style={{ cursor: 'pointer' }}
          >
            {configJson}
          </div>
          <p className={styles.configNote}>
            Server context is 64K tokens — the <code>limit.context</code> values above let OpenCode
            compact its history before hitting the ceiling instead of getting silently truncated.
            <code>qwen3.6:27b</code> is the default: strong tool calling, knows when <em>not</em> to
            call a tool, and accepts images. <code>qwen3-coder:30b</code> is faster per turn but
            fires tools eagerly and has no vision — note that requesting a non-default model may
            add a one-time model-swap delay (~20s) while it loads.
            If an admin has pinned a model to your device, HAL serves the pinned model
            regardless of which one you request. All requests through HAL are logged and visible
            in the device log sidebar.
          </p>
        </div>
      </section>
    </div>
  );
}
