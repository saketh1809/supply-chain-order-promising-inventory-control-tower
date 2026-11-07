import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';
import { Toaster } from './toaster';

/** Shown while a route's code chunk loads. */
function RouteFallback() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading page">
      <div className="h-8 w-64 animate-pulse rounded-md bg-muted" />
      <div className="h-72 w-full animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
          {/* Enter-only fade keyed by route: no exit wait, so the new page is interactive immediately. */}
          <motion.div key={pathname.split('/').slice(0, 2).join('/')} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.16 }} className="mx-auto max-w-[1400px]">
            <Suspense fallback={<RouteFallback />}>
              <Outlet />
            </Suspense>
          </motion.div>
        </main>
        <Toaster />
      </div>
    </div>
  );
}
