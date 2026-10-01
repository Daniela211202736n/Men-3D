/**
 * Equipo del restaurante.
 *
 * Las reglas las aplica el servidor; aca se reflejan para que no haya botones
 * que solo sirven para recibir un error: nadie se ve un boton para darse de
 * baja a si mismo ni para degradar al unico dueño.
 */
import { useState, type ReactNode } from 'react';

import type { TeamUserDto } from '@men3d/shared';

import { ErrorState, Spinner } from '../../components/ui.js';
import { ApiError, adminApi } from '../../lib/api.js';
import { relativeTime } from '../../lib/format.js';
import { useAsync } from '../../lib/useAsync.js';
import { useAuth } from '../../store/auth.js';
import { useToast } from '../../store/toast.js';

const ROLES: Record<string, string> = {
  OWNER: 'Dueño',
  ADMIN: 'Administrador',
  STAFF: 'Cocina',
  SUPPORT: 'Soporte',
};

const DESCRIPCION_ROL: Record<string, string> = {
  ADMIN: 'Carta, precios, marca, metricas y equipo.',
  STAFF: 'Solo la pantalla de cocina.',
};

export function TeamPage(): ReactNode {
  const toast = useToast();
  const { user } = useAuth();
  // El nav no muestra esta pantalla a quien no la puede usar, pero la URL se
  // puede escribir a mano o quedar en un favorito. En ese caso explicamos el
  // permiso en lugar de pedir datos que el servidor va a negar y mostrar el 403
  // crudo, que parece una falla del sistema y no una regla.
  const puedeVerElEquipo = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const { data: equipo, loading, error, reload } = useAsync(
    (signal) => (puedeVerElEquipo ? adminApi.team(signal) : Promise.resolve([])),
    [puedeVerElEquipo],
  );
  const [creando, setCreando] = useState(false);

  const soyDueño = user?.role === 'OWNER';
  const dueñosActivos =
    equipo?.filter((u) => u.role === 'OWNER' && u.isActive).length ?? 0;

  const accion = async (fn: () => Promise<unknown>, exito: string) => {
    try {
      await fn();
      toast.show(exito);
      reload();
    } catch (caught) {
      toast.show(
        caught instanceof ApiError ? caught.message : 'No se pudo completar',
        'error',
      );
    }
  };

  if (!puedeVerElEquipo) {
    return (
      <div className="stack stack-3" style={{ maxWidth: 520 }}>
        <h1>Equipo</h1>
        <p className="secondary">
          Esta pantalla la manejan el dueño y los administradores del local.
          Pedile a quien administre la cuenta que haga el cambio que necesitas.
        </p>
      </div>
    );
  }

  if (loading && !equipo) return <Spinner label="Cargando el equipo" />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;

  return (
    <div className="stack stack-5" style={{ maxWidth: 820 }}>
      <header className="row-between wrap">
        <div className="stack" style={{ gap: 2 }}>
          <h1>Equipo</h1>
          <p className="small muted">
            Quien puede entrar al panel y que puede hacer.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => setCreando((v) => !v)}
        >
          {creando ? 'Cancelar' : '+ Sumar a alguien'}
        </button>
      </header>

      {creando && (
        <AltaDeUsuario
          onCreated={() => {
            setCreando(false);
            reload();
          }}
        />
      )}

      <ul className="stack stack-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {equipo?.map((integrante) => (
          <FichaDeEquipo
            key={integrante.id}
            integrante={integrante}
            soyDueño={soyDueño}
            esUnicoDueño={integrante.role === 'OWNER' && dueñosActivos <= 1}
            onAccion={accion}
          />
        ))}
      </ul>

      <CambiarMiContrasenia />
    </div>
  );
}

/**
 * Una persona del equipo.
 *
 * Ficha y no fila de tabla a proposito: con nombre, email, rol, ultimo acceso y
 * acciones, cinco columnas no entran en un telefono, y lo primero que se sale de
 * la pantalla es justo la columna de acciones —que en esta pantalla es el
 * contenido, no un adorno. Apilado entra entero en 414px sin desplazar nada.
 */
function FichaDeEquipo({
  integrante,
  soyDueño,
  esUnicoDueño,
  onAccion,
}: {
  integrante: TeamUserDto;
  soyDueño: boolean;
  esUnicoDueño: boolean;
  onAccion: (fn: () => Promise<unknown>, exito: string) => Promise<void>;
}): ReactNode {
  // El servidor rechaza estas acciones igual; esconderlas evita ofrecer un
  // boton cuyo unico efecto seria un mensaje de error.
  const puedoAdministrarlo =
    !integrante.isSelf && (integrante.role !== 'OWNER' || soyDueño) && !esUnicoDueño;

  return (
    <li
      className="card card-pad stack stack-3"
      style={integrante.isActive ? undefined : { opacity: 0.55 }}
    >
      <div className="row-between wrap" style={{ gap: 8 }}>
        <div className="stack" style={{ gap: 2, minWidth: 0 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="bold">{integrante.name}</span>
            {integrante.isSelf && <span className="badge">vos</span>}
            {!integrante.isActive && (
              <span className="badge badge-critical">de baja</span>
            )}
          </div>
          <span className="secondary small truncate" title={integrante.email}>
            {integrante.email}
          </span>
        </div>
        <span className={integrante.role === 'OWNER' ? 'badge badge-good' : 'badge'}>
          {ROLES[integrante.role] ?? integrante.role}
        </span>
      </div>

      <span className="tiny muted">
        {integrante.lastLoginAt
          ? `Ultimo acceso ${relativeTime(integrante.lastLoginAt)}`
          : 'Nunca entro'}
      </span>

      <div className="row wrap" style={{ gap: 6 }}>
        {puedoAdministrarlo && integrante.isActive && integrante.role !== 'OWNER' && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() =>
              void onAccion(
                () =>
                  adminApi.updateTeamUser(integrante.id, {
                    role: integrante.role === 'ADMIN' ? 'STAFF' : 'ADMIN',
                  }),
                'Rol actualizado',
              )
            }
          >
            {integrante.role === 'ADMIN' ? 'Pasar a cocina' : 'Pasar a admin'}
          </button>
        )}

        {soyDueño && integrante.isActive && integrante.role === 'ADMIN' && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              if (
                !window.confirm(
                  `¿Transferir la titularidad a ${integrante.name}? Vos pasas a administrador.`,
                )
              ) {
                return;
              }
              void onAccion(
                () => adminApi.transferOwnership(integrante.id),
                'Titularidad transferida',
              );
            }}
          >
            Hacer dueño
          </button>
        )}

        {puedoAdministrarlo &&
          (integrante.isActive ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-danger"
              onClick={() =>
                void onAccion(
                  () => adminApi.deactivateTeamUser(integrante.id),
                  `${integrante.name} ya no tiene acceso`,
                )
              }
            >
              Dar de baja
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() =>
                void onAccion(
                  () => adminApi.updateTeamUser(integrante.id, { isActive: true }),
                  `${integrante.name} vuelve a tener acceso`,
                )
              }
            >
              Reactivar
            </button>
          ))}
      </div>
    </li>
  );
}

function AltaDeUsuario({ onCreated }: { onCreated: () => void }): ReactNode {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'STAFF'>('STAFF');
  const [enviando, setEnviando] = useState(false);

  return (
    <form
      className="card card-pad stack stack-3"
      onSubmit={async (event) => {
        event.preventDefault();
        if (enviando) return;
        setEnviando(true);
        try {
          await adminApi.createTeamUser({ email, name, password, role });
          toast.show(`${name} ya puede entrar`);
          onCreated();
        } catch (caught) {
          toast.show(
            caught instanceof ApiError ? caught.message : 'No se pudo crear',
            'error',
          );
        } finally {
          setEnviando(false);
        }
      }}
    >
      <h3>Sumar a alguien</h3>
      <div className="row wrap" style={{ gap: 12 }}>
        <label className="field grow">
          <span className="label">Nombre</span>
          <input
            className="input"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field grow">
          <span className="label">Email</span>
          <input
            className="input"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
      </div>
      <div className="row wrap" style={{ gap: 12 }}>
        <label className="field grow">
          <span className="label">Contraseña inicial</span>
          <input
            className="input"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <span className="tiny muted">
            Se la pasas vos; despues puede cambiarla desde su cuenta.
          </span>
        </label>
        <label className="field grow">
          <span className="label">Rol</span>
          <select
            className="select"
            value={role}
            onChange={(e) => setRole(e.target.value as 'ADMIN' | 'STAFF')}
          >
            <option value="STAFF">Cocina</option>
            <option value="ADMIN">Administrador</option>
          </select>
          <span className="tiny muted">{DESCRIPCION_ROL[role]}</span>
        </label>
      </div>
      <button type="submit" className="btn btn-primary" disabled={enviando}>
        {enviando ? 'Creando...' : 'Crear cuenta'}
      </button>
    </form>
  );
}

function CambiarMiContrasenia(): ReactNode {
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [enviando, setEnviando] = useState(false);

  if (!abierto) {
    return (
      <button type="button" className="btn btn-sm" onClick={() => setAbierto(true)}>
        Cambiar mi contraseña
      </button>
    );
  }

  return (
    <form
      className="card card-pad stack stack-3"
      style={{ maxWidth: 420 }}
      onSubmit={async (event) => {
        event.preventDefault();
        if (enviando) return;
        setEnviando(true);
        try {
          await adminApi.changePassword(actual, nueva);
          toast.show('Contraseña actualizada');
          setAbierto(false);
          setActual('');
          setNueva('');
        } catch (caught) {
          toast.show(
            caught instanceof ApiError ? caught.message : 'No se pudo cambiar',
            'error',
          );
        } finally {
          setEnviando(false);
        }
      }}
    >
      <h3>Cambiar mi contraseña</h3>
      <label className="field">
        <span className="label">Contraseña actual</span>
        <input
          className="input"
          type="password"
          required
          autoComplete="current-password"
          value={actual}
          onChange={(e) => setActual(e.target.value)}
        />
      </label>
      <label className="field">
        <span className="label">Nueva contraseña</span>
        <input
          className="input"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
        />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={enviando}>
          {enviando ? 'Guardando...' : 'Guardar'}
        </button>
        <button type="button" className="btn" onClick={() => setAbierto(false)}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
