import { create } from 'zustand';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  details?: string;
  duration?: number;
}

interface Modal {
  id: string;
  component: string;
  props?: Record<string, unknown>;
}

interface UIState {
  // Toasts
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;

  // Modals
  modals: Modal[];
  openModal: (component: string, props?: Record<string, unknown>) => string;
  closeModal: (id: string) => void;
  closeAllModals: () => void;

  // Mobile menu
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  toggleMobileMenu: () => void;

  // Loading states
  globalLoading: boolean;
  setGlobalLoading: (loading: boolean) => void;

  // Confirmation dialog
  confirmDialog: {
    open: boolean;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'danger' | 'warning' | 'info';
    onConfirm?: () => void;
    onCancel?: () => void;
  };
  showConfirmDialog: (config: Omit<UIState['confirmDialog'], 'open'>) => void;
  hideConfirmDialog: () => void;
}

let toastId = 0;
let modalId = 0;

export const useUIStore = create<UIState>((set, get) => ({
  // Toasts
  toasts: [],
  addToast: (toast) => {
    const id = `toast-${++toastId}`;
    const newToast = { ...toast, id };
    set((state) => ({ toasts: [...state.toasts, newToast] }));

    // Auto-remove after duration (error toasts persist by default)
    const duration = toast.duration ?? (toast.type === 'error' ? 0 : 5000);
    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, duration);
    }

    return id;
  },
  removeToast: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
  },

  // Modals
  modals: [],
  openModal: (component, props) => {
    const id = `modal-${++modalId}`;
    set((state) => ({ modals: [...state.modals, { id, component, props }] }));
    return id;
  },
  closeModal: (id) => {
    set((state) => ({ modals: state.modals.filter((m) => m.id !== id) }));
  },
  closeAllModals: () => {
    set({ modals: [] });
  },

  // Mobile menu
  mobileMenuOpen: false,
  setMobileMenuOpen: (open) => set({ mobileMenuOpen: open }),
  toggleMobileMenu: () => set((state) => ({ mobileMenuOpen: !state.mobileMenuOpen })),

  // Loading
  globalLoading: false,
  setGlobalLoading: (loading) => set({ globalLoading: loading }),

  // Confirmation dialog
  confirmDialog: {
    open: false,
    title: '',
    message: '',
  },
  showConfirmDialog: (config) => {
    set({ confirmDialog: { ...config, open: true } });
  },
  hideConfirmDialog: () => {
    set((state) => ({ confirmDialog: { ...state.confirmDialog, open: false } }));
  },
}));

// Helper functions for common toast patterns
export const toast = {
  success: (message: string, duration?: number) =>
    useUIStore.getState().addToast({ type: 'success', message, duration }),
  error: (message: string, options?: { details?: string; duration?: number } | number) => {
    const opts = typeof options === 'number' ? { duration: options } : options;
    return useUIStore.getState().addToast({ type: 'error', message, details: opts?.details, duration: opts?.duration });
  },
  info: (message: string, duration?: number) =>
    useUIStore.getState().addToast({ type: 'info', message, duration }),
  warning: (message: string, duration?: number) =>
    useUIStore.getState().addToast({ type: 'warning', message, duration }),
};

// Helper for confirmation dialog
export const confirm = (config: Omit<UIState['confirmDialog'], 'open'>): Promise<boolean> => {
  return new Promise((resolve) => {
    useUIStore.getState().showConfirmDialog({
      ...config,
      onConfirm: () => {
        config.onConfirm?.();
        useUIStore.getState().hideConfirmDialog();
        resolve(true);
      },
      onCancel: () => {
        config.onCancel?.();
        useUIStore.getState().hideConfirmDialog();
        resolve(false);
      },
    });
  });
};
