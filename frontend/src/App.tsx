import { lazy, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useAppSelector } from './app/hooks';
import { AppShell } from './components/layout/app-shell';

const OverviewPage = lazy(() => import('./pages/overview/overview-page').then((m) => ({ default: m.OverviewPage })));
const OrdersPage = lazy(() => import('./pages/orders/orders-page').then((m) => ({ default: m.OrdersPage })));
const NewOrderPage = lazy(() => import('./pages/orders/new-order-page').then((m) => ({ default: m.NewOrderPage })));
const OrderDetailPage = lazy(() => import('./pages/orders/order-detail-page').then((m) => ({ default: m.OrderDetailPage })));
const InventoryPage = lazy(() => import('./pages/inventory/inventory-page').then((m) => ({ default: m.InventoryPage })));
const InventoryDetailPage = lazy(() => import('./pages/inventory/inventory-detail-page').then((m) => ({ default: m.InventoryDetailPage })));
const SupplyPage = lazy(() => import('./pages/supply/supply-page').then((m) => ({ default: m.SupplyPage })));
const ReceiptDetailPage = lazy(() => import('./pages/supply/receipt-detail-page').then((m) => ({ default: m.ReceiptDetailPage })));
const LocationsPage = lazy(() => import('./pages/locations/locations-page').then((m) => ({ default: m.LocationsPage })));
const LocationDetailPage = lazy(() => import('./pages/locations/location-detail-page').then((m) => ({ default: m.LocationDetailPage })));
const ProductsPage = lazy(() => import('./pages/products/products-page').then((m) => ({ default: m.ProductsPage })));
const SkuDetailPage = lazy(() => import('./pages/products/sku-detail-page').then((m) => ({ default: m.SkuDetailPage })));
const ExceptionsPage = lazy(() => import('./pages/exceptions/exceptions-page').then((m) => ({ default: m.ExceptionsPage })));
const AiAssistantPage = lazy(() => import('./pages/ai/ai-assistant-page').then((m) => ({ default: m.AiAssistantPage })));
const AuditPage = lazy(() => import('./pages/audit/audit-page').then((m) => ({ default: m.AuditPage })));
const SettingsPage = lazy(() => import('./pages/settings/settings-page').then((m) => ({ default: m.SettingsPage })));
const NotFoundPage = lazy(() => import('./pages/not-found-page').then((m) => ({ default: m.NotFoundPage })));

/** Applies the theme preference to the document root (light is the default). */
function useThemeSync() {
  const theme = useAppSelector((s) => s.ui.theme);
  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      root.classList.toggle('dark', dark);
    };
    apply();
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

export function App() {
  useThemeSync();
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/new" element={<NewOrderPage />} />
        <Route path="orders/:id" element={<OrderDetailPage />} />
        <Route path="inventory" element={<InventoryPage />} />
        <Route path="inventory/:id" element={<InventoryDetailPage />} />
        <Route path="supply" element={<SupplyPage />} />
        <Route path="supply/receipts/:id" element={<ReceiptDetailPage />} />
        <Route path="locations" element={<LocationsPage />} />
        <Route path="locations/:id" element={<LocationDetailPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="products/:id" element={<SkuDetailPage />} />
        <Route path="exceptions" element={<ExceptionsPage />} />
        <Route path="ai" element={<AiAssistantPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
