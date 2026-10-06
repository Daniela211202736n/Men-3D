/**
 * "Sacale una foto al plato y te armo el 3D".
 *
 * **Lo que esta pantalla tiene que lograr no es subir un archivo: es que la
 * foto este bien sacada.** Todo lo demas —el proveedor, la cola, la
 * compresion— ya esta resuelto y da igual de bien o de mal; lo unico que
 * cambia el resultado de verdad es desde donde y con que luz se fotografio el
 * plato. Por eso la guia no es un parrafo de ayuda escondido: es la mitad del
 * componente, y esta antes del boton.
 *
 * Las tres reglas que mas mueven la aguja, en orden:
 *
 *   1. **Tres cuartos**, no desde arriba. Una foto cenital no tiene volumen y
 *      el modelo sale plano, que es exactamente lo que nadie quiere.
 *   2. **Fondo liso y el plato entero**. Lo que el generador no distingue del
 *      mantel, lo modela como parte del plato.
 *   3. **Luz pareja, sin flash**. El flash quema el brillo de la salsa y
 *      despues eso queda cocinado en la textura para siempre.
 *
 * Generar cuesta creditos que paga el restaurante, asi que el boton lo dice y
 * no se puede tocar dos veces: mientras hay un trabajo en curso queda
 * bloqueado, y la API ademas lo rechaza del otro lado.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import {
  ApiError,
  adminApi,
  generarModeloDesdeFoto,
  type ModelJobDto,
} from '../lib/api.js';
import { prepararFoto } from '../lib/preparar-foto.js';

/** Cada cuanto se le pregunta a la API como viene. */
const CADA_MS = 4000;

const CONSEJOS = [
  ['Ponete en diagonal', 'A unos 45 grados y a la altura de la mesa. Desde arriba el plato sale chato.'],
  ['Fondo liso', 'Una mesa o un mantel sin dibujos. Lo que no se distinga del fondo entra al modelo.'],
  ['Que entre entero', 'El plato completo y centrado, sin cubiertos ni vasos encima.'],
  ['Luz pareja, sin flash', 'Cerca de una ventana. El flash quema los brillos y quedan pegados a la textura.'],
];

export function FotoA3D({
  dishId,
  onModelo,
}: {
  /** `null` en un plato que todavia no se guardo. */
  dishId: string | null;
  /** Se llama cuando el modelo quedo listo, con las URLs definitivas. */
  onModelo: (modelo: { glbUrl: string; photoUrl: string | null }) => void;
}): ReactNode {
  const [disponible, setDisponible] = useState<boolean | null>(null);
  const [trabajo, setTrabajo] = useState<ModelJobDto | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  // Para no avisar dos veces del mismo modelo si el panel vuelve a consultar.
  const avisado = useRef<string | null>(null);

  useEffect(() => {
    const corte = new AbortController();
    adminApi
      .modelado(corte.signal)
      .then((estado) => setDisponible(estado.enabled))
      .catch(() => setDisponible(false));
    return () => corte.abort();
  }, []);

  // Al abrir un plato ya guardado se retoma lo que hubiera quedado en curso.
  useEffect(() => {
    if (!dishId || disponible !== true) return;
    const corte = new AbortController();
    adminApi
      .modelJobDeDish(dishId, corte.signal)
      .then((ultimo) => {
        if (ultimo && ultimo.status !== 'FAILED') setTrabajo(ultimo);
      })
      .catch(() => undefined);
    return () => corte.abort();
  }, [dishId, disponible]);

  const enCurso = trabajo?.status === 'QUEUED' || trabajo?.status === 'RUNNING';

  // Mientras hay un trabajo en curso se pregunta cada pocos segundos. Esa misma
  // consulta es la que lo empuja del lado del servidor.
  useEffect(() => {
    if (!enCurso || !trabajo) return;
    let vivo = true;
    const reloj = setInterval(() => {
      adminApi
        .modelJob(trabajo.id)
        .then((nuevo) => {
          if (vivo) setTrabajo(nuevo);
        })
        .catch(() => undefined);
    }, CADA_MS);
    return () => {
      vivo = false;
      clearInterval(reloj);
    };
  }, [enCurso, trabajo]);

  useEffect(() => {
    if (trabajo?.status !== 'READY' || !trabajo.glbUrl) return;
    if (avisado.current === trabajo.id) return;
    avisado.current = trabajo.id;
    onModelo({ glbUrl: trabajo.glbUrl, photoUrl: trabajo.photoUrl });
  }, [trabajo, onModelo]);

  const mandar = useCallback(
    async (file: File) => {
      if (!dishId || enviando) return;
      setEnviando(true);
      setError(null);
      try {
        const liviana = await prepararFoto(file);
        setTrabajo(await generarModeloDesdeFoto(dishId, liviana));
      } catch (capturado) {
        setError(
          capturado instanceof ApiError
            ? capturado.message
            : 'No se pudo mandar la foto. Reintenta en un momento.',
        );
      } finally {
        setEnviando(false);
        if (entrada.current) entrada.current.value = '';
      }
    },
    [dishId, enviando],
  );

  if (disponible !== true) return null;

  return (
    <div className="card card-pad stack stack-3 foto-a-3d">
      <div className="stack" style={{ gap: 2 }}>
        <span className="bold">Sacale una foto y armamos el 3D</span>
        <span className="tiny muted">
          Una sola foto del plato servido. Tarda entre uno y cinco minutos, y podes
          cerrar esta pantalla: cuando vuelvas va a estar.
        </span>
      </div>

      <ul className="consejos">
        {CONSEJOS.map(([titulo, detalle]) => (
          <li key={titulo}>
            <span className="small bold">{titulo}</span>
            <span className="tiny secondary">{detalle}</span>
          </li>
        ))}
      </ul>

      {!dishId && (
        <p className="small muted" style={{ margin: 0 }}>
          Guarda el plato primero —con el nombre y el precio— y despues sacale la foto.
        </p>
      )}

      {enCurso && trabajo && (
        <div className="stack stack-2" role="status">
          <div className="row-between">
            <span className="small bold">Generando el modelo…</span>
            <span className="tiny muted nums">{trabajo.progress}%</span>
          </div>
          <div className="barra">
            <span className="barra-llena" style={{ width: `${Math.max(4, trabajo.progress)}%` }} />
          </div>
          <span className="tiny muted">
            Podes seguir cargando el resto del plato mientras tanto.
          </span>
        </div>
      )}

      {trabajo?.status === 'READY' && (
        <p className="small" style={{ margin: 0, color: 'var(--good)' }}>
          Listo: el modelo quedo cargado en este plato. Mirá la previsualizacion de
          abajo antes de guardar.
        </p>
      )}

      {trabajo?.status === 'FAILED' && (
        <p className="small" style={{ margin: 0, color: 'var(--critical)' }}>
          No se pudo generar: {trabajo.error ?? 'el proveedor no dio un motivo'}.
        </p>
      )}

      {error && (
        <p className="small" style={{ margin: 0, color: 'var(--critical)' }}>
          {error}
        </p>
      )}

      <input
        ref={entrada}
        type="file"
        accept="image/*"
        // En un celular abre la camara trasera directamente, que es como se usa
        // esto de verdad: parado al lado de la mesa, con el plato servido.
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void mandar(file);
        }}
      />
      <button
        type="button"
        className="btn btn-primary"
        disabled={!dishId || enviando || enCurso}
        onClick={() => entrada.current?.click()}
      >
        {enviando ? 'Mandando la foto…' : enCurso ? 'Generando…' : 'Sacarle una foto al plato'}
      </button>
      <span className="tiny muted">
        Cada modelo generado consume creditos del plan. Si ya tenes el GLB hecho
        aparte, subilo abajo y no gasta nada.
      </span>
    </div>
  );
}
