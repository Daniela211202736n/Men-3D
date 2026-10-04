/**
 * Pruebas A/B de carta.
 *
 * El trabajo de esta pantalla no es mostrar dos columnas: es **evitar que el
 * dueño cambie sus precios por ruido**. Con cincuenta visitas y dos pedidos de
 * diferencia, B "gana" la mitad de las veces por azar, y una flecha verde hacia
 * la columna mas alta convence a cualquiera.
 *
 * Por eso:
 *
 *  - El veredicto viene del servidor con una prueba de significancia de verdad,
 *    y **se niega a opinar** mientras la muestra no alcance. Acá se muestra tal
 *    cual, con el color de su clase, y el boton de adoptar B no aparece hasta
 *    que haya un ganador.
 *  - En una prueba de PRECIO se avisa que la conversion es la metrica
 *    equivocada: subir el precio baja la conversion y puede subir la plata. Lo
 *    que decide es el ingreso por visita, que esta en la tabla.
 *  - Cerrar adoptando B **le cambia el precio al plato de verdad**, asi que se
 *    pide confirmacion con el valor escrito.
 */
import { useState, type ReactNode } from 'react';

import type { DishDto } from '@men3d/shared';

import { ErrorState, Spinner } from '../../components/ui.js';
import { ApiError, adminApi, type ExperimentResultDto } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { useAsync } from '../../lib/useAsync.js';

const CLASE_A_COLOR: Record<string, string> = {
  'sin-datos': 'var(--text-muted)',
  'falta-muestra': 'var(--warning)',
  'sin-diferencia': 'var(--text-secondary)',
  gana: 'var(--good)',
};

function porcentaje(valor: number | null): string {
  return valor === null ? '—' : `${(valor * 100).toFixed(1)}%`;
}

function Tabla({
  prueba,
  currency,
}: {
  prueba: ExperimentResultDto;
  currency: string;
}): ReactNode {
  const esPrecio = prueba.field === 'PRICE';
  const valor = (v: string): string =>
    esPrecio ? money(Number.parseInt(v, 10), currency) : v;

  return (
    <table className="tabla-ab">
      <thead>
        <tr>
          <th>Variante</th>
          <th>Vistas</th>
          <th>Al carrito</th>
          <th>Pedidos</th>
          <th>Conversión</th>
          <th>Ingreso / visita</th>
        </tr>
      </thead>
      <tbody>
        {prueba.variantes.map((v) => (
          <tr key={v.variant}>
            <td>
              <span className="bold">{v.variant}</span>
              <span className="tiny muted" style={{ display: 'block', maxWidth: 220 }}>
                {valor(v.valor)}
              </span>
            </td>
            <td>{v.vistas}</td>
            <td>{v.alCarrito}</td>
            <td>{v.pedidos}</td>
            <td>{porcentaje(v.conversion)}</td>
            <td>
              {v.ingresoPorVistaCents === null
                ? '—'
                : money(v.ingresoPorVistaCents, currency)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Prueba({
  prueba,
  currency,
  onCambio,
}: {
  prueba: ExperimentResultDto;
  currency: string;
  onCambio: () => void;
}): ReactNode {
  const [ocupado, setOcupado] = useState(false);
  const corriendo = prueba.status === 'RUNNING';
  const puedeAdoptar = prueba.veredicto.clase === 'gana';

  const cerrar = async (winner?: 'A' | 'B'): Promise<void> => {
    if (winner === 'B') {
      const nuevo =
        prueba.field === 'PRICE'
          ? money(Number.parseInt(prueba.variantes[1].valor, 10), currency)
          : 'la descripción de B';
      // Esto escribe sobre el plato: se confirma con el valor a la vista.
      const ok = window.confirm(
        `Adoptar B deja "${prueba.dishName}" con ${nuevo} para todos los comensales. ¿Seguro?`,
      );
      if (!ok) return;
    }
    setOcupado(true);
    try {
      await adminApi.stopExperiment(prueba.id, winner);
      onCambio();
    } finally {
      setOcupado(false);
    }
  };

  return (
    <li className="card card-pad stack stack-3">
      <div className="row-between">
        <span className="stack" style={{ gap: 2 }}>
          <span className="bold">{prueba.dishName}</span>
          <span className="tiny muted">
            {prueba.field === 'PRICE' ? 'Precio' : 'Descripción'} ·{' '}
            {corriendo
              ? `corriendo desde ${new Date(prueba.startedAt).toLocaleDateString('es-AR')}`
              : `cerrada${prueba.winner ? `, gano ${prueba.winner}` : ' sin decidir'}`}
          </span>
        </span>
        {corriendo && <span className="badge badge-good">en curso</span>}
      </div>

      <Tabla prueba={prueba} currency={currency} />

      <p
        className="small"
        style={{ margin: 0, color: CLASE_A_COLOR[prueba.veredicto.clase] }}
        data-testid={`veredicto-${prueba.veredicto.clase}`}
      >
        {prueba.veredicto.mensaje}
      </p>

      {prueba.avisoDePrecio && (
        <p className="tiny muted" style={{ margin: 0 }}>
          Es una prueba de precio: la conversión es la métrica equivocada. Un precio
          más alto convierte menos y puede dejar más plata. Mirá el ingreso por
          visita; la significancia de arriba es sobre la conversión.
        </p>
      )}

      {corriendo && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          {puedeAdoptar && prueba.veredicto.ganadora === 'B' && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={ocupado}
              onClick={() => void cerrar('B')}
            >
              Adoptar B y cerrar
            </button>
          )}
          <button
            type="button"
            className="btn"
            disabled={ocupado}
            onClick={() => void cerrar(puedeAdoptar ? 'A' : undefined)}
          >
            {puedeAdoptar ? 'Quedarme con A y cerrar' : 'Cerrar sin decidir'}
          </button>
        </div>
      )}
    </li>
  );
}

function Formulario({
  dishes,
  onCreada,
}: {
  dishes: DishDto[];
  onCreada: () => void;
}): ReactNode {
  const [dishId, setDishId] = useState('');
  const [field, setField] = useState<'PRICE' | 'DESCRIPTION'>('PRICE');
  const [valor, setValor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const plato = dishes.find((d) => d.id === dishId);

  const enviar = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    setError(null);
    setOcupado(true);
    try {
      await adminApi.createExperiment({
        dishId,
        field,
        // El precio se escribe en pesos y viaja en centavos, como todo el resto.
        valueB:
          field === 'PRICE' ? String(Math.round(Number(valor) * 100)) : valor.trim(),
      });
      setValor('');
      setDishId('');
      onCreada();
    } catch (capturado) {
      setError(
        capturado instanceof ApiError ? capturado.message : 'No pudimos crear la prueba',
      );
    } finally {
      setOcupado(false);
    }
  };

  return (
    <form className="card card-pad stack stack-3" onSubmit={(e) => void enviar(e)}>
      <span className="bold">Probar algo nuevo</span>

      <label className="stack stack-2">
        <span className="small bold">Plato</span>
        <select value={dishId} onChange={(e) => setDishId(e.target.value)} required>
          <option value="">Elegí un plato…</option>
          {dishes.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label className="stack stack-2">
        <span className="small bold">Qué probar</span>
        <select
          value={field}
          onChange={(e) => setField(e.target.value as 'PRICE' | 'DESCRIPTION')}
        >
          <option value="PRICE">El precio</option>
          <option value="DESCRIPTION">La descripción</option>
        </select>
      </label>

      <label className="stack stack-2">
        <span className="small bold">
          {field === 'PRICE' ? 'Precio alternativo (variante B)' : 'Descripción alternativa (variante B)'}
        </span>
        {field === 'PRICE' ? (
          <input
            type="number"
            min="0"
            step="1"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            required
          />
        ) : (
          <textarea
            rows={3}
            maxLength={600}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            required
          />
        )}
        <span className="tiny muted">
          La variante A es lo que dice el plato hoy
          {plato && field === 'PRICE' ? `: ${money(plato.priceCents, 'ARS')}` : ''}.
          No hace falta escribirla, y si la cambiás durante la prueba el control la
          sigue.
        </span>
      </label>

      {error && <p className="small" style={{ color: 'var(--critical)', margin: 0 }}>{error}</p>}

      <button type="submit" className="btn btn-primary" disabled={ocupado || !dishId}>
        {ocupado ? 'Creando…' : 'Empezar la prueba'}
      </button>
      <span className="tiny muted">
        Cada comensal ve siempre la misma variante, también al volver: el precio no
        le puede cambiar entre que lo ve y que paga.
      </span>
    </form>
  );
}

export function ExperimentsPage(): ReactNode {
  const [recarga, setRecarga] = useState(0);
  const pruebas = useAsync(
    (signal) => adminApi.experiments(signal),
    [recarga],
  );
  const platos = useAsync((signal) => adminApi.dishes(false, signal), []);
  const recargar = (): void => setRecarga((n) => n + 1);

  if (pruebas.loading || platos.loading) return <Spinner label="Cargando las pruebas" />;
  if (pruebas.error) {
    return <ErrorState message={pruebas.error.message} onRetry={pruebas.reload} />;
  }

  const corriendo = (pruebas.data ?? []).filter((p) => p.status === 'RUNNING');
  const cerradas = (pruebas.data ?? []).filter((p) => p.status !== 'RUNNING');
  const currency = platos.data?.[0]?.currency ?? 'ARS';

  return (
    <div className="stack stack-5">
      <header className="stack stack-2">
        <h1>Pruebas A/B de carta</h1>
        <p className="small secondary" style={{ margin: 0 }}>
          Mostrale dos precios, o dos descripciones, al mismo plato: la mitad de tus
          comensales ve una y la mitad la otra, y los números dicen cuál vende más.
        </p>
      </header>

      <Formulario dishes={platos.data ?? []} onCreada={recargar} />

      {corriendo.length > 0 && (
        <section className="stack stack-3">
          <h2>En curso</h2>
          <ul className="stack stack-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {corriendo.map((p) => (
              <Prueba key={p.id} prueba={p} currency={currency} onCambio={recargar} />
            ))}
          </ul>
        </section>
      )}

      {cerradas.length > 0 && (
        <section className="stack stack-3">
          <h2>Cerradas</h2>
          <ul className="stack stack-3" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {cerradas.map((p) => (
              <Prueba key={p.id} prueba={p} currency={currency} onCambio={recargar} />
            ))}
          </ul>
        </section>
      )}

      {corriendo.length === 0 && cerradas.length === 0 && (
        <p className="small muted">
          Todavía no probaste nada. Un buen primer experimento: el precio del plato
          que más se mira y menos se pide.
        </p>
      )}
    </div>
  );
}
