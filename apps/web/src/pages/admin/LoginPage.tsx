/** Acceso al backoffice y alta de un restaurante nuevo. */
import { useState, type ReactNode } from 'react';

import { ApiError, adminApi, setToken } from '../../lib/api.js';
import { slugifyName } from '../../lib/slug.js';
import { useAuth } from '../../store/auth.js';

export function LoginPage(): ReactNode {
  const { login } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        const response = await adminApi.register({
          restaurantName,
          slug: slugifyName(restaurantName),
          ownerName,
          email,
          password,
        });
        setToken(response.token);
        // Recarga completa: es la forma mas simple de rehidratar la sesion nueva
        // sin duplicar la logica del AuthProvider.
        window.location.assign('/admin');
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'No pudimos completar la operacion',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="container stack stack-5"
      style={{ paddingTop: 56, paddingBottom: 40, maxWidth: 420 }}
    >
      <header className="stack stack-2">
        <span className="badge badge-3d" style={{ alignSelf: 'flex-start' }}>
          Men-3D
        </span>
        <h1>{mode === 'login' ? 'Entrar al panel' : 'Crear mi carta'}</h1>
        <p className="small secondary">
          {mode === 'login'
            ? 'Gestiona tu carta, precios, pedidos y metricas.'
            : 'Se crea tu restaurante con 14 dias del plan Pro, sin tarjeta.'}
        </p>
      </header>

      <form className="stack stack-3" onSubmit={submit}>
        {mode === 'register' && (
          <>
            <label className="field">
              <span className="label">Nombre del restaurante</span>
              <input
                className="input"
                required
                value={restaurantName}
                onChange={(e) => setRestaurantName(e.target.value)}
              />
              {restaurantName && (
                <span className="tiny muted">
                  Tu carta va a estar en /m/{slugifyName(restaurantName)}
                </span>
              )}
            </label>
            <label className="field">
              <span className="label">Tu nombre</span>
              <input
                className="input"
                required
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
              />
            </label>
          </>
        )}

        <label className="field">
          <span className="label">Email</span>
          <input
            className="input"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="field">
          <span className="label">Contraseña</span>
          <input
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Un momento...' : mode === 'login' ? 'Entrar' : 'Crear mi carta'}
        </button>
      </form>

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => {
          setMode(mode === 'login' ? 'register' : 'login');
          setError(null);
        }}
      >
        {mode === 'login' ? 'No tengo cuenta todavia' : 'Ya tengo cuenta'}
      </button>

      {import.meta.env.DEV && (
        <div className="card card-pad stack stack-2">
          <span className="tiny bold secondary">Cuentas de demostracion</span>
          <code className="tiny">pepe@donpepe.demo · men3d-demo-2026 (plan Pro)</code>
          <code className="tiny">hola@verdebowl.demo · men3d-demo-2026 (plan Starter)</code>
        </div>
      )}
    </div>
  );
}
