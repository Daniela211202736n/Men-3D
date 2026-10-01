/** Avisos breves ("Agregado al pedido"). Se apilan y se van solos. */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'error';
}

interface ToastContextValue {
  show: (message: string, kind?: 'info' | 'error') => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, kind: 'info' | 'error' = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, kind }]);
    setTimeout(
      () => setToasts((current) => current.filter((t) => t.id !== id)),
      kind === 'error' ? 5000 : 2600,
    );
  }, []);

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* `role=status` + `aria-live` para que un lector de pantalla lo anuncie. */}
      <div className="toast-wrap" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast${toast.kind === 'error' ? ' is-error' : ''}`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast debe usarse dentro de <ToastProvider>');
  return context;
}
