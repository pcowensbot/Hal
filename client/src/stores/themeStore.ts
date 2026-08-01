import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
}

export interface ThemeFonts {
  body: string;
  heading: string;
  mono: string;
}

export interface ThemeSizes {
  fontSize: 'small' | 'medium' | 'large';
  spacing: 'compact' | 'normal' | 'relaxed';
  borderRadius: 'none' | 'small' | 'medium' | 'large';
}

interface ThemeState {
  mode: ThemeMode;
  colors: ThemeColors;
  fonts: ThemeFonts;
  sizes: ThemeSizes;
  sidebarCollapsed: boolean;

  // Computed
  resolvedMode: 'light' | 'dark';

  // Actions
  setMode: (mode: ThemeMode) => void;
  setColors: (colors: Partial<ThemeColors>) => void;
  setFonts: (fonts: Partial<ThemeFonts>) => void;
  setSizes: (sizes: Partial<ThemeSizes>) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  resetTheme: () => void;
}

const defaultColors: ThemeColors = {
  primary: '#3b82f6',
  secondary: '#64748b',
  accent: '#8b5cf6',
};

const defaultFonts: ThemeFonts = {
  body: 'system-ui, -apple-system, sans-serif',
  heading: 'system-ui, -apple-system, sans-serif',
  mono: 'ui-monospace, monospace',
};

const defaultSizes: ThemeSizes = {
  fontSize: 'medium',
  spacing: 'normal',
  borderRadius: 'medium',
};

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeToDOM(mode: 'light' | 'dark', colors: ThemeColors, sizes: ThemeSizes) {
  const root = document.documentElement;

  // Apply mode
  root.setAttribute('data-theme', mode);
  root.classList.remove('light', 'dark');
  root.classList.add(mode);

  // Apply custom colors as CSS variables
  root.style.setProperty('--color-primary', colors.primary);
  root.style.setProperty('--color-secondary', colors.secondary);
  root.style.setProperty('--color-accent', colors.accent);

  // Apply sizes
  const fontSizeMap = { small: '14px', medium: '16px', large: '18px' };
  const spacingMap = { compact: '0.75', normal: '1', relaxed: '1.25' };
  const radiusMap = { none: '0', small: '4px', medium: '8px', large: '12px' };

  root.style.setProperty('--font-size-base', fontSizeMap[sizes.fontSize]);
  root.style.setProperty('--spacing-scale', spacingMap[sizes.spacing]);
  root.style.setProperty('--border-radius', radiusMap[sizes.borderRadius]);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'system',
      colors: defaultColors,
      fonts: defaultFonts,
      sizes: defaultSizes,
      sidebarCollapsed: false,

      get resolvedMode() {
        const { mode } = get();
        return mode === 'system' ? getSystemTheme() : mode;
      },

      setMode: (mode) => {
        set({ mode });
        const resolvedMode = mode === 'system' ? getSystemTheme() : mode;
        applyThemeToDOM(resolvedMode, get().colors, get().sizes);
      },

      setColors: (colors) => {
        const newColors = { ...get().colors, ...colors };
        set({ colors: newColors });
        applyThemeToDOM(get().resolvedMode, newColors, get().sizes);
      },

      setFonts: (fonts) => {
        set({ fonts: { ...get().fonts, ...fonts } });
      },

      setSizes: (sizes) => {
        const newSizes = { ...get().sizes, ...sizes };
        set({ sizes: newSizes });
        applyThemeToDOM(get().resolvedMode, get().colors, newSizes);
      },

      toggleSidebar: () => {
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
      },

      setSidebarCollapsed: (collapsed) => {
        set({ sidebarCollapsed: collapsed });
      },

      resetTheme: () => {
        set({
          mode: 'system',
          colors: defaultColors,
          fonts: defaultFonts,
          sizes: defaultSizes,
        });
        applyThemeToDOM(getSystemTheme(), defaultColors, defaultSizes);
      },
    }),
    {
      name: 'theme-storage',
      onRehydrateStorage: () => (state) => {
        // Apply theme on initial load
        if (state) {
          const resolvedMode = state.mode === 'system' ? getSystemTheme() : state.mode;
          applyThemeToDOM(resolvedMode, state.colors, state.sizes);
        }
      },
    }
  )
);

// Listen for system theme changes
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const state = useThemeStore.getState();
    if (state.mode === 'system') {
      const resolvedMode = getSystemTheme();
      applyThemeToDOM(resolvedMode, state.colors, state.sizes);
    }
  });
}
