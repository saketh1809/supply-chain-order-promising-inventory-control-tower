import { createSlice, nanoid, PayloadAction } from '@reduxjs/toolkit';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
}

export interface UiState {
  theme: ThemeMode;
  sidebarCollapsed: boolean;
  actingUserId: number;
  toasts: Toast[];
}

const STORAGE_KEY = 'sct.ui';

function loadPersisted(): Partial<UiState> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<UiState>) : {};
  } catch {
    // Storage can be unavailable (private mode, blocked); the app still works with defaults.
    return {};
  }
}

const persisted = loadPersisted();

const initialState: UiState = {
  theme: persisted.theme ?? 'light',
  sidebarCollapsed: persisted.sidebarCollapsed ?? false,
  actingUserId: persisted.actingUserId ?? 1,
  toasts: [],
};

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setTheme(state, action: PayloadAction<ThemeMode>) {
      state.theme = action.payload;
    },
    toggleSidebar(state) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setActingUser(state, action: PayloadAction<number>) {
      state.actingUserId = action.payload;
    },
    pushToast: {
      reducer(state, action: PayloadAction<Toast>) {
        state.toasts = [...state.toasts.slice(-3), action.payload];
      },
      prepare(toast: Omit<Toast, 'id'>) {
        return { payload: { id: nanoid(), ...toast } };
      },
    },
    dismissToast(state, action: PayloadAction<string>) {
      state.toasts = state.toasts.filter((t) => t.id !== action.payload);
    },
  },
});

export const { setTheme, toggleSidebar, setActingUser, pushToast, dismissToast } = uiSlice.actions;
export const uiReducer = uiSlice.reducer;

/** Persist the preferences that should survive reloads (never data). */
export function persistUi(state: UiState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme: state.theme, sidebarCollapsed: state.sidebarCollapsed, actingUserId: state.actingUserId }));
  } catch {
    // ignore: preferences are a convenience only
  }
}
