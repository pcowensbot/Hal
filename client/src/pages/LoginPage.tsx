import { useState, type FormEvent } from 'react';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { useLogin, useSignup } from '../hooks';
import { useThemeStore } from '../stores';
import { cn } from '../lib/utils';
import styles from './LoginPage.module.css';

type TabType = 'login' | 'signup';

export function LoginPage() {
  const [activeTab, setActiveTab] = useState<TabType>('login');
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    firstName: '',
    inviteCode: '',
  });

  const loginMutation = useLogin();
  const signupMutation = useSignup();
  const { mode, setMode } = useThemeStore();

  const isLoading = loginMutation.isPending || signupMutation.isPending;
  const error = loginMutation.error?.message || signupMutation.error?.message;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (activeTab === 'login') {
      loginMutation.mutate({
        email: formData.email,
        password: formData.password,
      });
    } else {
      signupMutation.mutate({
        email: formData.email,
        password: formData.password,
        firstName: formData.firstName,
        inviteCode: formData.inviteCode,
      });
    }
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    // Reset form data when switching tabs
    setFormData({
      email: '',
      password: '',
      firstName: '',
      inviteCode: '',
    });
    // Reset errors
    loginMutation.reset();
    signupMutation.reset();
  };

  const toggleTheme = () => {
    if (mode === 'dark') {
      setMode('light');
    } else {
      setMode('dark');
    }
  };

  return (
    <div className={styles.container}>
      <Button
        variant="ghost"
        icon
        className={styles.themeToggle}
        onClick={toggleTheme}
        aria-label="Toggle theme"
      >
        {mode === 'dark' ? '\u2600' : '\u263D'}
      </Button>

      <Card className={styles.card} padding="lg">
        <div className={styles.header}>
          <h1 className={styles.logo}>HAL</h1>
          <p className={styles.subtitle}>Home AI Assistant</p>
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={cn(styles.tab, activeTab === 'login' && styles.active)}
            onClick={() => handleTabChange('login')}
          >
            Sign In
          </button>
          <button
            type="button"
            className={cn(styles.tab, activeTab === 'signup' && styles.active)}
            onClick={() => handleTabChange('signup')}
          >
            Sign Up
          </button>
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <form onSubmit={handleSubmit} className={styles.form}>
          {activeTab === 'signup' && (
            <>
              <Input
                label="Invite Code"
                type="text"
                placeholder="Enter your invite code"
                value={formData.inviteCode}
                onChange={(e) => setFormData({ ...formData, inviteCode: e.target.value })}
                required
                autoComplete="off"
              />
              <Input
                label="First Name"
                type="text"
                placeholder="Enter your first name"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                required
                autoComplete="given-name"
              />
            </>
          )}

          <Input
            label="Email"
            type="email"
            placeholder="Enter your email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
            autoComplete="email"
          />

          <Input
            label="Password"
            type="password"
            placeholder="Enter your password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            required
            autoComplete={activeTab === 'login' ? 'current-password' : 'new-password'}
          />

          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={isLoading}
            className={styles.submitButton}
          >
            {activeTab === 'login' ? 'Sign In' : 'Create Account'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
