/**
 * Address of the backend API.
 * - Local development: leave VITE_API_BASE unset. Requests go to the same address and the Vite dev
 *   server forwards /api to the backend.
 * - Render: set VITE_API_BASE to the backend URL (for example https://my-backend.onrender.com, no
 *   trailing slash) when building the Static Site, so the browser calls the backend directly.
 */
export const API_BASE: string = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '');
export const API_URL = `${API_BASE}/api/v1`;