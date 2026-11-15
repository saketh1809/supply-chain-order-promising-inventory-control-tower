import type { AppDispatch } from '../../app/store';
import { readRefreshToken, sessionEnded, sessionStarted, writeRefreshToken, type AuthUser } from './authSlice';

import { API_URL as BASE } from '../../lib/config';

interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

export class AuthError extends Error {
  constructor(message: string, public readonly code?: string, public readonly status?: number) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown, accessToken?: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError('The API is unreachable. Check your connection and try again.', 'NETWORK');
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const fallback = res.status >= 500 ? 'The API is not responding yet. If the server was asleep, wait a minute and try again.' : 'Request failed.';
    throw new AuthError(json?.error?.message ?? fallback, json?.error?.code, res.status);
  }
  return json.data as T;
}

function applyPair(dispatch: AppDispatch, pair: TokenPair) {
  writeRefreshToken(pair.refreshToken);
  dispatch(sessionStarted({ accessToken: pair.accessToken, user: pair.user }));
}

export async function signIn(dispatch: AppDispatch, email: string, password: string) {
  applyPair(dispatch, await post<TokenPair>('/auth/login', { email, password }));
}

export async function signOut(dispatch: AppDispatch) {
  const refreshToken = readRefreshToken();
  writeRefreshToken(null);
  dispatch(sessionEnded());
  if (refreshToken) {
    try {
      await post('/auth/logout', { refreshToken });
    } catch {
      // The local session is already gone; the server copy expires on its own.
    }
  }
}

let inflight: Promise<boolean> | null = null;

/**
 * Trades the stored refresh token for a new access token (and a new refresh token).
 * Single-flight: when several requests fail with 401 at once they all wait for ONE refresh call,
 * because every refresh token can be used only once.
 * Resolves true on success. A rejected refresh token ends the session; a network error does not.
 */
export function refreshSession(dispatch: AppDispatch): Promise<boolean> {
  if (!inflight) {
    inflight = attemptRefresh(dispatch).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function attemptRefresh(dispatch: AppDispatch): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = readRefreshToken();
    if (!token) {
      dispatch(sessionEnded());
      return false;
    }
    try {
      applyPair(dispatch, await post<TokenPair>('/auth/refresh', { refreshToken: token }));
      return true;
    } catch (e) {
      if (!(e instanceof AuthError) || e.status !== 401) return false; // offline, rate limited or server asleep: keep the session
      // Another browser tab may have rotated the token a moment ago. If so, retry with its new one.
      if (readRefreshToken() !== token) continue;
      writeRefreshToken(null);
      dispatch(sessionEnded());
      return false;
    }
  }
  return false;
}

export async function changePassword(accessToken: string, currentPassword: string, newPassword: string) {
  await post('/auth/change-password', { currentPassword, newPassword }, accessToken);
}
