/**
 * Marco del backoffice: guardia de sesion y navegacion.
 *
 * Los items que el plan no incluye no se esconden, se muestran deshabilitados y
 * con el motivo: un dueño tiene que poder ver que existe la funcion y que la
 * tiene a un plan de distancia.
 *
 * Los que el rol no permite si se esconden, y la diferencia no es cosmetica: una
 * funcion bloqueada por plan esta a un pago de distancia —mostrarla es la oferta—
 * pero un mozo no puede comprarse el permiso de administrar el equipo. Mostrarsela
 * con candado solo le anuncia que existe una pantalla que no va a poder abrir.
 */
import type { ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import type { Feature, UserRole } from '@men3d/shared';

import { Spinner } from '../../components/ui.js';
import { applyTheme, readTheme } from '../../lib/branding.js';
import { useAuth } from '../../store/auth.js';
import { LoginPage } from './LoginPage.js';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
  feature?: Feature;
  /** Si esta, solo estos roles ven el item. Sin esto, lo ven todos. */
  roles?: UserRole[];
}

const NAV: NavItem[] = [
  { to: '/admin', label: 'Resumen', end: true, feature: 'ADVANCED_ANALYTICS' },
  { to: '/admin/carta', label: 'Carta' },
  { to: '/admin/cocina', label: 'Cocina (KDS)', feature: 'ONLINE_ORDERING' },
  { to: '/admin/opiniones', label: 'Opiniones' },
  { to: '/admin/qr', label: 'QR y compartir' },
  { to: '/admin/marca', label: 'Marca', feature: 'CUSTOM_BRANDING' },
  { to: '/admin/local', label: 'Datos del local' },
  { to: '/admin/equipo', label: 'Equipo', roles: ['OWNER', 'ADMIN'] },
  { to: '/admin/plan', label: 'Plan y uso' },
];

export function AdminLayout(): ReactNode {
  const { user, plan, loading, logout, can } = useAuth();

  if (loading) return <Spinner label="Verificando la sesion" />;
  if (!user) return <LoginPage />;

  return (
    <div className="admin">
      <nav className="admin-nav" aria-label="Secciones del panel">
        <div
          className="stack hide-mobile"
          style={{ gap: 2, padding: '4px 10px 14px' }}
        >
          <strong className="truncate">{user.tenantSlug}</strong>
          <span className="tiny muted">
            {plan?.tier} · {user.role}
          </span>
        </div>

        {NAV.filter((item) => !item.roles || item.roles.includes(user.role)).map((item) => {
          const locked = item.feature ? !can(item.feature) : false;
          return locked ? (
            <span
              key={item.to}
              className="admin-nav-locked"
              title={`Incluido en planes superiores (${item.feature})`}
              style={{
                padding: '10px 12px',
                fontSize: '0.9rem',
                fontWeight: 600,
                color: 'var(--text-muted)',
                whiteSpace: 'nowrap',
                opacity: 0.6,
              }}
            >
              {item.label} 🔒
            </span>
          ) : (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'is-active' : '')}
            >
              {item.label}
            </NavLink>
          );
        })}

        <div className="grow hide-mobile" />

        <div className="row" style={{ gap: 4, padding: '8px 6px 0' }}>
          <a
            className="btn btn-ghost btn-sm"
            href={`/m/${user.tenantSlug}`}
            target="_blank"
            rel="noreferrer"
          >
            Ver carta ↗
          </a>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            aria-label="Cambiar tema"
            onClick={() => applyTheme(readTheme() === 'dark' ? 'light' : 'dark')}
          >
            ☾
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
            Salir
          </button>
        </div>
      </nav>

      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
