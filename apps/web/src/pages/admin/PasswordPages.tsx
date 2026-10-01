/**
 * Recuperacion de contraseña: pedir el enlace y fijar la nueva.
 *
 * Las dos pantallas viven fuera del guardia de sesion —quien no puede entrar es
 * justamente el que las necesita— y repiten lo que decide el servidor: pedir un
 * enlace responde siempre lo mismo, exista o no la cuenta.
 */
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ApiError, adminApi } from '../../lib/api.js';

function Marco({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <div
      className="container stack stack-5"
      style={{ paddingTop: 56, paddingBottom: 40, maxWidth: 420 }}
    >
      <header className="stack stack-2">
        <span className="badge badge-3d" style={{ alignSelf: 'flex-start' }}>
          Men-3D
        </span>
        <h1>{title}</h1>
      </header>
      {children}
    </div>
  );
}

export function ForgotPasswordPage(): ReactNode {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);

  if (enviado) {
    return (
      <Marco title="Revisa tu correo">
        <p className="secondary">
          Si existe una cuenta con <strong>{email}</strong>, va a recibir un enlace para
          elegir una contraseña nueva. Vence en una hora y sirve una sola vez.
        </p>
        <p className="small muted">
          ¿No llego? Revisa el correo no deseado, o volve a pedirlo en unos minutos.
        </p>
        <Link to="/admin" className="btn">
          Volver a entrar
        </Link>
      </Marco>
    );
  }

  return (
    <Marco title="Recuperar el acceso">
      <p className="small secondary">
        Te mandamos un enlace para elegir una contraseña nueva.
      </p>
      <form
        className="stack stack-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (enviando) return;
          setEnviando(true);
          try {
            await adminApi.forgotPassword(email);
          } catch {
            // El servidor responde igual exista o no la cuenta; un fallo de red
            // tampoco deberia revelar nada, asi que la pantalla no cambia.
          } finally {
            setEnviando(false);
            setEnviado(true);
          }
        }}
      >
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
        <button type="submit" className="btn btn-primary btn-block" disabled={enviando}>
          {enviando ? 'Enviando...' : 'Mandarme el enlace'}
        </button>
      </form>
      <Link to="/admin" className="btn btn-ghost btn-sm">
        Volver
      </Link>
    </Marco>
  );
}

export function ResetPasswordPage(): ReactNode {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!token) {
    return (
      <Marco title="Enlace incompleto">
        <p className="secondary">
          Este enlace no trae el codigo de verificacion. Volve a pedir uno.
        </p>
        <Link to="/admin/recuperar" className="btn btn-primary">
          Pedir un enlace nuevo
        </Link>
      </Marco>
    );
  }

  return (
    <Marco title="Elegi tu contraseña nueva">
      <form
        className="stack stack-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (enviando) return;
          if (password !== repetida) {
            setError('Las dos contraseñas no coinciden');
            return;
          }
          setEnviando(true);
          setError(null);
          try {
            await adminApi.resetPassword(token, password);
            // Al login, no al panel: la sesion se abre con la contraseña nueva.
            navigate('/admin', { replace: true });
          } catch (caught) {
            setError(
              caught instanceof ApiError
                ? caught.message
                : 'No pudimos cambiar la contraseña',
            );
          } finally {
            setEnviando(false);
          }
        }}
      >
        <label className="field">
          <span className="label">Nueva contraseña</span>
          <input
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="tiny muted">Minimo 8 caracteres.</span>
        </label>
        <label className="field">
          <span className="label">Repetila</span>
          <input
            className="input"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
          />
        </label>

        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn-primary btn-block" disabled={enviando}>
          {enviando ? 'Guardando...' : 'Guardar y entrar'}
        </button>
      </form>
    </Marco>
  );
}
