import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: 'PLANNER' | 'SUPPORT' | 'ADMIN';
}

/**
 * checking   - a refresh token exists and we are asking the server whether it is still valid
 * signedOut  - show the login page
 * signedIn   - show the app
 */
export type AuthStatus = 'checking' | 'signedOut' | 'signedIn';

export interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  /** Short-lived access token. Kept in memory only (never written to storage). */
  accessToken: string | null;
}

export const REFRESH_TOKEN_KEY = 'sct.refreshToken';

export function readRefreshToken(): string | null {
  try {
    return window.localStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null; // storage blocked: the user simply has to sign in again after a reload
  }
}

export function writeRefreshToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
    else window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // ignore
  }
}

const initialState: AuthState = {
  status: readRefreshToken() ? 'checking' : 'signedOut',
  user: null,
  accessToken: null,
};

export const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    sessionStarted(state, action: PayloadAction<{ accessToken: string; user: AuthUser }>) {
      state.status = 'signedIn';
      state.accessToken = action.payload.accessToken;
      state.user = action.payload.user;
    },
    sessionEnded(state) {
      state.status = 'signedOut';
      state.accessToken = null;
      state.user = null;
    },
  },
});

export const { sessionStarted, sessionEnded } = authSlice.actions;
export const authReducer = authSlice.reducer;
