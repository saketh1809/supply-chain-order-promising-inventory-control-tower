import { useEffect, type ReactNode } from 'react';
import { api } from '../../app/api';
import { useAppDispatch, useAppSelector } from '../../app/hooks';
import { refreshSession } from '../../features/auth/auth-client';
import { REFRESH_TOKEN_KEY, sessionEnded } from '../../features/auth/authSlice';
import { LoginPage } from '../../pages/auth/login-page';

/**
 * Renders the app only for a signed-in user. On page load it uses the stored refresh token to
 * restore the session; without one it shows the login page.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const status = useAppSelector((s) => s.auth.status);

  useEffect(() => {
    if (status === 'checking') void refreshSession(dispatch);
  }, [status, dispatch]);

  // Never keep another user's cached data after signing out (or after the session expired).
  useEffect(() => {
    if (status === 'signedOut') dispatch(api.util.resetApiState());
  }, [status, dispatch]);

  // Signing out in one tab signs out every tab.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === REFRESH_TOKEN_KEY && e.newValue === null) dispatch(sessionEnded());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [dispatch]);

  if (status === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background" role="status" aria-label="Restoring your session">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  if (status === 'signedOut') return <LoginPage />;
  return <>{children}</>;
}
