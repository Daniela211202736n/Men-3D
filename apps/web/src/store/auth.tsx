/**
 * Sesion del backoffice.
 *
 * El token se guarda en localStorage y se rehidrata contra `/auth/me` al
 * arrancar: asi un token vencido manda al login en vez de dejar la pantalla a
 * medio cargar.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { AuthUserDto, Feature, PlanTier } from '@men3d/shared';

import { ApiError, adminApi, getToken, setToken } from '../lib/api.js';

interface AuthState {
  user: AuthUserDto | null;
  plan: { tier: PlanTier; features: Feature[] } | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** `true` si el plan del restaurante incluye la funcionalidad. */
  can: (feature: Feature) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<AuthState>({
    user: null,
    plan: null,
    loading: Boolean(getToken()),
  });

  useEffect(() => {
    if (!getToken()) return;
    const controller = new AbortController();

    adminApi
      .me(controller.signal)
      .then(({ user, plan }) => setState({ user, plan, loading: false }))
      .catch((error: unknown) => {
        // Una peticion cancelada no dice nada sobre la sesion: pasa en cada
        // desmontaje rapido y en el doble montaje de StrictMode. Tratarla como
        // fallo de autenticacion borraba el token de una sesion perfectamente
        // valida y echaba al usuario al login.
        if (controller.signal.aborted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;

        // Solo un 401/403 significa que el token ya no sirve. Ante un fallo de
        // red conviene conservarlo y dejar que el proximo intento resuelva.
        const isAuthFailure =
          error instanceof ApiError && (error.status === 401 || error.status === 403);
        if (isAuthFailure) setToken(null);
        setState({ user: null, plan: null, loading: false });
      });

    return () => controller.abort();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const response = await adminApi.login(email, password);
    setToken(response.token);
    setState({ user: response.user, plan: response.plan, loading: false });
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setState({ user: null, plan: null, loading: false });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      logout,
      can: (feature) => Boolean(state.plan?.features.includes(feature)),
    }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return context;
}
