/**
 * Rutas de la aplicacion.
 *
 *   /                          portada de la plataforma
 *   /m/:slug                   carta publica (y sus subrutas)
 *   /admin/*                   backoffice del restaurante
 *
 * El backoffice se carga con `lazy`: un comensal que escanea un QR no deberia
 * descargar las pantallas de administracion ni los graficos del panel.
 */
import { Suspense, lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { Spinner } from './components/ui.js';
import { CartPage } from './pages/public/CartPage.js';
import { DishPage } from './pages/public/DishPage.js';
import { LandingPage } from './pages/public/LandingPage.js';
import { MenuLayout } from './pages/public/MenuLayout.js';
import { MenuPage } from './pages/public/MenuPage.js';
import { OrderStatusPage } from './pages/public/OrderStatusPage.js';
import { VenuePage } from './pages/public/VenuePage.js';
import { AuthProvider } from './store/auth.js';

const AdminLayout = lazy(() =>
  import('./pages/admin/AdminLayout.js').then((m) => ({ default: m.AdminLayout })),
);
const DashboardPage = lazy(() =>
  import('./pages/admin/DashboardPage.js').then((m) => ({ default: m.DashboardPage })),
);
const DishesPage = lazy(() =>
  import('./pages/admin/DishesPage.js').then((m) => ({ default: m.DishesPage })),
);
const DishEditorPage = lazy(() =>
  import('./pages/admin/DishEditorPage.js').then((m) => ({ default: m.DishEditorPage })),
);
const KdsPage = lazy(() =>
  import('./pages/admin/KdsPage.js').then((m) => ({ default: m.KdsPage })),
);
const ReviewsPage = lazy(() =>
  import('./pages/admin/ReviewsPage.js').then((m) => ({ default: m.ReviewsPage })),
);
const BrandingPage = lazy(() =>
  import('./pages/admin/BrandingPage.js').then((m) => ({ default: m.BrandingPage })),
);
const QrPage = lazy(() =>
  import('./pages/admin/QrPage.js').then((m) => ({ default: m.QrPage })),
);
const VenueSettingsPage = lazy(() =>
  import('./pages/admin/VenueSettingsPage.js').then((m) => ({
    default: m.VenueSettingsPage,
  })),
);
const PlanPage = lazy(() =>
  import('./pages/admin/PlanPage.js').then((m) => ({ default: m.PlanPage })),
);
const TeamPage = lazy(() =>
  import('./pages/admin/TeamPage.js').then((m) => ({ default: m.TeamPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('./pages/admin/PasswordPages.js').then((m) => ({
    default: m.ForgotPasswordPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import('./pages/admin/PasswordPages.js').then((m) => ({
    default: m.ResetPasswordPage,
  })),
);

export function App(): ReactNode {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />

      {/* --- carta publica --- */}
      <Route path="/m/:slug" element={<MenuLayout />}>
        <Route index element={<MenuPage />} />
        <Route path="plato/:dishId" element={<DishPage />} />
        <Route path="local" element={<VenuePage />} />
        <Route path="pedido" element={<CartPage />} />
        <Route path="pedido/:code" element={<OrderStatusPage />} />
      </Route>

      {/* --- recuperacion de contraseña: fuera del guardia de sesion, porque
              quien no puede entrar es justamente quien las necesita --- */}
      <Route path="/admin/recuperar" element={<Lazy element={<ForgotPasswordPage />} />} />
      <Route path="/admin/nueva-clave" element={<Lazy element={<ResetPasswordPage />} />} />

      {/* --- backoffice --- */}
      <Route
        path="/admin"
        element={
          <AuthProvider>
            <Suspense fallback={<Spinner label="Cargando el panel" />}>
              <AdminLayout />
            </Suspense>
          </AuthProvider>
        }
      >
        <Route index element={<Lazy element={<DashboardPage />} />} />
        <Route path="carta" element={<Lazy element={<DishesPage />} />} />
        <Route path="carta/nuevo" element={<Lazy element={<DishEditorPage />} />} />
        <Route path="carta/:dishId" element={<Lazy element={<DishEditorPage />} />} />
        <Route path="cocina" element={<Lazy element={<KdsPage />} />} />
        <Route path="opiniones" element={<Lazy element={<ReviewsPage />} />} />
        <Route path="marca" element={<Lazy element={<BrandingPage />} />} />
        <Route path="qr" element={<Lazy element={<QrPage />} />} />
        <Route path="local" element={<Lazy element={<VenueSettingsPage />} />} />
        <Route path="plan" element={<Lazy element={<PlanPage />} />} />
        <Route path="equipo" element={<Lazy element={<TeamPage />} />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function Lazy({ element }: { element: ReactNode }): ReactNode {
  return <Suspense fallback={<Spinner />}>{element}</Suspense>;
}
