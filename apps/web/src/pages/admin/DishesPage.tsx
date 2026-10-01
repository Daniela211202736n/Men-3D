/**
 * Gestion de la carta: alta, baja, precio en el momento, disponibilidad y orden.
 *
 * El precio se edita en la misma fila y se guarda al salir del campo: es el
 * cambio que un dueño hace diez veces por semana y no merece abrir un formulario.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { DishDto } from '@men3d/shared';

import { Badge3D, EmptyState, ErrorState, Spinner } from '../../components/ui.js';
import { ApiError, adminApi } from '../../lib/api.js';
import { money } from '../../lib/format.js';
import { useAsync } from '../../lib/useAsync.js';
import { useToast } from '../../store/toast.js';

export function DishesPage(): ReactNode {
  const toast = useToast();
  const [includeArchived, setIncludeArchived] = useState(false);
  const { data: dishes, loading, error, reload, setData } = useAsync(
    (signal) => adminApi.dishes(includeArchived, signal),
    [includeArchived],
  );
  const { data: categories } = useAsync((signal) => adminApi.categories(signal), []);

  const patchLocal = (id: string, patch: Partial<DishDto>) =>
    setData((current) =>
      current?.map((dish) => (dish.id === id ? { ...dish, ...patch } : dish)) ?? null,
    );

  const savePrice = async (dish: DishDto, pesos: string) => {
    const cents = Math.round(Number(pesos.replace(',', '.')) * 100);
    if (!Number.isFinite(cents) || cents < 0 || cents === dish.priceCents) return;
    try {
      await adminApi.updatePrice(dish.id, cents);
      patchLocal(dish.id, { priceCents: cents });
      toast.show(`Precio de ${dish.name} actualizado`);
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : 'No se pudo guardar', 'error');
      reload();
    }
  };

  const toggleAvailability = async (dish: DishDto) => {
    // Respuesta optimista: el interruptor se mueve ya y se revierte si falla.
    patchLocal(dish.id, { isAvailable: !dish.isAvailable });
    try {
      await adminApi.updateAvailability(dish.id, !dish.isAvailable);
    } catch {
      patchLocal(dish.id, { isAvailable: dish.isAvailable });
      toast.show('No se pudo cambiar la disponibilidad', 'error');
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    if (!dishes) return;
    const target = index + direction;
    if (target < 0 || target >= dishes.length) return;
    const reordered = [...dishes];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved!);
    setData(reordered);
    try {
      await adminApi.reorderDishes(reordered.map((d) => d.id));
    } catch {
      toast.show('No se pudo guardar el orden', 'error');
      reload();
    }
  };

  const archive = async (dish: DishDto) => {
    if (!window.confirm(`¿Dar de baja "${dish.name}"? Se puede restaurar despues.`)) return;
    try {
      await adminApi.archiveDish(dish.id);
      toast.show(`${dish.name} dado de baja`);
      reload();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : 'No se pudo dar de baja', 'error');
    }
  };

  if (loading && !dishes) return <Spinner label="Cargando la carta" />;
  if (error) return <ErrorState message={error.message} onRetry={reload} />;

  return (
    <div className="stack stack-5">
      <header className="row-between wrap">
        <div className="stack" style={{ gap: 2 }}>
          <h1>Carta</h1>
          <p className="small muted">
            {dishes?.length ?? 0} platos · {categories?.length ?? 0} categorias
          </p>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <label className="chip" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
            />
            Ver dados de baja
          </label>
          <Link to="/admin/carta/nuevo" className="btn btn-primary btn-sm">
            + Nuevo plato
          </Link>
        </div>
      </header>

      {dishes?.length === 0 ? (
        <EmptyState
          title="Todavia no cargaste ningun plato"
          body="Carga el primero y, si tiene modelo 3D, el comensal va a poder verlo en su mesa."
          action={
            <Link to="/admin/carta/nuevo" className="btn btn-primary btn-sm">
              Cargar el primer plato
            </Link>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Orden</th>
                <th scope="col">Plato</th>
                <th scope="col">Categoria</th>
                <th scope="col" className="num">Precio</th>
                <th scope="col">Disponible</th>
                <th scope="col">3D</th>
                <th scope="col">&nbsp;</th>
              </tr>
            </thead>
            <tbody>
              {dishes?.map((dish, index) => (
                <tr key={dish.id}>
                  <td>
                    <div className="row" style={{ gap: 2 }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Subir ${dish.name}`}
                        disabled={index === 0}
                        onClick={() => void move(index, -1)}
                        style={{ minHeight: 28, padding: '2px 6px' }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Bajar ${dish.name}`}
                        disabled={index === (dishes?.length ?? 0) - 1}
                        onClick={() => void move(index, 1)}
                        style={{ minHeight: 28, padding: '2px 6px' }}
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <Link to={`/admin/carta/${dish.id}`} className="bold">
                        {dish.name}
                      </Link>
                      {dish.isFeatured && <span className="badge">destacado</span>}
                    </div>
                  </td>
                  <td className="secondary">{dish.categoryName}</td>
                  <td className="num">
                    {/* Campo de precio editable en la fila. */}
                    <input
                      className="input nums"
                      defaultValue={(dish.priceCents / 100).toFixed(2)}
                      inputMode="decimal"
                      aria-label={`Precio de ${dish.name}`}
                      style={{ width: 104, minHeight: 34, textAlign: 'right' }}
                      onBlur={(e) => void savePrice(dish, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                      }}
                    />
                    <div className="tiny muted nums">
                      {money(dish.priceCents, dish.currency)}
                    </div>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="chip"
                      aria-pressed={dish.isAvailable}
                      onClick={() => void toggleAvailability(dish)}
                    >
                      {dish.isAvailable ? 'Si' : 'Agotado'}
                    </button>
                  </td>
                  <td>{dish.has3d ? <Badge3D /> : <span className="tiny muted">—</span>}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <Link to={`/admin/carta/${dish.id}`} className="btn btn-ghost btn-sm">
                        Editar
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm btn-danger"
                        onClick={() => void archive(dish)}
                      >
                        Baja
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CategoryManager onChanged={reload} />
    </div>
  );
}

/** Alta, renombrado y baja de categorias, con reordenamiento. */
function CategoryManager({ onChanged }: { onChanged: () => void }): ReactNode {
  const toast = useToast();
  const { data: categories, reload, setData } = useAsync(
    (signal) => adminApi.categories(signal),
    [],
  );
  const [name, setName] = useState('');

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await adminApi.createCategory({ name: name.trim() });
      setName('');
      reload();
      onChanged();
    } catch (caught) {
      toast.show(caught instanceof ApiError ? caught.message : 'No se pudo crear', 'error');
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    if (!categories) return;
    const target = index + direction;
    if (target < 0 || target >= categories.length) return;
    const reordered = [...categories];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved!);
    setData(reordered);
    try {
      await adminApi.reorderCategories(reordered.map((c) => c.id));
    } catch {
      toast.show('No se pudo guardar el orden', 'error');
      reload();
    }
  };

  return (
    <section className="card card-pad stack stack-3">
      <h3>Categorias</h3>
      <ul className="stack stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {categories?.map((category, index) => (
          <li key={category.id} className="row-between">
            <span className="small">
              {category.name}{' '}
              <span className="tiny muted">({category.dishCount} platos)</span>
            </span>
            <div className="row" style={{ gap: 2 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Subir ${category.name}`}
                disabled={index === 0}
                onClick={() => void move(index, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Bajar ${category.name}`}
                disabled={index === (categories?.length ?? 0) - 1}
                onClick={() => void move(index, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-danger"
                onClick={async () => {
                  try {
                    await adminApi.deleteCategory(category.id);
                    reload();
                    onChanged();
                  } catch (caught) {
                    toast.show(
                      caught instanceof ApiError ? caught.message : 'No se pudo borrar',
                      'error',
                    );
                  }
                }}
              >
                Borrar
              </button>
            </div>
          </li>
        ))}
      </ul>
      <form className="row" style={{ gap: 8 }} onSubmit={create}>
        <input
          className="input grow"
          placeholder="Nueva categoria (ej: Postres)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="btn btn-sm">
          Agregar
        </button>
      </form>
    </section>
  );
}
