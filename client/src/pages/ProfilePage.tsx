import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Avatar, ThemeToggle } from '../components/layout';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import {
  useLogout,
  useUpdateAvatar,
  useRemoveAvatar,
  useUpdateProfile,
  useChangePassword,
  useDeleteAccount,
  useDevices,
  useCreateDevice,
  useDeleteDevice,
  useRegenerateKey,
} from '../hooks';
import { useAuthStore, useThemeStore } from '../stores';
import { cn } from '../lib/utils';
import type { Device } from '../types';
import styles from './ProfilePage.module.css';

// Theme store for appearance settings
const ACCENT_COLORS = [
  '#2563eb', // Blue
  '#7c3aed', // Purple
  '#db2777', // Pink
  '#dc2626', // Red
  '#ea580c', // Orange
  '#ca8a04', // Yellow
  '#16a34a', // Green
  '#0891b2', // Cyan
];

const FONT_SIZES = ['Small', 'Medium', 'Large'];

export function ProfilePage() {
  const logout = useLogout();
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const hasAdminAccess = user?.isSystemAdmin ||
    user?.permissions?.canManageUsers ||
    user?.permissions?.canManageGroups;

  // Profile editing
  const [editingProfile, setEditingProfile] = useState(false);
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Avatar
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updateAvatar = useUpdateAvatar();
  const removeAvatar = useRemoveAvatar();

  // Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const changePassword = useChangePassword();

  // Theme — from Zustand store
  const themeStore = useThemeStore();
  const theme = themeStore.resolvedMode;
  const accentColor = themeStore.colors.primary;
  const fontSizeIndex = themeStore.sizes.fontSize === 'small' ? 0 : themeStore.sizes.fontSize === 'medium' ? 1 : 2;

  // Devices
  const { data: devices, isLoading: devicesLoading } = useDevices();
  const [newDeviceName, setNewDeviceName] = useState('');
  const [newDeviceDescription, setNewDeviceDescription] = useState('');
  const [showNewDevice, setShowNewDevice] = useState(false);
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const createDevice = useCreateDevice();
  const deleteDevice = useDeleteDevice();
  const regenerateKey = useRegenerateKey();

  // Delete account
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const deleteAccount = useDeleteAccount();

  // Profile handlers
  const updateProfile = useUpdateProfile();

  const handleSaveProfile = async () => {
    setProfileMessage(null);
    try {
      const result = await updateProfile.mutateAsync(firstName);
      updateUser({ firstName: result.user.firstName });
      setProfileMessage({ type: 'success', text: 'Profile updated successfully' });
      setEditingProfile(false);
    } catch (err) {
      setProfileMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update profile' });
    }
  };

  // Avatar handlers
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Convert to base64
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = await updateAvatar.mutateAsync(reader.result as string);
        updateUser({ avatar: result.user.avatar });
      } catch (err) {
        console.error('Failed to upload avatar:', err);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveAvatar = async () => {
    try {
      await removeAvatar.mutateAsync();
      updateUser({ avatar: null });
    } catch (err) {
      console.error('Failed to remove avatar:', err);
    }
  };

  // Password handlers
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMessage(null);

    if (newPassword !== confirmPassword) {
      setPasswordMessage({ type: 'error', text: 'Passwords do not match' });
      return;
    }

    if (newPassword.length < 6) {
      setPasswordMessage({ type: 'error', text: 'Password must be at least 6 characters' });
      return;
    }

    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      setPasswordMessage({ type: 'success', text: 'Password changed successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setPasswordMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to change password' });
    }
  };

  // Theme handlers
  const handleThemeChange = (newTheme: 'light' | 'dark') => {
    themeStore.setMode(newTheme);
  };

  const handleAccentColorChange = (color: string) => {
    themeStore.setColors({ primary: color });
  };

  const handleFontSizeChange = (delta: number) => {
    const sizes: Array<'small' | 'medium' | 'large'> = ['small', 'medium', 'large'];
    const newIndex = Math.max(0, Math.min(2, fontSizeIndex + delta));
    themeStore.setSizes({ fontSize: sizes[newIndex] });
  };

  // Device handlers
  const handleCreateDevice = async () => {
    if (!newDeviceName.trim()) return;

    try {
      const result = await createDevice.mutateAsync({
        name: newDeviceName.trim(),
        description: newDeviceDescription.trim() || undefined,
      });
      setNewApiKey(result.apiKey);
      setNewDeviceName('');
      setNewDeviceDescription('');
    } catch (err) {
      console.error('Failed to create device:', err);
    }
  };

  const handleDeleteDevice = async (id: string) => {
    if (!confirm('Delete this device? The API key will be revoked.')) return;
    await deleteDevice.mutateAsync(id);
  };

  const handleRegenerateKey = async (id: string) => {
    if (!confirm('Regenerate API key? The old key will stop working.')) return;
    const result = await regenerateKey.mutateAsync(id);
    setNewApiKey(result.apiKey);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  // Delete account handlers
  const handleDeleteAccount = async () => {
    setDeleteError('');
    try {
      await deleteAccount.mutateAsync({ deleteType: 'complete', password: deletePassword });
      // Logout will happen automatically
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete account');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

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
          <div
            className={styles.navIcon}
            onClick={logout}
            title="Logout"
          >
            {'\u{1F6AA}'}
          </div>
        </div>
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
            <h1 className={styles.mainTitle}>Profile Settings</h1>
          </div>
        </header>

        <div className={styles.content}>
          <div className={styles.container}>
        {/* Profile Section */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>{'\u{1F464}'} Profile</h2>
            {!editingProfile && (
              <Button variant="ghost" size="sm" onClick={() => setEditingProfile(true)}>
                Edit
              </Button>
            )}
          </div>
          <div className={styles.sectionBody}>
            <div className={styles.profileInfo}>
              <div className={styles.avatarSection}>
                <Avatar src={user?.avatar} name={user?.firstName} size="xxl" />
                <div className={styles.avatarActions}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className={styles.fileInput}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={updateAvatar.isPending}
                  >
                    {updateAvatar.isPending ? 'Uploading...' : 'Upload Photo'}
                  </Button>
                  {user?.avatar && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleRemoveAvatar}
                      disabled={removeAvatar.isPending}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              </div>

              <div className={styles.userDetails}>
                {editingProfile ? (
                  <div className={styles.form}>
                    <Input
                      label="Display Name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                    <div className={styles.formActions}>
                      <Button variant="primary" size="sm" onClick={handleSaveProfile}>
                        Save
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setEditingProfile(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <h3 className={styles.userName}>{user?.firstName}</h3>
                    <p className={styles.userEmail}>{user?.email}</p>
                    <span className={styles.userRole}>
                      {user?.customRole?.name || user?.role}
                    </span>
                    <p className={styles.userMeta}>
                      Member since {user?.createdAt ? formatDate(user.createdAt) : 'Unknown'}
                    </p>
                  </>
                )}
                {profileMessage && (
                  <div className={cn(styles.message, profileMessage.type === 'success' ? styles.messageSuccess : styles.messageError)}>
                    {profileMessage.text}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Appearance Section */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>{'\u{1F3A8}'} Appearance</h2>
          </div>
          <div className={styles.sectionBody}>
            {/* Theme selector */}
            <div className={styles.themeSelector}>
              <button
                className={cn(styles.themeOption, theme === 'light' && styles.active)}
                onClick={() => handleThemeChange('light')}
              >
                <span className={styles.themeIcon}>{'\u{2600}\u{FE0F}'}</span>
                <span className={styles.themeLabel}>Light Mode</span>
              </button>
              <button
                className={cn(styles.themeOption, theme === 'dark' && styles.active)}
                onClick={() => handleThemeChange('dark')}
              >
                <span className={styles.themeIcon}>{'\u{1F319}'}</span>
                <span className={styles.themeLabel}>Dark Mode</span>
              </button>
            </div>

            {/* Accent color */}
            <label className={styles.colorLabel}>Accent Color</label>
            <div className={styles.colorGrid}>
              {ACCENT_COLORS.map((color) => (
                <button
                  key={color}
                  className={cn(styles.colorOption, accentColor === color && styles.active)}
                  style={{ backgroundColor: color }}
                  onClick={() => handleAccentColorChange(color)}
                >
                  <span className={styles.colorCheck}>{'\u{2713}'}</span>
                </button>
              ))}
            </div>

            {/* Font size */}
            <label className={styles.colorLabel} style={{ marginTop: 'var(--spacing-lg)' }}>
              Font Size
            </label>
            <div className={styles.fontSizeControl}>
              <Button variant="secondary" size="sm" onClick={() => handleFontSizeChange(-1)}>
                A-
              </Button>
              <span className={styles.fontSizeDisplay}>{FONT_SIZES[fontSizeIndex]}</span>
              <Button variant="secondary" size="sm" onClick={() => handleFontSizeChange(1)}>
                A+
              </Button>
            </div>
          </div>
        </section>

        {/* Password Section */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>{'\u{1F512}'} Change Password</h2>
          </div>
          <div className={styles.sectionBody}>
            <form className={styles.form} onSubmit={handleChangePassword}>
              <Input
                type="password"
                label="Current Password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
              <div className={styles.formRow}>
                <Input
                  type="password"
                  label="New Password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
                <Input
                  type="password"
                  label="Confirm New Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>
              <div className={styles.formActions}>
                <Button type="submit" variant="primary" disabled={changePassword.isPending}>
                  {changePassword.isPending ? 'Changing...' : 'Change Password'}
                </Button>
              </div>
              {passwordMessage && (
                <div className={cn(styles.message, passwordMessage.type === 'success' ? styles.messageSuccess : styles.messageError)}>
                  {passwordMessage.text}
                </div>
              )}
            </form>
          </div>
        </section>

        {/* Devices Section */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>{'\u{1F4F1}'} Devices & API Keys</h2>
            <Button variant="primary" size="sm" onClick={() => setShowNewDevice(true)}>
              + Add Device
            </Button>
          </div>
          <div className={styles.sectionBody}>
            {newApiKey && (
              <div className={styles.apiKeyDisplay}>
                <span className={styles.apiKeyText}>{newApiKey}</span>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(newApiKey)}>
                  Copy
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setNewApiKey(null)}>
                  Dismiss
                </Button>
              </div>
            )}

            {showNewDevice && (
              <Card style={{ marginBottom: 'var(--spacing-md)' }}>
                <div style={{ padding: 'var(--spacing-md)' }}>
                  <h4 style={{ margin: '0 0 var(--spacing-md) 0' }}>Add New Device</h4>
                  <div className={styles.form}>
                    <Input
                      label="Device Name"
                      value={newDeviceName}
                      onChange={(e) => setNewDeviceName(e.target.value)}
                      placeholder="e.g., Home Assistant, ESP32"
                    />
                    <Input
                      label="Description (optional)"
                      value={newDeviceDescription}
                      onChange={(e) => setNewDeviceDescription(e.target.value)}
                      placeholder="What is this device for?"
                    />
                    <div className={styles.formActions}>
                      <Button variant="primary" onClick={handleCreateDevice} disabled={createDevice.isPending}>
                        {createDevice.isPending ? 'Creating...' : 'Create Device'}
                      </Button>
                      <Button variant="ghost" onClick={() => setShowNewDevice(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            )}

            {devicesLoading ? (
              <LoadingSpinner />
            ) : devices && devices.length > 0 ? (
              <div className={styles.devicesList}>
                {devices.map((device: Device) => (
                  <div key={device.id} className={styles.deviceCard}>
                    <div className={styles.deviceInfo}>
                      <h4 className={styles.deviceName}>{device.name}</h4>
                      {device.description && (
                        <p className={styles.deviceDescription}>{device.description}</p>
                      )}
                      <div className={styles.deviceMeta}>
                        <span>Created: {formatDate(device.createdAt)}</span>
                        {device.lastUsedAt && <span>Last used: {formatDate(device.lastUsedAt)}</span>}
                        <span>Requests: {device.requestCount}</span>
                      </div>
                    </div>
                    <div className={styles.deviceActions}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleRegenerateKey(device.id)}
                      >
                        Regenerate Key
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteDevice(device.id)}
                      >
                        {'\u{1F5D1}\u{FE0F}'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyDevices}>
                <p>No devices yet. Add a device to get an API key for external integrations.</p>
              </div>
            )}
          </div>
        </section>

        {/* Danger Zone */}
        <section className={cn(styles.section, styles.dangerSection)}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>{'\u{26A0}\u{FE0F}'} Danger Zone</h2>
          </div>
          <div className={styles.sectionBody}>
            <p className={styles.dangerDescription}>
              Permanently delete your account and all associated data. This action cannot be undone.
            </p>
            <Button variant="danger" onClick={() => setDeleteModalOpen(true)}>
              {'\u{1F5D1}\u{FE0F}'} Delete My Account
            </Button>
          </div>
        </section>
      </div>

      {/* Delete Account Modal */}
      <Modal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Confirm Account Deletion"
        footer={
          <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setDeleteModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDeleteAccount} disabled={deleteAccount.isPending}>
              {deleteAccount.isPending ? 'Deleting...' : 'Delete Account'}
            </Button>
          </div>
        }
      >
        <p style={{ marginBottom: 'var(--spacing-md)' }}>
          This will permanently delete your account and all your data including conversations,
          knowledge base entries, and devices. This action cannot be undone.
        </p>
        <Input
          type="password"
          label="Enter your password to confirm"
          value={deletePassword}
          onChange={(e) => setDeletePassword(e.target.value)}
        />
        {deleteError && (
          <p style={{ color: 'var(--error)', marginTop: 'var(--spacing-sm)' }}>{deleteError}</p>
        )}
      </Modal>
        </div>
      </main>
    </div>
  );
}
