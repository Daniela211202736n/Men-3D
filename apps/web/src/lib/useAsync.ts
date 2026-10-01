/**
 * Hook minimo para cargar datos con cancelacion.
 *
 * Reemplaza a react-query en este MVP: con ~15 pantallas y cargas simples, 200
 * bytes de hook propio pesan menos que una libreria de cache en la primera
 * visita de un celular.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  /** Vuelve a ejecutar la carga (para el boton "Reintentar"). */
  reload: () => void;
  /** Actualiza los datos en memoria sin ir al servidor (respuesta optimista). */
  setData: (updater: T | ((current: T | null) => T | null)) => void;
}

export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  // Evita el warning de "setState en componente desmontado" en React 19.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    loader(controller.signal)
      .then((result) => {
        if (!mounted.current || controller.signal.aborted) return;
        setData(result);
      })
      .catch((caught: unknown) => {
        // Una carga abortada no es un error: paso porque el usuario navego.
        if (controller.signal.aborted) return;
        if (!mounted.current) return;
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      })
      .finally(() => {
        if (mounted.current && !controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  const update = useCallback(
    (updater: T | ((current: T | null) => T | null)) => {
      setData((current) =>
        typeof updater === 'function'
          ? (updater as (c: T | null) => T | null)(current)
          : updater,
      );
    },
    [],
  );

  return { data, error, loading, reload, setData: update };
}

/** Valor que se actualiza recien despues de `delay` ms sin cambios. */
export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
